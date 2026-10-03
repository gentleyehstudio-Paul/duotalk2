import { load } from 'js-yaml';
import { thresholds } from '../config/thresholds';
import { METRIC_IDS, type MetricId } from '../types/metrics';
import type { Rule, RuleSet, RuleWhen } from '../types/report';

/** 解析並驗證 rules.yaml 文字。格式錯誤直接丟出，寧可不產生建議也不要靜默吞掉。 */
export function parseRules(text: string): RuleSet {
  const doc = load(text) as unknown;
  if (!doc || typeof doc !== 'object') throw new Error('rules.yaml：根節點必須是物件');
  const d = doc as { version?: unknown; rules?: unknown };
  if (d.version !== 1) throw new Error(`rules.yaml：不支援的 version ${String(d.version)}`);
  if (!Array.isArray(d.rules)) throw new Error('rules.yaml：rules 必須是陣列');
  const ids = new Set<string>();
  const rules = d.rules.map((r, i) => validateRule(r, i));
  for (const r of rules) {
    if (ids.has(r.id)) throw new Error(`rules.yaml：重複的規則 id "${r.id}"`);
    ids.add(r.id);
  }
  return { version: 1, rules };
}

function isMetric(x: unknown): x is MetricId {
  return typeof x === 'string' && (METRIC_IDS as readonly string[]).includes(x);
}

function validateRule(r: unknown, i: number): Rule {
  const where = `rules.yaml 第 ${i + 1} 條規則`;
  if (!r || typeof r !== 'object') throw new Error(`${where}：必須是物件`);
  const o = r as Record<string, unknown>;
  if (typeof o.id !== 'string' || !o.id) throw new Error(`${where}：缺少 id`);
  if (!isMetric(o.metric)) throw new Error(`${where}（${o.id}）：metric "${String(o.metric)}" 不是已知指標`);
  const priority = typeof o.priority === 'number' ? o.priority : 100;
  for (const k of ['observation', 'cue', 'drill'] as const) {
    if (typeof o[k] !== 'string' || !o[k]) throw new Error(`${where}（${o.id}）：缺少 ${k}`);
  }
  const rt = o.retest as Record<string, unknown> | undefined;
  if (!rt || !isMetric(rt.metric) || typeof rt.target !== 'string' || typeof rt.method !== 'string') {
    throw new Error(`${where}（${o.id}）：retest 需要 metric / target / method`);
  }
  const when = validateWhen(o.when, `${where}（${o.id}）`);
  const texts = [o.observation, o.cue, o.drill, rt.target, rt.method] as string[];
  for (const t of texts) {
    const bad = thresholds.report.forbiddenTerms.find((term) => t.toLowerCase().includes(term.toLowerCase()));
    if (bad) throw new Error(`${where}（${o.id}）：文字含禁用詞「${bad}」（規則 3：不打分數、不做好壞判定）`);
  }
  return {
    id: o.id,
    metric: o.metric,
    priority,
    when,
    observation: o.observation as string,
    cue: o.cue as string,
    drill: o.drill as string,
    retest: { metric: rt.metric, target: rt.target as string, method: rt.method as string },
  };
}

function validateWhen(w: unknown, where: string): RuleWhen {
  if (!w || typeof w !== 'object') throw new Error(`${where}：缺少 when`);
  const o = w as Record<string, unknown>;
  const minShots = typeof o.minShots === 'number' ? o.minShots : 1;
  if (o.compare === 'baseline') {
    if (!['below', 'above', 'either'].includes(o.direction as string)) throw new Error(`${where}：baseline 規則的 direction 必須是 below/above/either`);
    if (typeof o.zThreshold !== 'number' || o.zThreshold <= 0) throw new Error(`${where}：baseline 規則需要正數 zThreshold`);
    return { compare: 'baseline', direction: o.direction as 'below' | 'above' | 'either', zThreshold: o.zThreshold, minShots };
  }
  if (o.compare === 'absolute') {
    if (!['below', 'above'].includes(o.direction as string)) throw new Error(`${where}：absolute 規則的 direction 必須是 below/above`);
    if (typeof o.value !== 'number') throw new Error(`${where}：absolute 規則需要 value`);
    return { compare: 'absolute', direction: o.direction as 'below' | 'above', value: o.value, minShots };
  }
  if (o.compare === 'consistency') {
    if (typeof o.cvAbove !== 'number' || o.cvAbove <= 0) throw new Error(`${where}：consistency 規則需要正數 cvAbove`);
    return { compare: 'consistency', cvAbove: o.cvAbove, minShots };
  }
  throw new Error(`${where}：未知的 compare "${String(o.compare)}"`);
}

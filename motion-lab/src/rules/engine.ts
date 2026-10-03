import { thresholds } from '../config/thresholds';
import { formatMetric, METRIC_DEFINITIONS } from '../metrics/definitions';
import { deviationFromBaseline } from '../metrics/summary';
import { METRIC_IDS, type Baseline, type MetricId, type SessionMetricsSummary, type ShotMetrics } from '../types/metrics';
import type { Highlight, Recommendation, Report, Rule, RuleEvaluation, RuleSet, UnreadableItem } from '../types/report';
import type { ProcessedTrack } from '../types/series';
import type { SegmentationResult } from '../types/shot';

export interface ReportInput {
  rules: RuleSet;
  processed: ProcessedTrack;
  segmentation: SegmentationResult;
  shotMetrics: ShotMetrics[];
  summary: SessionMetricsSummary;
  baseline: Baseline | null;
  /** 先前已儲存的球數（供「尚無基準」說明）。 */
  priorShotCount: number;
}

/** 評估單一規則。所有條件由數字決定；任何輸入缺失 → 不觸發並附原因。 */
export function evaluateRule(rule: Rule, input: ReportInput): RuleEvaluation {
  const st = input.summary[rule.metric];
  const base = input.baseline?.[rule.metric] ?? null;
  const dev = deviationFromBaseline(rule.metric, st, base);
  const values = { current: st.mean, n: st.n, baseline: base?.mean ?? null, diff: dev?.diff ?? null, z: dev?.z ?? null, cv: st.cv };
  const no = (reason: string, magnitude = 0): RuleEvaluation => ({ ruleId: rule.id, metric: rule.metric, triggered: false, reason, values, magnitude });

  if (st.n < rule.when.minShots) return no(`可讀球數 ${st.n} < ${rule.when.minShots}`);
  if (st.mean === null) return no('本次無可讀數值');

  switch (rule.when.compare) {
    case 'baseline': {
      if (!base) return no('尚無個人基準');
      if (!dev || dev.z === null) return no('個人基準 SD 太小，無法以 SD 倍數比較');
      const z = dev.z;
      const hit =
        rule.when.direction === 'below' ? z <= -rule.when.zThreshold : rule.when.direction === 'above' ? z >= rule.when.zThreshold : Math.abs(z) >= rule.when.zThreshold;
      if (!hit) return no(`|z| ${Math.abs(z).toFixed(2)} 未達 ${rule.when.zThreshold}（方向 ${rule.when.direction}）`, Math.abs(z));
      return { ruleId: rule.id, metric: rule.metric, triggered: true, values, magnitude: Math.abs(z) };
    }
    case 'absolute': {
      const v = st.mean;
      const hit = rule.when.direction === 'below' ? v < rule.when.value : v > rule.when.value;
      const mag = Math.abs(v - rule.when.value);
      if (!hit) return no(`本次 ${formatMetric(rule.metric, v)} 未${rule.when.direction === 'below' ? '低於' : '高於'} ${formatMetric(rule.metric, rule.when.value)}`, mag);
      return { ruleId: rule.id, metric: rule.metric, triggered: true, values, magnitude: mag };
    }
    case 'consistency': {
      if (st.cv === null) return no(st.cvReason ?? '無法計算一致性');
      if (st.cv <= rule.when.cvAbove) return no(`CV ${(st.cv * 100).toFixed(1)}% 未超過 ${(rule.when.cvAbove * 100).toFixed(0)}%`, st.cv);
      return { ruleId: rule.id, metric: rule.metric, triggered: true, values, magnitude: st.cv };
    }
  }
}

function fill(template: string, metric: MetricId, ev: RuleEvaluation, rule: Rule): string {
  const v = ev.values;
  const absFmt = (x: number | null) => (x === null ? '—' : formatMetric(metric, Math.abs(x)));
  const map: Record<string, string> = {
    current: formatMetric(metric, v.current),
    baseline: formatMetric(metric, v.baseline),
    diff: absFmt(v.diff),
    z: v.z === null ? '—' : `${v.z >= 0 ? '+' : ''}${v.z.toFixed(2)}`,
    cv: v.cv === null ? '—' : `${(v.cv * 100).toFixed(1)}%`,
    n: String(v.n),
    value: rule.when.compare === 'absolute' ? absFmt(rule.when.compare === 'absolute' && v.current !== null ? v.current - rule.when.value : null) : '—',
  };
  if (rule.when.compare === 'absolute') map.value = formatMetric(metric, rule.when.value);
  return template.replace(/\{(\w+)\}/g, (_, k: string) => map[k] ?? `{${k}}`);
}

/** 本次偏離最大的那一球的代表幀（用於 ±N 幀片段）。 */
function representativeFrame(metric: MetricId, shots: ShotMetrics[], baselineMean: number | null): number | null {
  let best: number | null = null;
  let bestD = -1;
  for (const s of shots) {
    const mv = s.values[metric];
    if (mv.value === null || mv.frameIndex === null) continue;
    const d = baselineMean === null ? 0 : Math.abs(mv.value - baselineMean);
    if (best === null || d > bestD) {
      best = mv.frameIndex;
      bestD = d;
    }
  }
  return best;
}

export function buildReport(input: ReportInput): Report {
  const cfg = thresholds.report;
  const { summary, baseline, shotMetrics, segmentation, processed } = input;

  // ── 規則評估 → 建議（最多 N 條，priority 小者優先，再依偏離幅度）──
  const evaluations = input.rules.rules.map((r) => evaluateRule(r, input));
  const triggered = evaluations
    .filter((e) => e.triggered)
    .map((e) => ({ e, rule: input.rules.rules.find((r) => r.id === e.ruleId)! }))
    .sort((a, b) => a.rule.priority - b.rule.priority || b.e.magnitude - a.e.magnitude);
  const usedMetrics = new Set<MetricId>();
  const recommendations: Recommendation[] = [];
  for (const { e, rule } of triggered) {
    if (recommendations.length >= cfg.maxRecommendations) break;
    if (usedMetrics.has(rule.metric)) continue; // 同一指標只給一條
    usedMetrics.add(rule.metric);
    recommendations.push({
      ruleId: rule.id,
      metric: rule.metric,
      observation: fill(rule.observation, rule.metric, e, rule),
      cue: rule.cue,
      drill: rule.drill,
      retest: rule.retest,
      frameIndex: representativeFrame(rule.metric, shotMetrics, e.values.baseline),
      values: e.values,
    });
  }

  // ── 重點整理：每個可讀指標一條，依 |z| 大者優先，其次觸發規則者，取 min..max 條 ──
  const candidates = METRIC_IDS.map((id) => {
    const st = summary[id];
    const def = METRIC_DEFINITIONS[id];
    const base = baseline?.[id] ?? null;
    const dev = deviationFromBaseline(id, st, base);
    const score = dev?.z !== null && dev?.z !== undefined ? Math.abs(dev.z) : 0;
    const flagged = recommendations.some((r) => r.metric === id) ? 1 : 0;
    const h: Highlight = {
      metric: id,
      name: def.name,
      current: st.mean === null ? '—' : `${formatMetric(id, st.mean)}${st.sd !== null && st.n > 1 ? ` ± ${st.sd.toFixed(def.decimals)}` : ''}`,
      currentValue: st.mean,
      n: st.n,
      baseline: base ? `${formatMetric(id, base.mean)} ± ${base.sd.toFixed(def.decimals)}（${base.n} 球 / ${base.sessions} 場）` : '尚無基準',
      deviation: dev ? `${dev.diff >= 0 ? '+' : ''}${formatMetric(id, dev.diff)}${dev.z === null ? '（基準 SD 太小）' : `（${dev.z >= 0 ? '+' : ''}${dev.z.toFixed(2)} SD）`}` : '—',
      consistency: st.cv !== null ? `CV ${(st.cv * 100).toFixed(1)}%` : def.cvMeaningful ? (st.cvReason ?? '—') : st.sd !== null && st.n > 1 ? `SD ${st.sd.toFixed(def.decimals)}` : '—',
      frameIndex: representativeFrame(id, shotMetrics, base?.mean ?? null),
    };
    return { h, readable: st.mean !== null, score, flagged };
  });
  const readable = candidates.filter((c) => c.readable).sort((a, b) => b.flagged - a.flagged || b.score - a.score);
  const highlights = readable.slice(0, Math.max(cfg.minHighlights, Math.min(cfg.maxHighlights, readable.length))).slice(0, cfg.maxHighlights).map((c) => c.h);

  // ── 無法判讀 ──
  const unreadable: UnreadableItem[] = [];
  if (processed.stats.undetectedRatio > thresholds.quality.maxUndetectedFrameRatio) {
    unreadable.push({ kind: 'camera', text: `未偵測到人的幀比例 ${(processed.stats.undetectedRatio * 100).toFixed(0)}% 超過上限 ${(thresholds.quality.maxUndetectedFrameRatio * 100).toFixed(0)}%，機位或畫面不符，整段不宜判讀。` });
  }
  if (processed.bodyHeightSource === 'none') unreadable.push({ kind: 'camera', text: '無法估計身高尺度（鼻子/腳踝/軀幹都不可用）。' });
  if (processed.facing === 'unknown') unreadable.push({ kind: 'camera', text: '無法判定面向，軀幹前傾方向不可用。' });
  if (processed.shootingSideSource === 'auto_uncertain') unreadable.push({ kind: 'confidence', text: `投籃側自動判定不確定（兩側 visibility 差距小於 ${thresholds.side.minSideVisibilityGap}），目前假設為 ${processed.shootingSide}；可在設定中強制指定。` });
  for (const f of segmentation.failures) {
    const text =
      f === 'no_body_scale' ? '無法估計身高，無法切分投籃。' : f === 'wrist_unreadable' ? '投籃側手腕幾乎沒有有效幀，無法切分投籃。' : f === 'no_release_candidates' ? '找不到手腕高於肩線且夠突出的高度峰值（沒有出手動作或機位不符）。' : '手腕高度峰值都不符合上升速度／肘伸展條件。';
    unreadable.push({ kind: 'segmentation', text });
  }
  for (const s of segmentation.shots) {
    if (!s.readable) unreadable.push({ kind: 'occlusion', text: `第 ${s.index + 1} 球：投籃側手腕/手肘有效幀比例不足（腕 ${(s.evidence.wristValidRatio * 100).toFixed(0)}%、肘 ${(s.evidence.elbowValidRatio * 100).toFixed(0)}%）。` });
  }
  for (const id of METRIC_IDS) {
    const reasons = new Map<string, number[]>();
    for (const sm of shotMetrics) {
      const mv = sm.values[id];
      if (mv.value === null && mv.reason) reasons.set(mv.reason, [...(reasons.get(mv.reason) ?? []), sm.shotIndex + 1]);
    }
    for (const [reason, shots] of reasons) {
      unreadable.push({ kind: reason.includes('缺口') || reason.includes('缺值') || reason.includes('遮') ? 'occlusion' : 'confidence', text: `${METRIC_DEFINITIONS[id].name}（第 ${shots.join('、')} 球）：${reason}` });
    }
  }
  const noCv = METRIC_IDS.filter((id) => METRIC_DEFINITIONS[id].cvMeaningful && summary[id].cv === null && summary[id].n > 0 && summary[id].cvReason?.includes('球數不足'));
  if (noCv.length) unreadable.push({ kind: 'confidence', text: `一致性（CV）需要至少 ${thresholds.shots.minShotsForConsistency} 球，本次可讀球數不足：${noCv.map((id) => METRIC_DEFINITIONS[id].name).join('、')}。` });
  const noBase = METRIC_IDS.filter((id) => !baseline?.[id]);
  if (noBase.length === METRIC_IDS.length) {
    unreadable.push({ kind: 'baseline', text: `尚無個人基準（已儲存 ${input.priorShotCount} 球，需 ${thresholds.baseline.minShots} 球）；與基準相關的規則本次不評估。` });
  } else if (noBase.length) {
    unreadable.push({ kind: 'baseline', text: `以下指標尚無個人基準：${noBase.map((id) => METRIC_DEFINITIONS[id].name).join('、')}。` });
  }
  if (readable.length < cfg.minHighlights) unreadable.push({ kind: 'confidence', text: `可讀指標只有 ${readable.length} 項，重點整理少於 ${cfg.minHighlights} 條。` });

  const report: Report = {
    generatedAt: new Date().toISOString(),
    shotsAnalyzed: segmentation.shots.length,
    shotsReadable: segmentation.shots.filter((s) => s.readable).length,
    highlights,
    recommendations,
    unreadable,
    evaluations,
  };
  assertNoForbiddenTerms(report);
  return report;
}

/** 規則 3 守門：報告任何文字出現禁用詞即為程式錯誤。 */
export function assertNoForbiddenTerms(report: Report): void {
  const text = JSON.stringify({ h: report.highlights, r: report.recommendations, u: report.unreadable }).toLowerCase();
  for (const term of thresholds.report.forbiddenTerms) {
    if (text.includes(term.toLowerCase())) throw new Error(`報告含禁用詞「${term}」`);
  }
}

/** 報告輸出為 Markdown（固定結構）。 */
export function reportToMarkdown(report: Report, sessionName: string): string {
  const L: string[] = [];
  L.push(`# MOTION LAB 報告 — ${sessionName}`);
  L.push(`產生時間：${new Date(report.generatedAt).toLocaleString()} · 分析 ${report.shotsAnalyzed} 球（可讀 ${report.shotsReadable} 球）`);
  L.push('', '## 1. 重點整理');
  if (report.highlights.length === 0) L.push('（無可讀指標）');
  report.highlights.forEach((h, i) => L.push(`${i + 1}. **${h.name}**：本次 ${h.current}（n=${h.n}）· 個人基準 ${h.baseline} · 偏離 ${h.deviation} · 一致性 ${h.consistency}`));
  L.push('', `## 2. 建議（最多 ${thresholds.report.maxRecommendations} 條）`);
  if (report.recommendations.length === 0) L.push('本次沒有符合條件的建議。');
  report.recommendations.forEach((r, i) => {
    L.push(`${i + 1}. **Observation** ${r.observation}`);
    L.push(`   - **Cue** ${r.cue}`);
    L.push(`   - **Drill** ${r.drill}`);
    L.push(`   - **Retest** 目標：${r.retest.target}（${METRIC_DEFINITIONS[r.retest.metric].name}）；方式：${r.retest.method}`);
  });
  L.push('', '## 3. 無法判讀項目');
  if (report.unreadable.length === 0) L.push('無。');
  report.unreadable.forEach((u) => L.push(`- [${u.kind}] ${u.text}`));
  return L.join('\n');
}

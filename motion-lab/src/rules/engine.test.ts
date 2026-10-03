import { describe, expect, it } from 'vitest';
import yamlText from '../../rules/rules.yaml?raw';
import { thresholds } from '../config/thresholds';
import { computeShotMetrics } from '../metrics/computeShotMetrics';
import { summarizeSession } from '../metrics/summary';
import { processTrack } from '../processing/processTrack';
import { segmentShots } from '../segmentation/segmentShots';
import { buildSyntheticShotTrack, DEFAULT_SCRIPT, type ShotScript } from '../testutils/syntheticShot';
import type { Baseline, MetricId } from '../types/metrics';
import { assertNoForbiddenTerms, buildReport, evaluateRule, reportToMarkdown, type ReportInput } from './engine';
import { parseRules } from './loadRules';

const rules = parseRules(yamlText);

function session(nShots: number) {
  const scripts: ShotScript[] = Array.from({ length: nShots }, (_, i) => ({ startS: 0.5 + i * 3, ...DEFAULT_SCRIPT }));
  const processed = processTrack(buildSyntheticShotTrack(scripts, 0.5 + nShots * 3 + 1));
  const segmentation = segmentShots(processed);
  const shotMetrics = segmentation.shots.map((s) => computeShotMetrics(processed, s));
  const summary = summarizeSession(shotMetrics);
  return { processed, segmentation, shotMetrics, summary };
}

function baselineLike(summaryMeans: Record<MetricId, number | null>, shift: Partial<Record<MetricId, number>>, sd: Partial<Record<MetricId, number>>): Baseline {
  const b = {} as Baseline;
  for (const id of Object.keys(summaryMeans) as MetricId[]) {
    const m = summaryMeans[id];
    b[id] = m === null ? null : { n: 10, sessions: 2, mean: m + (shift[id] ?? 0), sd: sd[id] ?? 1 };
  }
  return b;
}

describe('rules.yaml', () => {
  it('parses, has unique ids, known metrics and no forbidden terms', () => {
    expect(rules.rules.length).toBeGreaterThan(5);
    const ids = new Set(rules.rules.map((r) => r.id));
    expect(ids.size).toBe(rules.rules.length);
  });
  it('rejects malformed rules with a clear message', () => {
    expect(() => parseRules('version: 1\nrules:\n  - id: x\n    metric: nope\n')).toThrow(/不是已知指標/);
    expect(() => parseRules(yamlText.replace('cue: \'下蹲時想著', 'cue: \'這是分數 下蹲時想著'))).toThrow(/禁用詞/);
    expect(() => parseRules('version: 2\nrules: []')).toThrow(/version/);
  });
});

describe('evaluateRule', () => {
  const s = session(3);
  const means = Object.fromEntries(Object.entries(s.summary).map(([k, v]) => [k, v.mean])) as Record<MetricId, number | null>;
  const kneeRule = rules.rules.find((r) => r.id === 'knee_flexion_below_baseline')!;

  it('triggers a baseline rule only beyond the z threshold in the right direction', () => {
    const input = (shift: number): ReportInput => ({
      rules,
      ...s,
      baseline: baselineLike(means, { knee_max_flexion_deg: shift }, { knee_max_flexion_deg: 4 }),
      priorShotCount: 10,
    });
    // 本次比基準低 8° / sd 4 → z = −2 → 觸發
    expect(evaluateRule(kneeRule, input(8)).triggered).toBe(true);
    // 本次比基準低 2° → z = −0.5 → 不觸發
    const e = evaluateRule(kneeRule, input(2));
    expect(e.triggered).toBe(false);
    expect(e.reason).toContain('未達');
    // 本次比基準高 → 方向不符
    expect(evaluateRule(kneeRule, input(-8)).triggered).toBe(false);
  });

  it('does not trigger without a baseline or with a tiny baseline sd', () => {
    const noBase: ReportInput = { rules, ...s, baseline: null, priorShotCount: 0 };
    expect(evaluateRule(kneeRule, noBase).reason).toContain('尚無個人基準');
    const tiny: ReportInput = { rules, ...s, baseline: baselineLike(means, { knee_max_flexion_deg: 8 }, { knee_max_flexion_deg: 0.1 }), priorShotCount: 10 };
    expect(evaluateRule(kneeRule, tiny).reason).toContain('SD 太小');
  });

  it('consistency rule needs enough shots', () => {
    const rule = rules.rules.find((r) => r.id === 'release_height_inconsistent')!;
    const two = session(2);
    const e = evaluateRule(rule, { rules, ...two, baseline: null, priorShotCount: 0 });
    expect(e.triggered).toBe(false);
    expect(e.reason).toMatch(/球數/);
  });

  it('absolute rule compares against the configured value', () => {
    const rule = rules.rules.find((r) => r.id === 'follow_through_short')!;
    // synthetic follow-through ≈ 600 ms > 300 → not triggered
    expect(evaluateRule(rule, { rules, ...s, baseline: null, priorShotCount: 0 }).triggered).toBe(false);
  });
});

describe('buildReport', () => {
  const s = session(3);
  const means = Object.fromEntries(Object.entries(s.summary).map(([k, v]) => [k, v.mean])) as Record<MetricId, number | null>;

  it('with no baseline: highlights 3–5 readable metrics, no recommendations, unreadable lists the missing baseline', () => {
    const r = buildReport({ rules, ...s, baseline: null, priorShotCount: 2 });
    expect(r.highlights.length).toBeGreaterThanOrEqual(thresholds.report.minHighlights);
    expect(r.highlights.length).toBeLessThanOrEqual(thresholds.report.maxHighlights);
    expect(r.recommendations.length).toBe(0);
    expect(r.unreadable.some((u) => u.kind === 'baseline' && u.text.includes('尚無個人基準'))).toBe(true);
    for (const h of r.highlights) {
      expect(h.current).not.toBe('—');
      expect(h.baseline).toBe('尚無基準');
    }
  });

  it('caps recommendations at the configured maximum and fills the Observation → Cue → Drill → Retest structure', () => {
    // 三個指標都偏離 2 SD：膝少 8°、Set Point 肘多 10°、出手高度低 0.1
    const baseline = baselineLike(
      means,
      { knee_max_flexion_deg: 8, elbow_flexion_at_set_point_deg: -10, release_height_ratio: 0.1 },
      { knee_max_flexion_deg: 4, elbow_flexion_at_set_point_deg: 5, release_height_ratio: 0.05 },
    );
    const r = buildReport({ rules, ...s, baseline, priorShotCount: 10 });
    const triggered = r.evaluations.filter((e) => e.triggered);
    expect(triggered.length).toBeGreaterThanOrEqual(3);
    expect(r.recommendations.length).toBe(thresholds.report.maxRecommendations);
    for (const rec of r.recommendations) {
      expect(rec.observation).toMatch(/SD/);
      expect(rec.observation).not.toMatch(/\{\w+\}/); // 樣板全部填入
      expect(rec.cue.length).toBeGreaterThan(0);
      expect(rec.drill.length).toBeGreaterThan(0);
      expect(rec.retest.target.length).toBeGreaterThan(0);
      expect(rec.frameIndex).not.toBeNull();
    }
    // priority 10 (膝) 應排第一
    expect(r.recommendations[0]!.ruleId).toBe('knee_flexion_below_baseline');
    // 重點整理把有建議的指標排前面
    const recMetrics = r.recommendations.map((x) => x.metric);
    expect(recMetrics).toContain(r.highlights[0]!.metric);
    expect(recMetrics).toContain(r.highlights[1]!.metric);
  });

  it('lists per-metric unreadable reasons and never prints a score', () => {
    const track = buildSyntheticShotTrack([{ startS: 0.5, ...DEFAULT_SCRIPT }], 4);
    for (let i = 30; i <= 70; i++) track.series.right_knee[i]!.visibility = 0.1;
    const processed = processTrack(track);
    const segmentation = segmentShots(processed);
    const shotMetrics = segmentation.shots.map((sh) => computeShotMetrics(processed, sh));
    const r = buildReport({ rules, processed, segmentation, shotMetrics, summary: summarizeSession(shotMetrics), baseline: null, priorShotCount: 0 });
    expect(r.unreadable.some((u) => u.text.includes('膝最大屈曲') && u.text.includes('第 1 球'))).toBe(true);
    expect(r.unreadable.some((u) => u.text.includes('一致性'))).toBe(true);
    const md = reportToMarkdown(r, 'test');
    expect(md).toContain('## 1. 重點整理');
    expect(md).toContain('## 2. 建議');
    expect(md).toContain('## 3. 無法判讀項目');
    for (const term of thresholds.report.forbiddenTerms) expect(md.toLowerCase()).not.toContain(term.toLowerCase());
    expect(() => assertNoForbiddenTerms(r)).not.toThrow();
  });

  it('reports segmentation failure reasons when no shot is found', () => {
    const processed = processTrack(buildSyntheticShotTrack([], 3));
    const segmentation = segmentShots(processed);
    const r = buildReport({ rules, processed, segmentation, shotMetrics: [], summary: summarizeSession([]), baseline: null, priorShotCount: 0 });
    expect(r.shotsAnalyzed).toBe(0);
    expect(r.recommendations).toEqual([]);
    expect(r.unreadable.some((u) => u.kind === 'segmentation')).toBe(true);
  });
});

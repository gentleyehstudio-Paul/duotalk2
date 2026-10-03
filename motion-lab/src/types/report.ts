import type { MetricId } from './metrics';

/** 規則定義（rules/rules.yaml 解析後）。 */
export interface RuleWhenBaseline {
  compare: 'baseline';
  direction: 'below' | 'above' | 'either';
  zThreshold: number;
  minShots: number;
}
export interface RuleWhenAbsolute {
  compare: 'absolute';
  direction: 'below' | 'above';
  value: number;
  minShots: number;
}
export interface RuleWhenConsistency {
  compare: 'consistency';
  cvAbove: number;
  minShots: number;
}
export type RuleWhen = RuleWhenBaseline | RuleWhenAbsolute | RuleWhenConsistency;

export interface Rule {
  id: string;
  metric: MetricId;
  priority: number;
  when: RuleWhen;
  observation: string;
  cue: string;
  drill: string;
  retest: { metric: MetricId; target: string; method: string };
}

export interface RuleSet {
  version: number;
  rules: Rule[];
}

/** 規則評估結果（觸發與否都記錄，供透明度；只有 triggered 會進建議）。 */
export interface RuleEvaluation {
  ruleId: string;
  metric: MetricId;
  triggered: boolean;
  /** 未觸發或無法評估的原因。 */
  reason?: string;
  values: {
    current: number | null;
    n: number;
    baseline: number | null;
    diff: number | null;
    z: number | null;
    cv: number | null;
  };
  /** 排序用的偏離幅度（|z| 或 |cv| 或 |current − value|）。 */
  magnitude: number;
}

export interface Recommendation {
  ruleId: string;
  metric: MetricId;
  observation: string;
  cue: string;
  drill: string;
  retest: { metric: MetricId; target: string; method: string };
  /** 代表幀（本次偏離最大的那一球的指標代表幀），用於 ±N 幀片段。 */
  frameIndex: number | null;
  values: RuleEvaluation['values'];
}

export interface Highlight {
  metric: MetricId;
  name: string;
  /** 本次平均（已格式化）與原始值。 */
  current: string;
  currentValue: number | null;
  n: number;
  baseline: string;
  deviation: string;
  consistency: string;
  frameIndex: number | null;
}

export interface UnreadableItem {
  /** 分類：camera（機位/畫面）、occlusion（遮擋/缺值）、confidence（信心不足/球數不足）、segmentation（切分）、baseline（無基準）。 */
  kind: 'camera' | 'occlusion' | 'confidence' | 'segmentation' | 'baseline';
  text: string;
}

export interface Report {
  generatedAt: string;
  shotsAnalyzed: number;
  shotsReadable: number;
  highlights: Highlight[];
  recommendations: Recommendation[];
  unreadable: UnreadableItem[];
  evaluations: RuleEvaluation[];
}

/**
 * 步驟 4：指標資料結構。每個指標值都由時間序列在某個階段區間或事件上計算，
 * 並記錄「代表幀」以便顯示時附帶 ±N 幀動態片段。無法計算時 value 為 null 並附原因（不補造）。
 */
export const METRIC_IDS = [
  'knee_max_flexion_deg',
  'elbow_flexion_at_set_point_deg',
  'release_height_ratio',
  'dip_to_release_ms',
  'knee_elbow_extension_lag_ms',
  'trunk_lean_at_release_deg',
  'follow_through_hold_ms',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export type MetricUnit = 'deg' | 'ms' | 'ratio';

export interface MetricDefinition {
  id: MetricId;
  /** 顯示名稱（繁中）。 */
  name: string;
  unit: MetricUnit;
  /** 顯示小數位數。 */
  decimals: number;
  /** 由哪個階段 / 事件的時間序列計算。 */
  source: string;
  /** 計算說明。 */
  description: string;
  /** 一致性（CV）是否有意義；有號、可為 0 附近的量（如軀幹前傾）用標準差而非 CV。 */
  cvMeaningful: boolean;
}

export interface MetricValue {
  id: MetricId;
  value: number | null;
  /** 代表幀（ProcessedTrack 索引）；區間型指標為極值所在幀，事件型為事件幀，時長型為區間起點。 */
  frameIndex: number | null;
  /** 區間型 / 時長型指標的區間終點。 */
  endFrameIndex?: number;
  /** value 為 null 時的原因（繁中）。 */
  reason?: string;
}

export interface ShotMetrics {
  shotIndex: number;
  values: Record<MetricId, MetricValue>;
}

export interface MetricStats {
  n: number;
  mean: number | null;
  sd: number | null;
  /** 變異係數 sd/|mean|；球數不足或指標不適用時為 null，並由 cvReason 說明。 */
  cv: number | null;
  cvReason?: string;
  min: number | null;
  max: number | null;
  median: number | null;
  values: Array<number | null>;
}

export type SessionMetricsSummary = Record<MetricId, MetricStats>;

export interface BaselineEntry {
  n: number;
  sessions: number;
  mean: number;
  sd: number;
}

/** 個人基準：由先前 Session 的所有可讀球計算；不足最少球數的指標為 null。 */
export type Baseline = Record<MetricId, BaselineEntry | null>;

export interface Deviation {
  /** 本次平均 − 基準平均。 */
  diff: number;
  /** 以基準標準差倍數表示；基準 sd 太小時為 null。 */
  z: number | null;
}

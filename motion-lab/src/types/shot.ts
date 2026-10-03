/**
 * 步驟 3 輸出：一段影片切出的每一球與六個階段。所有索引都是 ProcessedTrack 陣列的索引（非原始幀號）。
 * 階段為連續區段 [start, end]（含），Release 為單一時刻（start === end），顯示時必須附帶 ±N 幀動態片段。
 */
export const PHASE_NAMES = ['setup', 'dip', 'rise', 'set_point', 'release', 'follow_through'] as const;
export type PhaseName = (typeof PHASE_NAMES)[number];

export interface Phase {
  name: PhaseName;
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export type ShotIssue =
  | 'low_valid_ratio' // 投籃側手腕/手肘有效幀不足
  | 'dip_onset_undetermined' // 找不到下蹲/下沉起點，Dip 起點 = Dip 底
  | 'no_quiet_setup' // Dip 前沒有安靜段
  | 'set_point_fallback' // 找不到肘屈曲極大，改用手腕上升速度最小點
  | 'set_point_undetermined' // 無法決定 Set Point，取 Rise 中點
  | 'follow_through_truncated' // Follow-through 到上限仍未結束
  | 'follow_through_gap'; // Follow-through 期間資料中斷

export interface ShotEvents {
  setupStart: number;
  dipStart: number;
  dipBottom: number;
  setPoint: number;
  release: number;
  followThroughEnd: number;
}

export interface Shot {
  index: number;
  events: ShotEvents;
  phases: Phase[];
  /** 偵測依據（供報告與除錯）。 */
  evidence: {
    releaseWristHeightRatio: number;
    releaseProminenceRatio: number;
    maxRiseSpeedRatioPerS: number;
    elbowFlexionAtReleaseDeg: number;
    wristValidRatio: number;
    elbowValidRatio: number;
  };
  issues: ShotIssue[];
  readable: boolean;
}

export type SegmentationFailure =
  | 'no_body_scale' // 無法估計身高
  | 'wrist_unreadable' // 投籃側手腕幾乎沒有有效幀
  | 'no_release_candidates' // 沒有高於門檻的手腕高度峰值
  | 'candidates_rejected'; // 有峰值但都不符合上升速度/肘伸展條件

export interface SegmentationResult {
  shots: Shot[];
  /** 沒切出任何一球時的原因；有球時為空。 */
  failures: SegmentationFailure[];
  /** 被否決的候選（供除錯）。 */
  rejected: Array<{ index: number; reason: string }>;
  /** 手腕相對肩線高度（身高比）序列，供時間軸顯示。 */
  wristHeightRatio: number[];
}

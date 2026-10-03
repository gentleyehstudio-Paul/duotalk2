import type { JointName } from '../pose/joints';

/**
 * 步驟 2 的輸出：由 PoseTrack + thresholds 決定性地推導出來的「處理後序列」。
 * 不存進 IndexedDB（調整參數後可直接重算），只在記憶體使用，因此缺值以 NaN 表示。
 * 所有陣列長度相同，索引 i 對應 frames[i] / t_ms[i]。
 */
export interface ProcessedJoint {
  /** 平滑後的像素座標；缺值為 NaN。 */
  x: number[];
  y: number[];
  /** 原始（未平滑）像素座標；缺值為 NaN。供圖表對照。 */
  rawX: number[];
  rawY: number[];
  /** 該幀此關節是否有效（偵測到且 visibility ≥ minVisibility）。 */
  valid: boolean[];
  /** 速度（px/s）、速率、加速度（px/s²）；跨缺口不計算，為 NaN。 */
  vx: number[];
  vy: number[];
  speed: number[];
  ax: number[];
  ay: number[];
}

export const ANGLE_NAMES = [
  'knee_left',
  'knee_right',
  'hip_left',
  'hip_right',
  'elbow_left',
  'elbow_right',
  'shoulder_left',
  'shoulder_right',
  'trunk_lean',
] as const;
export type AngleName = (typeof ANGLE_NAMES)[number];

export interface AngleSeries {
  /**
   * 角度（度）。
   * - knee / hip / elbow：屈曲量 = 180 − 內角（0 = 伸直，越大越彎）。
   * - shoulder：抬臂角 = 髖–肩–肘內角（手臂貼身 ≈ 0，高舉過頭 ≈ 180）。
   * - trunk_lean：相對鉛直線的前傾角，正值 = 向面向方向前傾。
   */
  deg: number[];
  /** 角速度（deg/s）；跨缺口為 NaN。 */
  vel: number[];
  valid: boolean[];
}

export type Side = 'left' | 'right';

export interface ProcessedTrack {
  frames: number[];
  t_ms: number[];
  fps: number;
  width: number;
  height: number;
  joints: Record<JointName, ProcessedJoint>;
  angles: Record<AngleName, AngleSeries>;
  /** 投籃手側與判定依據。 */
  shootingSide: Side;
  shootingSideSource: 'config' | 'auto' | 'auto_uncertain';
  /** 射手面向畫面的左或右；由鼻子相對肩膀中點的位置多數決。 */
  facing: Side | 'unknown';
  /** 估計身高（像素）；所有「相對身高」的量都除以它。無法估計時為 NaN。 */
  bodyHeightPx: number;
  bodyHeightSource: 'nose_ankle' | 'trunk' | 'none';
  /** 整段的有效幀統計。 */
  stats: {
    totalFrames: number;
    undetectedFrames: number;
    undetectedRatio: number;
  };
}

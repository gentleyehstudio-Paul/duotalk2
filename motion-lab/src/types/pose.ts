import type { JointName } from '../pose/joints';

/**
 * 單一關節在單一幀的樣本。
 * - x, y 為正規化座標（0..1，相對於影片寬高）；z 為 MediaPipe 的相對深度。
 * - 該幀「未偵測到人」或「seek 失敗」時 x/y/z 為 null（缺值，不補造）。
 * - visibility 保留原始值；是否低於門檻而視為缺值，由 thresholds.quality.minVisibility 在使用端判斷，
 *   這樣調整門檻不需重新擷取。
 */
export interface JointSample {
  frame: number;
  t_ms: number;
  x: number | null;
  y: number | null;
  z: number | null;
  visibility: number;
}

/** 每個關節一條時間序列（規則 1：所有指標皆由時間序列計算）。 */
export type JointSeries = Record<JointName, JointSample[]>;

export type FrameStatus =
  | 'ok' // 偵測成功
  | 'no_pose' // 畫面中沒有偵測到人
  | 'seek_failed' // 影片無法定位到該幀
  | 'duplicate'; // 連續拿到相同畫面（已跳過，不計入序列）

export interface FrameRecord {
  frame: number;
  t_ms: number;
  status: FrameStatus;
  /** 瀏覽器實際呈現的 mediaTime（秒），用於核對 seek 精度。 */
  mediaTime: number;
}

export interface VideoMeta {
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number;
  /** 量測或推定的 FPS。 */
  fps: number;
  /** FPS 來源：measured = 以 requestVideoFrameCallback 量測；fallback = 使用設定預設值。 */
  fpsSource: 'measured' | 'fallback';
}

export interface JointQuality {
  joint: JointName;
  totalFrames: number;
  detectedFrames: number;
  /** visibility >= minVisibility 的幀數。 */
  validFrames: number;
  validRatio: number;
  meanVisibility: number;
}

export interface PoseTrack {
  schemaVersion: 1;
  createdAt: string;
  video: VideoMeta;
  /** 實際寫入序列的幀數（不含 duplicate）。 */
  frameCount: number;
  frames: FrameRecord[];
  series: JointSeries;
  /** 擷取所用的參數快照，方便日後追溯。 */
  extraction: {
    frameStride: number;
    minVisibility: number;
    modelPath: string;
    delegate: 'GPU' | 'CPU';
  };
}

/**
 * 模型與 WASM 的位置。非分析門檻，但集中管理方便替換模型。
 * scripts/prepare-assets.mjs 會把檔案放到對應的 public 路徑。
 */
export const assets = {
  /** MediaPipe WASM 執行環境目錄（相對於站台根目錄）。 */
  wasmBasePath: '/wasm',
  /** 本地模型檔路徑（離線 PWA 用）。 */
  poseModelLocalPath: '/models/pose_landmarker_full.task',
  /** 本地檔不存在時的備援下載位置。 */
  poseModelFallbackUrl:
    'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  /** WASM 的備援 CDN（本地 /wasm 不存在時使用）。 */
  wasmFallbackBasePath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm',
} as const;

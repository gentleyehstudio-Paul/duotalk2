/**
 * MOTION LAB — 所有可調參數集中於此檔（以及 rules/rules.yaml）。
 * 程式其他地方不得寫死數字；調整數值請直接改這裡。
 *
 * 每個欄位都附上「用途」說明。步驟 1（影片載入與逐幀姿態擷取）用到的區塊：
 * input / pose / extraction / quality。後續步驟會在此檔新增區塊。
 */

export const thresholds = {
  /** 影片輸入限制（規則 1：只接受影片，不接受單張圖片）。 */
  input: {
    /** 允許的 MIME type。瀏覽器對 .mov 可能回報 video/quicktime 或空字串，因此也以副檔名判斷。 */
    acceptedMimeTypes: ['video/mp4', 'video/quicktime'] as readonly string[],
    /** 允許的副檔名（小寫，不含點）。 */
    acceptedExtensions: ['mp4', 'mov', 'm4v'] as readonly string[],
    /** 單段影片最長秒數；超過會拒絕，避免瀏覽器記憶體爆掉。 */
    maxDurationSeconds: 600,
    /** 單段影片最短秒數；短於此值不可能含完整投籃動作。 */
    minDurationSeconds: 1,
  },

  /** MediaPipe PoseLandmarker 的推論參數。 */
  pose: {
    /** 只追蹤一個人（側拍單一射手）。 */
    numPoses: 1,
    /** 人體偵測最低信心；低於此值該幀視為「未偵測」。 */
    minPoseDetectionConfidence: 0.5,
    /** 姿勢存在最低信心。 */
    minPosePresenceConfidence: 0.5,
    /** 幀間追蹤最低信心；低於此值會重新偵測。 */
    minTrackingConfidence: 0.5,
    /** 推論裝置。'GPU' 較快；若裝置不支援會自動退回 'CPU'。 */
    delegate: 'GPU' as 'GPU' | 'CPU',
  },

  /** 逐幀擷取流程參數。 */
  extraction: {
    /** 無法從影片量測 FPS 時使用的預設值。 */
    fallbackFps: 30,
    /** 量測 FPS 時播放取樣的秒數。 */
    fpsSampleSeconds: 2,
    /** 量測 FPS 至少需要的 presented frame 數，不足則用 fallbackFps。 */
    fpsSampleMinFrames: 8,
    /** 允許的 FPS 範圍，量測結果超出範圍視為異常並改用 fallbackFps。 */
    fpsMin: 10,
    fpsMax: 240,
    /** 每隔幾幀取一幀；1 = 逐幀（規則 1 要求完整處理，請勿為了加速而放大）。 */
    frameStride: 1,
    /** seek 時加在目標時間上的微小偏移（秒），避免落在兩幀邊界而取到前一幀。 */
    seekEpsilonSeconds: 0.0005,
    /** 等待一次 seek 完成的逾時毫秒數，超過視為該幀讀取失敗（記為缺值）。 */
    seekTimeoutMs: 3000,
    /** 同一時間點重複拿到相同畫面時，最多再往後微調幾次。 */
    maxDuplicateRetries: 3,
    /** 進度回報頻率（每幾幀回報一次）。 */
    progressEveryFrames: 5,
  },

  /** 投籃切分與樣本數（步驟 3 / 6 會使用；先在此記錄產品決定）。 */
  shots: {
    /** 一個 Session 至少要切出幾球才能進入分析。產品決定：1 段影片投 1 球即可分析。 */
    minShotsPerSession: 1,
    /** 計算一致性（CV）至少需要幾球；不足時報告需在「無法判讀」中明列「球數不足，無法計算一致性」，而不是不產生報告。 */
    minShotsForConsistency: 3,
  },

  /** 骨架資料品質門檻。 */
  quality: {
    /** 單一關節 visibility 低於此值的幀視為「缺值」，後續不得用來計算（不補造）。 */
    minVisibility: 0.5,
    /** 單一關節有效幀比例低於此值，整段影片該關節視為「無法判讀」。 */
    minValidFrameRatio: 0.6,
    /** 整段影片未偵測到人的幀比例高於此值，整段影片視為機位/畫面不符。 */
    maxUndetectedFrameRatio: 0.3,
  },
} as const;

export type Thresholds = typeof thresholds;

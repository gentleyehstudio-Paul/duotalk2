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

  /**
   * 步驟 2：平滑（One Euro Filter）。在 0..1 正規化座標上濾波，再轉成像素，
   * 因此參數與影片解析度無關。缺值幀不送進濾波器、也不輸出任何值（不補造）。
   */
  smoothing: {
    /**
     * 最低截止頻率（Hz）。越低越平滑但快速動作的峰值會被削弱、時間點會延後。
     * 開發期量測（合成 0.3 s 下蹲、30 fps、2 px 抖動）：1.5 Hz → 膝最大屈曲少 8°、靜止抖動 0.5°；
     * 3 Hz → 少 4.5°、抖動 0.7°；5 Hz → 少 3.4°、抖動 0.9°。預設取 3 作為平衡點。
     */
    minCutoffHz: 3,
    /** 速度係數。越大代表快速移動時越少平滑（降低動作延遲）；0 = 固定截止頻率。 */
    beta: 0.3,
    /** 速度估計用的截止頻率（Hz）。 */
    derivativeCutoffHz: 1.0,
    /** 連續缺值超過幾幀後濾波器狀態重設（避免用很久以前的位置去拉現在的點）。 */
    resetAfterGapFrames: 3,
  },

  /** 步驟 2：速度 / 加速度與角度序列。 */
  derivatives: {
    /** 計算差分時，相鄰兩個有效樣本的幀距最多允許幾幀；超過視為跨越缺口，不計算。 */
    maxGapFrames: 1,
  },

  /** 步驟 2：投籃側與面向判定。 */
  side: {
    /** 投籃手：'auto' 依手腕/手肘平均 visibility 較高的一側；也可強制 'left' / 'right'。 */
    shootingSide: 'auto' as 'auto' | 'left' | 'right',
    /** auto 判定時兩側 visibility 差距小於此值視為無法判定（報告列入無法判讀，預設取 right）。 */
    minSideVisibilityGap: 0.05,
    /** 面向判定：鼻子 x 相對肩膀中點 x 的偏移需超過肩寬的此比例，該幀才投票。 */
    facingMinNoseOffsetRatio: 0.1,
  },

  /** 步驟 3：身高尺度估計（所有「相對身高」的量都除以這個像素值）。 */
  bodyScale: {
    /** 鼻子到腳踝的距離約佔身高的比例，用來把量到的像素距離換算成身高。 */
    noseToAnkleStatureRatio: 0.87,
    /** 估身高至少需要幾個有效幀（鼻子與腳踝同時有效）。 */
    minValidFrames: 10,
    /** 備援：鼻子/腳踝不可用時，用肩中點到髖中點的軀幹長度換算，軀幹約佔身高的比例。 */
    trunkToStatureRatio: 0.3,
  },

  /** 步驟 3：投籃切分（找 Release）與六階段切分。長度單位「身高比」= 像素 / 估計身高像素。 */
  segmentation: {
    /** Release 候選：投籃側手腕高於肩線至少幾個身高比。 */
    minReleaseHeightRatio: 0.15,
    /** Release 候選：手腕高度峰值的 prominence（相對左右谷底的高度差）至少幾個身高比。 */
    minReleaseProminenceRatio: 0.12,
    /** 兩次出手最短間隔（毫秒）；距離更近的峰值只保留較高者。 */
    minShotIntervalMs: 1500,
    /** 從 Release 往前看幾毫秒內，要有一段向上的手腕速度（確認是出手而不是舉手）。 */
    riseWindowMs: 1500,
    /** 上升段手腕向上速度峰值至少幾個身高比/秒。 */
    minRiseSpeedRatioPerS: 0.5,
    /** 上升段到手腕高度峰值之間允許的最長連續缺值幀數；超過則無法確認峰值是由這段上升到達，候選否決。 */
    maxGapFramesInRise: 5,
    /** Release 時刻 = 從手腕高度峰值往回找，最後一次由上升（速度 > 此值，身高比/秒）轉為停止的那一幀。 */
    releaseUpSpeedRatioPerS: 0.15,
    /** Release 時肘屈曲量不得大於此值（度；0 = 完全伸直）。 */
    maxElbowFlexionAtReleaseDeg: 50,
    /** 從 Release 往前搜尋 Dip 底與 Dip 起點的視窗（毫秒）。 */
    dipSearchWindowMs: 2500,
    /** Dip 起點（膝）：膝屈曲量比視窗內最伸直的基準多出此度數即視為開始下蹲。 */
    dipOnsetKneeFlexionDeg: 5,
    /** Dip 起點（手腕）：手腕比下蹲前的高度降低此身高比即視為開始下沉。 */
    dipOnsetWristDropRatio: 0.03,
    /** Dip 起點由門檻偵測到後，最多往前回溯幾毫秒找到動作真正開始（前一幀仍安靜）的那一幀。 */
    dipOnsetBacktrackMaxMs: 300,
    /** Setup 往前最多延伸幾毫秒。 */
    setupMaxMs: 1000,
    /** Setup 安靜判定的回看視窗（毫秒）：在這段時間內手腕與膝的「位移範圍」都很小才算安靜。 */
    setupQuietWindowMs: 150,
    /** Setup 安靜判定：視窗內手腕 x 或 y 的範圍（最大−最小）低於此身高比。 */
    setupQuietWristRangeRatio: 0.02,
    /** Setup 安靜判定：視窗內膝屈曲範圍低於此度數。 */
    setupQuietKneeRangeDeg: 6,
    /** Set Point：Release 前最後一次肘屈曲局部極大，且屈曲量至少此度數。 */
    minSetPointElbowFlexionDeg: 45,
    /** Set Point 必須比 Release 早至少幾毫秒。 */
    minSetPointToReleaseMs: 50,
    /** Follow-through 結束：手腕比 Release 高度下降此身高比。 */
    followThroughEndWristDropRatio: 0.05,
    /** Follow-through 結束：肘屈曲量比 Release 時增加此度數（手臂收回）。 */
    followThroughEndElbowFlexionDeg: 20,
    /** Follow-through 最長（毫秒）；超過即截斷並標記。 */
    followThroughMaxMs: 1500,
    /** 一球範圍內投籃側手腕與手肘的有效幀比例低於此值 → 該球標為無法判讀。 */
    minValidRatioInShot: 0.7,
  },

  /** 步驟 4：指標計算與個人基準。 */
  metrics: {
    /** 區間型指標（如膝最大屈曲）要求區間內有效幀比例至少此值，否則該指標標為無法判讀。 */
    minWindowValidRatio: 0.7,
    /** 事件型指標（如 Set Point 肘屈曲）允許在事件幀前後最多幾幀內取最近的有效值。 */
    eventValueSearchFrames: 2,
    /** 地面參考：以該球 Setup 區間內較低腳踝 y 的中位數當地面；Setup 太短時改用整段影片。 */
    groundMinSetupFrames: 3,
  },
  baseline: {
    /** 形成個人基準至少需要幾球（跨先前 Session 累計）。 */
    minShots: 5,
    /** 偏離幅度以「標準差倍數」表示時，基準標準差至少需要多少（避免除以接近 0 的 sd）；以各指標單位計。 */
    minBaselineSd: {
      deg: 1,
      ms: 10,
      ratio: 0.01,
    } as Record<'deg' | 'ms' | 'ratio', number>,
  },

  /** 顯示相關（規則 1：關鍵時刻一律附帶前後 ±N 幀的動態片段）。 */
  display: {
    /** 顯示 Release 等關鍵時刻時，前後各帶幾幀一起循環播放。 */
    eventContextFrames: 8,
    /** 關鍵時刻片段循環播放的每幀停留毫秒數。 */
    eventClipFrameIntervalMs: 120,
    /** 步驟 5：播放器可選的播放速度倍率。 */
    playbackRates: [0.25, 0.5, 1] as readonly number[],
    /** 步驟 5：預設播放速度倍率。 */
    defaultPlaybackRate: 0.5,
    /** 步驟 5：關節軌跡尾跡顯示最近幾幀的路徑。 */
    trailFrames: 24,
    /** 步驟 5：要畫軌跡的關節（投籃側），對應 wrist / elbow / hip。 */
    trailJoints: ['wrist', 'elbow', 'hip'] as readonly ('wrist' | 'elbow' | 'hip')[],
    /** 步驟 5：播放時 React 介面（幀號、游標）最短更新間隔（毫秒）；Canvas 骨架仍每個呈現幀更新。 */
    playbackCursorMinIntervalMs: 80,
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

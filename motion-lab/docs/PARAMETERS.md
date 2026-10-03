# 可調參數清單

所有門檻值集中在 `src/config/thresholds.ts`（之後加上 `rules/rules.yaml`）。程式內不寫死數字。
本表隨每個步驟更新；數值由你自行調整，程式不會自動修改。

## 步驟 1：影片載入與逐幀姿態擷取

| 參數 | 檔案位置 | 預設值 | 用途 |
| --- | --- | --- | --- |
| `input.acceptedMimeTypes` | `src/config/thresholds.ts` | `['video/mp4','video/quicktime']` | 允許的影片 MIME（規則 1：只收影片） |
| `input.acceptedExtensions` | `src/config/thresholds.ts` | `['mp4','mov','m4v']` | 允許的副檔名（.mov 在部分瀏覽器 MIME 為空，靠此判斷） |
| `input.maxDurationSeconds` | `src/config/thresholds.ts` | `600` | 影片長度上限，避免記憶體不足 |
| `input.minDurationSeconds` | `src/config/thresholds.ts` | `1` | 影片長度下限 |
| `pose.numPoses` | `src/config/thresholds.ts` | `1` | 只追蹤一位射手 |
| `pose.minPoseDetectionConfidence` | `src/config/thresholds.ts` | `0.5` | 人體偵測最低信心，低於則該幀視為未偵測 |
| `pose.minPosePresenceConfidence` | `src/config/thresholds.ts` | `0.5` | 姿勢存在最低信心 |
| `pose.minTrackingConfidence` | `src/config/thresholds.ts` | `0.5` | 幀間追蹤最低信心，低於則重新偵測 |
| `pose.delegate` | `src/config/thresholds.ts` | `'GPU'` | 推論裝置；GPU 失敗自動退回 CPU |
| `extraction.fallbackFps` | `src/config/thresholds.ts` | `30` | 無法量測 FPS 時的預設值 |
| `extraction.fpsSampleSeconds` | `src/config/thresholds.ts` | `2` | 量測 FPS 時實際播放的秒數 |
| `extraction.fpsSampleMinFrames` | `src/config/thresholds.ts` | `8` | 量測 FPS 至少需要的幀數 |
| `extraction.fpsMin` / `fpsMax` | `src/config/thresholds.ts` | `10` / `240` | 量測結果合理範圍，超出改用 fallbackFps |
| `extraction.frameStride` | `src/config/thresholds.ts` | `1` | 每隔幾幀取一幀；1 = 逐幀（規則 1 要求完整處理） |
| `extraction.seekEpsilonSeconds` | `src/config/thresholds.ts` | `0.0005` | seek 目標時間的微小偏移，避免落在幀邊界 |
| `extraction.seekTimeoutMs` | `src/config/thresholds.ts` | `3000` | 單次 seek 逾時，超過記為 seek_failed（缺值） |
| `extraction.maxDuplicateRetries` | `src/config/thresholds.ts` | `3` | 拿到重複畫面時往後微調重試的次數 |
| `extraction.progressEveryFrames` | `src/config/thresholds.ts` | `5` | 進度回報頻率 |
| `shots.minShotsPerSession` | `src/config/thresholds.ts` | `1` | 一段影片至少要有幾球才分析（產品決定：1 球即可） |
| `shots.minShotsForConsistency` | `src/config/thresholds.ts` | `3` | 計算一致性 CV 的最少球數；不足時列入「無法判讀」 |
| `quality.minVisibility` | `src/config/thresholds.ts` | `0.5` | 關節 visibility 低於此值的幀視為缺值 |
| `quality.minValidFrameRatio` | `src/config/thresholds.ts` | `0.6` | 關節有效幀比例低於此值 → 該關節「無法判讀」 |
| `quality.maxUndetectedFrameRatio` | `src/config/thresholds.ts` | `0.3` | 未偵測到人的幀比例高於此值 → 整段視為機位不符 |

非門檻的資產位置（模型、WASM、CDN 備援）在 `src/config/assets.ts`。

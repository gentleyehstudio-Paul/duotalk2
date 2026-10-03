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

## 步驟 2：時間序列與平滑

| 參數 | 檔案位置 | 預設值 | 用途 |
| --- | --- | --- | --- |
| `smoothing.minCutoffHz` | `src/config/thresholds.ts` | `1.5` | One Euro 最低截止頻率；越低越平滑、靜止時抖動越少，但延遲越大 |
| `smoothing.beta` | `src/config/thresholds.ts` | `0.3` | 速度係數；越大快速動作越不被平滑（延遲越小）。在 0..1 正規化座標上運作，與解析度無關 |
| `smoothing.derivativeCutoffHz` | `src/config/thresholds.ts` | `1.0` | 速度估計的截止頻率 |
| `smoothing.resetAfterGapFrames` | `src/config/thresholds.ts` | `3` | 連續缺值超過此幀數後濾波器重設，缺口後第一個樣本原樣輸出 |
| `derivatives.maxGapFrames` | `src/config/thresholds.ts` | `1` | 差分時相鄰有效樣本最多允許的幀距；超過視為缺口不計算 |
| `side.shootingSide` | `src/config/thresholds.ts` | `'auto'` | 投籃手：auto 取手腕/手肘平均 visibility 高的一側，或強制 left / right |
| `side.minSideVisibilityGap` | `src/config/thresholds.ts` | `0.05` | auto 時兩側差距小於此值標為「不確定」（報告列入無法判讀） |
| `side.facingMinNoseOffsetRatio` | `src/config/thresholds.ts` | `0.1` | 面向多數決：鼻子相對肩中點的偏移需超過軀幹尺度的此比例才投票 |

觀察（合成三球資料，30 fps）：`smoothing.beta` 影響 Release 時刻的系統性延遲。beta 0.3 → 晚 3 幀（約 100 ms）；
beta 1–2 → 晚 2 幀；beta 5–10 → 晚 1 幀。Dip 底、Set Point、Dip 起點在各 beta 下都在 ±1 幀內。
延遲在不同 Session 間一致，不影響比較；若要縮小絕對偏差可自行調高 beta（代價是靜止時抖動略多）。

缺值政策（規則 1）：visibility 低於 `quality.minVisibility` 或未偵測的幀，座標、速度、角度一律為缺值（NaN），
不做任何插補；曲線在缺值處中斷。

## 步驟 3：身高尺度、投籃與階段切分、顯示

| 參數 | 檔案位置 | 預設值 | 用途 |
| --- | --- | --- | --- |
| `bodyScale.noseToAnkleStatureRatio` | `src/config/thresholds.ts` | `0.87` | 鼻–踝距離佔身高比例，用來把像素換算成「身高比」 |
| `bodyScale.minValidFrames` | `src/config/thresholds.ts` | `10` | 估身高至少需要的有效幀數 |
| `bodyScale.trunkToStatureRatio` | `src/config/thresholds.ts` | `0.3` | 備援：軀幹長度佔身高比例 |
| `segmentation.minReleaseHeightRatio` | `src/config/thresholds.ts` | `0.15` | Release 候選：手腕高於肩線至少幾個身高比 |
| `segmentation.minReleaseProminenceRatio` | `src/config/thresholds.ts` | `0.12` | Release 候選：手腕高度峰值 prominence 下限 |
| `segmentation.minShotIntervalMs` | `src/config/thresholds.ts` | `1500` | 兩球最短間隔；更近的峰值只留較高者 |
| `segmentation.riseWindowMs` | `src/config/thresholds.ts` | `1500` | 往前找上升段的視窗 |
| `segmentation.minRiseSpeedRatioPerS` | `src/config/thresholds.ts` | `0.5` | 上升段手腕向上速度峰值下限（身高比/秒） |
| `segmentation.releaseUpSpeedRatioPerS` | `src/config/thresholds.ts` | `0.15` | Release 時刻 = 上升速度峰值後，向上速度第一次低於此值的幀 |
| `segmentation.maxElbowFlexionAtReleaseDeg` | `src/config/thresholds.ts` | `50` | Release 時肘屈曲量上限，超過視為非出手 |
| `segmentation.dipSearchWindowMs` | `src/config/thresholds.ts` | `2500` | 往前找 Dip 底／起點的視窗 |
| `segmentation.dipOnsetKneeFlexionDeg` | `src/config/thresholds.ts` | `5` | 膝屈曲比基準多此度數即視為開始下蹲 |
| `segmentation.dipOnsetWristDropRatio` | `src/config/thresholds.ts` | `0.03` | 手腕比下沉前低此身高比即視為開始下沉 |
| `segmentation.dipOnsetBacktrackMaxMs` | `src/config/thresholds.ts` | `300` | Dip 起點往前回溯到真正開始動的上限 |
| `segmentation.setupMaxMs` | `src/config/thresholds.ts` | `1000` | Setup 往前最多延伸 |
| `segmentation.setupQuietWristSpeedRatioPerS` | `src/config/thresholds.ts` | `0.15` | Setup 安靜：手腕速率上限 |
| `segmentation.setupQuietKneeVelDegPerS` | `src/config/thresholds.ts` | `20` | Setup 安靜：膝角速度上限 |
| `segmentation.minSetPointElbowFlexionDeg` | `src/config/thresholds.ts` | `45` | Set Point：肘屈曲局部極大至少此度數 |
| `segmentation.minSetPointToReleaseMs` | `src/config/thresholds.ts` | `50` | Set Point 至少比 Release 早此毫秒 |
| `segmentation.followThroughEndWristDropRatio` | `src/config/thresholds.ts` | `0.05` | Follow-through 結束：手腕下降此身高比 |
| `segmentation.followThroughEndElbowFlexionDeg` | `src/config/thresholds.ts` | `20` | Follow-through 結束：肘屈曲比 Release 增加此度數 |
| `segmentation.followThroughMaxMs` | `src/config/thresholds.ts` | `1500` | Follow-through 上限，超過截斷並標記 |
| `segmentation.minValidRatioInShot` | `src/config/thresholds.ts` | `0.7` | 一球內手腕/手肘有效幀比例下限，否則該球「無法判讀」 |
| `display.eventContextFrames` | `src/config/thresholds.ts` | `8` | 關鍵時刻（Release 等）顯示時前後各帶幾幀循環播放（±N） |
| `display.eventClipFrameIntervalMs` | `src/config/thresholds.ts` | `120` | 關鍵時刻片段每幀停留毫秒 |

階段定義（全部為時序事件）：Setup = Dip 起點前的安靜段；Dip = 起點 → 手腕最低；Rise = 手腕最低 → Set Point；
Set Point = Release 前最後一次肘屈曲局部極大 → Release；Release = 上升速度峰值後手腕停止上升的那一幀；
Follow-through = Release → 手腕下降或手臂收回。

非門檻的資產位置（模型、WASM、CDN 備援）在 `src/config/assets.ts`。

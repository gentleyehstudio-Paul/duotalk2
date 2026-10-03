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
| `smoothing.minCutoffHz` | `src/config/thresholds.ts` | `3`（步驟 4 由 1.5 調整） | One Euro 最低截止頻率；越低越平滑、靜止時抖動越少，但快速動作峰值被削弱、時間點延後 |
| `smoothing.beta` | `src/config/thresholds.ts` | `0.3` | 速度係數；越大快速動作越不被平滑（延遲越小）。在 0..1 正規化座標上運作，與解析度無關 |
| `smoothing.derivativeCutoffHz` | `src/config/thresholds.ts` | `1.0` | 速度估計的截止頻率 |
| `smoothing.resetAfterGapFrames` | `src/config/thresholds.ts` | `3` | 連續缺值超過此幀數後濾波器重設，缺口後第一個樣本原樣輸出 |
| `derivatives.maxGapFrames` | `src/config/thresholds.ts` | `1` | 差分時相鄰有效樣本最多允許的幀距；超過視為缺口不計算 |
| `side.shootingSide` | `src/config/thresholds.ts` | `'auto'` | 投籃手：auto 取手腕/手肘平均 visibility 高的一側，或強制 left / right |
| `side.minSideVisibilityGap` | `src/config/thresholds.ts` | `0.05` | auto 時兩側差距小於此值標為「不確定」（報告列入無法判讀） |
| `side.facingMinNoseOffsetRatio` | `src/config/thresholds.ts` | `0.1` | 面向多數決：鼻子相對肩中點的偏移需超過軀幹尺度的此比例才投票 |

開發期量測（合成資料，30 fps，0.3 s 下蹲，膝真值 40°）：

| minCutoffHz | beta | 膝最大屈曲（真值 40） | Release 延遲 | 靜止抖動（2 px 雜訊） |
| --- | --- | --- | --- | --- |
| 1.5 | 0.3 | 32.4° | +3 幀 | 0.47° |
| 1.5 | 1 | 33.2° | +2 幀 | 0.47° |
| 3 | 0.3 | 35.5° | +2 幀 | 0.71° |
| 3 | 1 | 35.7° | +2 幀 | 0.71° |
| 5 | 0.3 | 37.0° | +1 幀 | 0.91° |

平滑會削弱快速動作的峰值並延後事件時刻；偏差在各 Session 間一致，不影響比較。
步驟 4 把 `minCutoffHz` 預設由 1.5 改為 3 作為平衡點（真實下蹲通常比 0.3 s 慢，削弱會更小）。要更接近真值可再調高，代價是抖動增加。

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
| `segmentation.maxGapFramesInRise` | `src/config/thresholds.ts` | `5` | 上升段到峰值間允許的最長連續缺值幀數，超過則候選否決 |
| `segmentation.releaseUpSpeedRatioPerS` | `src/config/thresholds.ts` | `0.15` | Release 時刻 = 上升速度峰值後，向上速度第一次低於此值的幀 |
| `segmentation.maxElbowFlexionAtReleaseDeg` | `src/config/thresholds.ts` | `50` | Release 時肘屈曲量上限，超過視為非出手 |
| `segmentation.dipSearchWindowMs` | `src/config/thresholds.ts` | `2500` | 往前找 Dip 底／起點的視窗 |
| `segmentation.dipOnsetKneeFlexionDeg` | `src/config/thresholds.ts` | `5` | 膝屈曲比基準多此度數即視為開始下蹲 |
| `segmentation.dipOnsetWristDropRatio` | `src/config/thresholds.ts` | `0.03` | 手腕比下沉前低此身高比即視為開始下沉 |
| `segmentation.dipOnsetBacktrackMaxMs` | `src/config/thresholds.ts` | `300` | Dip 起點往前回溯到真正開始動的上限 |
| `segmentation.setupMaxMs` | `src/config/thresholds.ts` | `1000` | Setup 往前最多延伸 |
| `segmentation.setupQuietWindowMs` | `src/config/thresholds.ts` | `150` | Setup 安靜判定的回看視窗 |
| `segmentation.setupQuietWristRangeRatio` | `src/config/thresholds.ts` | `0.02` | 視窗內手腕位移範圍上限（身高比）；用範圍而非速度，抗抖動 |
| `segmentation.setupQuietKneeRangeDeg` | `src/config/thresholds.ts` | `6` | 視窗內膝屈曲範圍上限（度） |
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

## 步驟 5：動態骨架播放器

| 參數 | 檔案位置 | 預設值 | 用途 |
| --- | --- | --- | --- |
| `display.playbackRates` | `src/config/thresholds.ts` | `[0.25, 0.5, 1]` | 播放器可選速度倍率 |
| `display.defaultPlaybackRate` | `src/config/thresholds.ts` | `0.5` | 預設播放倍率 |
| `display.trailFrames` | `src/config/thresholds.ts` | `24` | 關節軌跡尾跡顯示最近幾幀 |
| `display.trailJoints` | `src/config/thresholds.ts` | `['wrist','elbow','hip']` | 畫軌跡的投籃側關節 |
| `display.playbackCursorMinIntervalMs` | `src/config/thresholds.ts` | `80` | 播放時 React 介面（幀號、游標）最短更新間隔；Canvas 骨架仍每幀更新 |

## 步驟 4：指標與個人基準

| 參數 | 檔案位置 | 預設值 | 用途 |
| --- | --- | --- | --- |
| `metrics.minWindowValidRatio` | `src/config/thresholds.ts` | `0.7` | 區間型指標（膝最大屈曲）區間內有效幀比例下限，否則無法判讀 |
| `metrics.eventValueSearchFrames` | `src/config/thresholds.ts` | `2` | 事件型指標在事件幀前後最多幾幀內取最近有效值 |
| `metrics.groundMinSetupFrames` | `src/config/thresholds.ts` | `3` | 以該球 Setup 定地面所需的最少幀數，不足改用整段影片 |
| `baseline.minShots` | `src/config/thresholds.ts` | `5` | 形成個人基準至少需要的球數（跨先前 Session 累計） |
| `baseline.minBaselineSd.deg / ms / ratio` | `src/config/thresholds.ts` | `1 / 10 / 0.01` | 基準 SD 低於此值時不以「SD 倍數」表示偏離（只給差值） |
| `shots.minShotsForConsistency`（已列） | `src/config/thresholds.ts` | `3` | 計算 CV 的最少球數 |

指標定義（`src/metrics/definitions.ts`）：

| 指標 | 單位 | 來源 |
| --- | --- | --- |
| 膝最大屈曲 | ° | Dip 起點 → Release 區間膝屈曲最大值（原「膝屈最小角」，以屈曲量呈現） |
| Set Point 肘屈曲 | ° | Set Point 事件幀的肘屈曲 |
| 出手高度（相對身高） | ×身高 | (地面 y − Release 手腕 y) ÷ 身高；地面 = 該球 Setup 的較低腳踝 y 中位數 |
| Dip → Release 時間 | ms | Dip 底 → Release |
| 膝伸展 → 肘伸展時間差 | ms | 膝最大屈曲幀 → Set Point 幀；正值 = 肘在膝之後開始伸展 |
| 軀幹前傾角（Release） | ° | Release 幀軀幹相對鉛直線傾角，正值 = 向面向方向前傾 |
| Follow-through 停留時間 | ms | Release → Follow-through 結束 |

非門檻的資產位置（模型、WASM、CDN 備援）在 `src/config/assets.ts`。

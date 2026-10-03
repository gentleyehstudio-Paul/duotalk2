# MOTION LAB — Form Shooting（V1 PWA）

個人投籃動作研究工具。單一固定側拍影片 → 逐幀骨架時間序列 → 關節角度 / 位移 / 時序 → Session 比較 → 觀察、Cue、Drill、Retest。
訓練循環：Measure → Compare → Adjust → Retest。

三條硬性規則：

1. 影片是唯一分析來源，禁止單幀判斷（只收 mp4/mov，逐幀處理，所有指標來自時間序列）。
2. 動態骨架圖分析（骨架逐幀同步、軌跡、角度曲線連動、階段時間軸、Release 對齊比較）。
3. 輸出重點整理與建議，不打總分（規則引擎產生，條件不成立不輸出）。

## 開發進度

| 步驟 | 內容 | 狀態 |
| --- | --- | --- |
| 1 | 影片載入與逐幀姿態擷取 | ✅ 完成 |
| 2 | 時間序列與平滑（One Euro Filter、缺值、像素座標、速度/加速度、角度序列、投籃側/面向） | ✅ 完成 |
| 3 | 投籃與階段切分（Release 事件偵測、六階段、單球/多球、無法判讀原因） | ✅ 完成 |
| 4 | 指標計算（7 項首批指標、Session 彙總、CV、個人基準與偏離） | ✅ 完成 |
| 5 | 動態骨架播放器（逐幀同步、慢放、軌跡、階段時間軸、角度曲線連動） | ✅ 完成 |
| 6 | 規則引擎與報告（rules.yaml、重點整理、最多 2 條建議、無法判讀、Finding / Experiment / Retest） | ✅ 完成 |
| 7 | Session 比較 | ⏳ |

產品決定：**一段影片投一球即可分析**（`thresholds.shots.minShotsPerSession = 1`）。多球影片仍會自動切分每一球；
球數不足以計算一致性（CV）時，報告會在「無法判讀」中明列，而不是拒絕分析。

## 執行

```bash
cd motion-lab
npm install        # 會自動複製 MediaPipe WASM 到 public/wasm，並下載 pose_landmarker_full.task 到 public/models
npm run dev        # http://localhost:5173
npm test           # 單元測試（vitest）
npm run build      # 產出 PWA（dist/）
```

若 `npm install` 時無法下載模型，App 會在執行期退回從 MediaPipe CDN 載入；要完全離線請手動把
`pose_landmarker_full.task` 放到 `public/models/`。

## 目錄

```
src/config/thresholds.ts   所有可調數值（唯一來源）
src/config/assets.ts       模型 / WASM 路徑
src/types/pose.ts          PoseTrack / JointSample 等資料結構
src/pose/joints.ts         33 關節名稱、骨架連線
src/pose/landmarker.ts     MediaPipe PoseLandmarker 初始化（VIDEO 模式、GPU→CPU 退回）
src/pose/extractPoseTrack.ts 主流程：FPS 量測 → 幀計畫 → 逐幀 seek + detectForVideo → PoseTrack
src/video/loadVideo.ts     檔案驗證（只收影片）與載入
src/video/fps.ts           FPS 量測（rVFC）與中位數估計
src/video/frameStepper.ts  逐幀步進器（seek + 真實 mediaTime 核對、重複幀處理）
src/storage/db.ts          IndexedDB（sessions / shots / findings / experiments）
src/types/series.ts        ProcessedTrack / ProcessedJoint / AngleSeries（步驟 2 輸出，記憶體內、NaN = 缺值）
src/processing/oneEuro.ts  One Euro Filter 與含缺值序列的平滑（缺口後重設）
src/processing/derivatives.ts 差分（中央/單側，跨缺口不計算）
src/processing/angles.ts   三點內角、相對鉛直傾角
src/processing/side.ts     投籃側（visibility）與面向（鼻子 vs 肩中點）判定
src/processing/processTrack.ts 步驟 2 主流程：遮罩 → 平滑 → 像素 → 速度/加速度 → 角度序列
src/ui/SeriesPanel.tsx     原始 vs 平滑曲線、角度曲線（Recharts），點擊跳幀
src/types/shot.ts          Shot / Phase / 事件 / 無法切分原因
src/segmentation/peaks.ts  含缺值序列的峰值與 prominence、最小間隔抑制
src/segmentation/segmentShots.ts 步驟 3 主流程：手腕高度峰值 → Release 事件 → Dip/Setup/Set Point/Follow-through
src/testutils/syntheticShot.ts 合成投籃骨架（測試用，含 ground truth）
src/ui/ShotTimeline.tsx    階段時間軸、每球表格、Release ±N 幀循環片段
src/types/metrics.ts       MetricValue / ShotMetrics / SessionMetricsSummary / Baseline
src/metrics/definitions.ts 七個指標的名稱、單位、來源與說明
src/metrics/computeShotMetrics.ts 每球指標計算（缺值 → null + 原因）
src/metrics/summary.ts     Session 彙總（平均/SD/CV）、個人基準、偏離
src/ui/MetricsPanel.tsx    指標表（每球、平均、一致性、基準、偏離；點數值播 ±N 幀）
src/ui/player/Player.tsx   動態骨架播放器（Canvas 疊圖、控制列、階段時間軸、角度曲線）
src/ui/player/usePlayback.ts 播放邏輯：影片 rVFC 逐幀同步 / 無影片以經過時間推進 / ±N 循環
src/ui/player/drawSkeleton.ts 骨架與軌跡尾跡繪製、mediaTime → 幀索引
src/ui/player/AngleCurves.tsx 膝/髖/肘/肩四張小圖，階段色帶 + Release 線，點擊跳幀
src/ui/player/CursorOverlay.tsx 不重繪圖表的 DOM 時間游標
rules/rules.yaml           建議規則（條件 + Observation / Cue / Drill / Retest 文字）
src/rules/loadRules.ts     YAML 解析與驗證（未知指標、缺欄位、禁用詞 → 直接報錯）
src/rules/engine.ts        規則評估、報告組裝（重點整理 / 建議 / 無法判讀）、Markdown 輸出、禁用詞守門
src/types/report.ts        Rule / RuleEvaluation / Recommendation / Highlight / Report
src/ui/ReportPanel.tsx     報告面板、開始實驗、記錄 Retest、規則評估明細
src/ui/                    React UI（步驟 1：上傳、進度、品質摘要、逐幀核對）
docs/PARAMETERS.md         可調參數清單（位置、預設值、用途）
```

## 資料結構（步驟 1 產出）

`PoseTrack`：

- `video`：檔名、寬高、長度、fps（量測或預設）。
- `frames[]`：每幀 `{frame, t_ms, status, mediaTime}`，status ∈ ok / no_pose / seek_failed / duplicate。
- `series[jointName][]`：每個關節一條時間序列 `{frame, t_ms, x, y, z, visibility}`；x/y 為 0..1 正規化座標；
  未偵測到人或 seek 失敗的幀 x/y/z 為 `null`（缺值，不補造）。
- `extraction`：擷取時的 stride、minVisibility、模型路徑、推論裝置快照。

存入 IndexedDB 的只有這份 JSON；原始影片由使用者自行保留。

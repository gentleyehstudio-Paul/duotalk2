import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { thresholds } from '../config/thresholds';
import { extractPoseTrack, summarizeQuality, type ExtractionProgress } from '../pose/extractPoseTrack';
import { processTrack } from '../processing/processTrack';
import { segmentShots } from '../segmentation/segmentShots';
import { computeShotMetrics } from '../metrics/computeShotMetrics';
import { computeBaseline, summarizeSession } from '../metrics/summary';
import { listAllShots } from '../storage/db';
import type { Baseline } from '../types/metrics';
import { MetricsPanel } from './MetricsPanel';
import type { EventLoop } from './ShotTimeline';
import { deleteSession, getSession, listExperiments, listSessions, recordRetest, saveSession, startExperiment, type ExperimentRecord } from '../storage/db';
import { buildReport } from '../rules/engine';
import { getRules } from '../rules/rulesSource';
import type { Recommendation, Report } from '../types/report';
import { ReportPanel } from './ReportPanel';
import { ComparePanel, type SessionOption } from './compare/ComparePanel';
import type { JointQuality, PoseTrack } from '../types/pose';
import { loadVideoFile, type LoadedVideo } from '../video/loadVideo';
import { Player } from './player/Player';
import { SeriesPanel } from './SeriesPanel';

type SessionSummary = Awaited<ReturnType<typeof listSessions>>[number];

export function App() {
  const [loaded, setLoaded] = useState<LoadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExtractionProgress | null>(null);
  const [track, setTrack] = useState<PoseTrack | null>(null);
  const [quality, setQuality] = useState<JointQuality[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // 步驟 2：由 PoseTrack + thresholds 決定性地推導（遮罩、平滑、像素、導數、角度）。不存 DB，調參後即時重算。
  const processed = useMemo(() => (track ? processTrack(track) : null), [track]);
  // 步驟 3：由時間序列事件切出每一球與六個階段。
  const segmentation = useMemo(() => (processed ? segmentShots(processed) : null), [processed]);
  // 步驟 4：每球七個指標、Session 彙總、個人基準（先前已儲存的球）。
  const shotMetrics = useMemo(
    () => (processed && segmentation ? segmentation.shots.map((s) => computeShotMetrics(processed, s)) : []),
    [processed, segmentation],
  );
  const summary = useMemo(() => summarizeSession(shotMetrics), [shotMetrics]);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [eventLoop, setEventLoop] = useState<EventLoop | null>(null);
  const [priorShotCount, setPriorShotCount] = useState(0);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  useEffect(() => {
    listAllShots()
      .then((rows) => {
        const prior = rows.filter((r) => r.sessionId !== savedId);
        setPriorShotCount(prior.length);
        setBaseline(computeBaseline(rows.map((r) => ({ sessionId: r.sessionId, metrics: r.metrics })), savedId ?? undefined));
      })
      .catch(() => setBaseline(null));
    listExperiments().then(setExperiments).catch(() => setExperiments([]));
  }, [savedId, sessions]);

  // 步驟 6：規則引擎 → 報告（規則檔有誤時顯示錯誤而不是靜默略過）。
  const [report, reportError] = useMemo<[Report | null, string | null]>(() => {
    if (!processed || !segmentation) return [null, null];
    try {
      return [buildReport({ rules: getRules(), processed, segmentation, shotMetrics, summary, baseline, priorShotCount }), null];
    } catch (err) {
      return [null, (err as Error).message];
    }
  }, [processed, segmentation, shotMetrics, summary, baseline, priorShotCount]);

  const sessionName = track ? track.video.fileName.replace(/\.[^.]+$/, '') : '';
  const onStartExperiment = async (rec: Recommendation) => {
    await startExperiment({
      ruleId: rec.ruleId,
      metric: rec.metric,
      cue: rec.cue,
      drill: rec.drill,
      target: rec.retest.target,
      startValue: rec.values.current,
      startSessionId: savedId,
    });
    setExperiments(await listExperiments());
  };
  const onRecordRetest = async (exp: ExperimentRecord) => {
    const v = summary[exp.metric].mean;
    if (v === null) return;
    await recordRetest(exp.id, v, savedId);
    setExperiments(await listExperiments());
  };
  useEffect(() => {
    setFrameIndex(0);
    setEventLoop(null);
  }, [track]);

  const refreshSessions = useCallback(() => {
    listSessions().then(setSessions).catch(() => setSessions([]));
  }, []);
  useEffect(refreshSessions, [refreshSessions]);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setTrack(null);
    setQuality(null);
    setSavedId(null);
    setProgress(null);
    loaded?.revoke();
    try {
      const lv = await loadVideoFile(file);
      setLoaded(lv);
    } catch (err) {
      setLoaded(null);
      setError((err as Error).message);
    }
  };

  const start = async () => {
    if (!loaded) return;
    setError(null);
    setTrack(null);
    setQuality(null);
    setSavedId(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const t = await extractPoseTrack(loaded, { onProgress: setProgress, signal: ac.signal });
      setTrack(t);
      setQuality(summarizeQuality(t.series));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      abortRef.current = null;
    }
  };

  const save = async () => {
    if (!track) return;
    const rec = await saveSession(
      track.video.fileName.replace(/\.[^.]+$/, ''),
      track,
      (segmentation?.shots ?? []).map((shot, i) => ({ shot, metrics: shotMetrics[i]! })),
      (report?.evaluations ?? []).filter((e) => e.triggered).map((e) => ({ ruleId: e.ruleId, metric: e.metric, values: e.values })),
    );
    setSavedId(rec.id);
    refreshSessions();
  };

  const exportJson = () => {
    if (!track) return;
    const blob = new Blob([JSON.stringify(track)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${track.video.fileName.replace(/\.[^.]+$/, '')}.posetrack.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** 匯入先前匯出的 PoseTrack JSON（沒有原始影片時仍可檢視序列、切分與報告）。 */
  const onImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as PoseTrack;
      if (parsed.schemaVersion !== 1 || !parsed.series?.nose) throw new Error('不是有效的 PoseTrack JSON（schemaVersion 1）。');
      loaded?.revoke();
      setLoaded(null);
      setProgress(null);
      setSavedId(null);
      setTrack(parsed);
      setQuality(summarizeQuality(parsed.series));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadSaved = async (id: string) => {
    const rec = await getSession(id);
    if (!rec) return;
    setTrack(rec.track);
    setQuality(summarizeQuality(rec.track.series));
    setSavedId(rec.id);
  };

  const busy = progress !== null && progress.phase !== 'done' && !error && !track;

  // 步驟 7：比較用的 Session 選項 = 已儲存的 Session + 目前未儲存的分析。
  const [tab, setTab] = useState<'analyze' | 'compare'>('analyze');
  const compareOptions = useMemo<SessionOption[]>(() => {
    const saved = sessions.map((s) => ({ id: s.id, name: s.name }));
    if (track && !savedId) return [{ id: '__current__', name: `目前分析（未儲存）：${sessionName}`, track }, ...saved];
    return saved;
  }, [sessions, track, savedId, sessionName]);

  return (
    <div className="app">
      <header className="top">
        <h1>MOTION LAB</h1>
        <span className="sub">Form Shooting · Measure → Compare → Adjust → Retest</span>
        <nav className="tabs">
          <button className={tab === 'analyze' ? '' : 'secondary'} onClick={() => setTab('analyze')} data-testid="tab-analyze">
            分析
          </button>
          <button className={tab === 'compare' ? '' : 'secondary'} onClick={() => setTab('compare')} data-testid="tab-compare">
            Session 比較
          </button>
        </nav>
      </header>

      {tab === 'compare' && (
        <section className="panel">
          <h2>Session 比較（兩球以 Release 對齊 · 並排同步播放 · 角度曲線疊圖 · 指標並列）</h2>
          <ComparePanel options={compareOptions} />
        </section>
      )}

      <div hidden={tab === 'compare'}>
      <section className="panel">
        <h2>1. 選擇側拍影片（mp4 / mov；影片不會上傳，全程在瀏覽器處理）</h2>
        <div className="row">
          <input type="file" accept=".mp4,.mov,.m4v,video/mp4,video/quicktime" onChange={onFile} disabled={busy} />
          <button onClick={start} disabled={!loaded || busy}>
            開始逐幀擷取
          </button>
          {busy && (
            <button className="secondary" onClick={() => abortRef.current?.abort()}>
              中止
            </button>
          )}
          <label className="note" style={{ marginLeft: 'auto' }}>
            或匯入 PoseTrack JSON{' '}
            <input type="file" accept=".json,application/json" onChange={onImportJson} disabled={busy} data-testid="import-json" />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        {loaded && (
          <div className="meta" style={{ marginTop: 12 }}>
            <div>
              <span>檔名</span>
              <br />
              <b>{loaded.file.name}</b>
            </div>
            <div>
              <span>解析度</span>
              <br />
              <b>
                {loaded.width} × {loaded.height}
              </b>
            </div>
            <div>
              <span>長度</span>
              <br />
              <b>{(loaded.durationMs / 1000).toFixed(2)} s</b>
            </div>
            <div>
              <span>大小</span>
              <br />
              <b>{(loaded.file.size / 1024 / 1024).toFixed(1)} MB</b>
            </div>
          </div>
        )}
      </section>

      {progress && (
        <section className="panel">
          <h2>2. 擷取進度</h2>
          <ProgressView p={progress} />
        </section>
      )}

      {track && quality && (
        <>
          <section className="panel">
            <h2>3. 時間序列品質摘要（visibility ≥ {thresholds.quality.minVisibility} 視為有效幀）</h2>
            <div className="meta" style={{ marginBottom: 12 }}>
              <div>
                <span>FPS</span>
                <br />
                <b>
                  {track.video.fps} <small className="note">({track.video.fpsSource === 'measured' ? '量測' : '預設值'})</small>
                </b>
              </div>
              <div>
                <span>序列幀數</span>
                <br />
                <b>{track.frameCount}</b>
              </div>
              <div>
                <span>未偵測到人</span>
                <br />
                <b>{track.frames.filter((f) => f.status === 'no_pose').length}</b>
              </div>
              <div>
                <span>seek 失敗 / 重複幀</span>
                <br />
                <b>
                  {track.frames.filter((f) => f.status === 'seek_failed').length} /{' '}
                  {track.frames.filter((f) => f.status === 'duplicate').length}
                </b>
              </div>
              <div>
                <span>推論</span>
                <br />
                <b>{track.extraction.delegate}</b>
              </div>
            </div>
            <QualityTable rows={quality} />
            <div className="row" style={{ marginTop: 12 }}>
              <button onClick={save} disabled={!!savedId}>
                {savedId ? '已存入 IndexedDB' : '存入 IndexedDB'}
              </button>
              <button className="secondary" onClick={exportJson}>
                匯出 PoseTrack JSON
              </button>
            </div>
          </section>

          {processed && (
            <section className="panel">
              <h2>
                4. 動態骨架播放器（空白鍵播放/暫停 · ←/→ 逐幀 · 慢放 · 軌跡 · 階段時間軸 · 角度曲線點擊跳幀）
                {segmentation && (
                  <span className="note" style={{ marginLeft: 10 }}>
                    {segmentation.shots.length} 球 · 身高尺度{' '}
                    {Number.isNaN(processed.bodyHeightPx) ? '無法估計' : `${processed.bodyHeightPx.toFixed(0)} px / ${processed.bodyHeightSource}`}
                  </span>
                )}
              </h2>
              {!loaded && <p className="note">沒有原始影片（JSON 匯入或 IndexedDB 載入），播放器只顯示骨架；重新選擇同一支影片即可疊圖。</p>}
              <Player
                processed={processed}
                segmentation={segmentation}
                video={loaded?.element ?? null}
                frameIndex={frameIndex}
                setFrameIndex={setFrameIndex}
                loop={eventLoop}
                setLoop={setEventLoop}
              />
            </section>
          )}

          {segmentation && segmentation.shots.length > 0 && (
            <section className="panel">
              <h2>5. 指標（每球 × 7 項 · 不打總分）</h2>
              <MetricsPanel shots={shotMetrics} summary={summary} baseline={baseline} onShowEvent={(i) => setEventLoop({ center: i })} />
            </section>
          )}

          {(report || reportError) && (
            <section className="panel">
              <h2>6. 報告（重點整理 · 建議 · 無法判讀 · 不打總分）</h2>
              {reportError && <p className="error">規則檔或報告產生錯誤：{reportError}</p>}
              {report && (
                <ReportPanel
                  report={report}
                  sessionName={sessionName}
                  onShowEvent={(i) => setEventLoop({ center: i })}
                  onStartExperiment={onStartExperiment}
                  openExperiments={experiments.filter((e) => !e.retest)}
                  onRecordRetest={onRecordRetest}
                  currentValueFor={(m) => summary[m].mean}
                />
              )}
            </section>
          )}

          {processed && (
            <section className="panel">
              <h2>
                7. 診斷：原始 vs 平滑（One Euro：minCutoff {thresholds.smoothing.minCutoffHz} Hz · β {thresholds.smoothing.beta}
                ）· 點擊曲線跳到該幀
              </h2>
              <div className="meta" style={{ marginBottom: 8 }}>
                <div>
                  <span>投籃側</span>
                  <br />
                  <b>
                    {processed.shootingSide}{' '}
                    <small className="note">
                      ({processed.shootingSideSource === 'config' ? '設定' : processed.shootingSideSource === 'auto' ? '自動' : '自動・不確定'})
                    </small>
                  </b>
                </div>
                <div>
                  <span>面向</span>
                  <br />
                  <b>{processed.facing}</b>
                </div>
                <div>
                  <span>未偵測幀比例</span>
                  <br />
                  <b>
                    {(processed.stats.undetectedRatio * 100).toFixed(1)}%{' '}
                    {processed.stats.undetectedRatio > thresholds.quality.maxUndetectedFrameRatio && (
                      <span className="tag bad">超過上限，整段視為機位不符</span>
                    )}
                  </b>
                </div>
              </div>
              <SeriesPanel processed={processed} frameIndex={frameIndex} onSeek={setFrameIndex} />
            </section>
          )}
        </>
      )}

      <section className="panel">
        <h2>已儲存的 Session（只存骨架 JSON，不含影片）</h2>
        {sessions.length === 0 ? (
          <p className="note">尚無資料。</p>
        ) : (
          <ul className="sessions" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {sessions.map((s) => (
              <li key={s.id}>
                <b>{s.name}</b>
                <span>{s.fileName}</span>
                <span>{s.frameCount} 幀</span>
                <span>{new Date(s.createdAt).toLocaleString()}</span>
                <button className="secondary" onClick={() => loadSaved(s.id)}>
                  載入
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    if (confirm(`刪除「${s.name}」？`)) deleteSession(s.id).then(refreshSessions);
                  }}
                >
                  刪除
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      </div>
    </div>
  );
}

function ProgressView({ p }: { p: ExtractionProgress }) {
  const label: Record<ExtractionProgress['phase'], string> = {
    loading_model: '載入 PoseLandmarker 模型…',
    measuring_fps: '量測影片 FPS…',
    extracting: '逐幀擷取中',
    done: '完成',
  };
  const pct = p.totalFrames ? (p.frame / p.totalFrames) * 100 : 0;
  return (
    <div>
      <div className="row">
        <b>{label[p.phase]}</b>
        {p.phase === 'extracting' && (
          <span className="note">
            {p.frame} / {p.totalFrames} 幀 · {p.fps} fps · 已用 {(p.elapsedMs / 1000).toFixed(0)}s · 預估剩餘{' '}
            {(p.etaMs / 1000).toFixed(0)}s
          </span>
        )}
      </div>
      <div className="progress">
        <div style={{ width: `${pct}%` }} />
      </div>
      <span className="note">
        偵測 {p.detected} · 無人 {p.noPose} · seek 失敗 {p.seekFailed} · 重複 {p.duplicates}
      </span>
    </div>
  );
}

function QualityTable({ rows }: { rows: JointQuality[] }) {
  const minRatio = thresholds.quality.minValidFrameRatio;
  return (
    <table className="quality">
      <thead>
        <tr>
          <th>關節</th>
          <th>有效幀 / 總幀</th>
          <th>有效比例</th>
          <th>平均 visibility</th>
          <th>狀態</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const cls = r.validRatio >= minRatio ? 'ok' : r.validRatio >= minRatio / 2 ? 'warn' : 'bad';
          return (
            <tr key={r.joint}>
              <td>
                <code>{r.joint}</code>
              </td>
              <td>
                {r.validFrames} / {r.totalFrames}
              </td>
              <td>{(r.validRatio * 100).toFixed(1)}%</td>
              <td>{r.meanVisibility.toFixed(2)}</td>
              <td>
                <span className={`tag ${cls}`}>{cls === 'ok' ? '可用' : cls === 'warn' ? '偏低' : '無法判讀'}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

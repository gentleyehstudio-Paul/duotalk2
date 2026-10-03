import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alignedRange, frameAtTau, phaseAtTau, tauOfFrame, type AlignedSide } from '../../compare/align';
import { thresholds } from '../../config/thresholds';
import { computeShotMetrics } from '../../metrics/computeShotMetrics';
import { formatMetric, METRIC_DEFINITIONS } from '../../metrics/definitions';
import { summarizeSession } from '../../metrics/summary';
import { processTrack } from '../../processing/processTrack';
import { segmentShots } from '../../segmentation/segmentShots';
import { getSession } from '../../storage/db';
import { METRIC_IDS } from '../../types/metrics';
import type { PoseTrack } from '../../types/pose';
import { loadVideoFile, type LoadedVideo } from '../../video/loadVideo';
import { chartColors } from '../chartColors';
import { drawSkeleton } from '../player/drawSkeleton';
import { seekVideoToIndex } from '../player/usePlayback';
import { phaseColor } from '../ShotTimeline';
import { OverlayCurves } from './OverlayCurves';

export interface SessionOption {
  id: string;
  name: string;
  /** 目前尚未儲存的分析（若有）直接提供 track。 */
  track?: PoseTrack;
}

interface Props {
  options: SessionOption[];
}

interface LoadedSide {
  id: string;
  name: string;
  track: PoseTrack;
  processed: ReturnType<typeof processTrack>;
  segmentation: ReturnType<typeof segmentShots>;
}

/**
 * 步驟 7：Session 比較。兩球以 Release 對齊（τ = 0），共用主時鐘並排同步播放；
 * 每側可附加原始影片疊圖（未附加則顯示骨架）；角度曲線在 τ 軸上疊圖；指標並列列出差值。
 */
export function ComparePanel({ options }: Props) {
  const [idA, setIdA] = useState<string>('');
  const [idB, setIdB] = useState<string>('');
  const [sideA, setSideA] = useState<LoadedSide | null>(null);
  const [sideB, setSideB] = useState<LoadedSide | null>(null);
  const [shotA, setShotA] = useState(0);
  const [shotB, setShotB] = useState(0);
  const [videoA, setVideoA] = useState<LoadedVideo | null>(null);
  const [videoB, setVideoB] = useState<LoadedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 預設：A = 第一個選項，B = 第二個
  useEffect(() => {
    if (!idA && options[0]) setIdA(options[0].id);
    if (!idB && options[1]) setIdB(options[1].id);
  }, [options, idA, idB]);

  const loadSide = useCallback(
    async (id: string, set: (s: LoadedSide | null) => void) => {
      if (!id) return set(null);
      const opt = options.find((o) => o.id === id);
      let track = opt?.track;
      let name = opt?.name ?? id;
      if (!track) {
        const rec = await getSession(id);
        if (!rec) return set(null);
        track = rec.track;
        name = rec.name;
      }
      const processed = processTrack(track);
      set({ id, name, track, processed, segmentation: segmentShots(processed) });
    },
    [options],
  );
  useEffect(() => {
    loadSide(idA, setSideA).catch((e) => setError((e as Error).message));
    setShotA(0);
  }, [idA, loadSide]);
  useEffect(() => {
    loadSide(idB, setSideB).catch((e) => setError((e as Error).message));
    setShotB(0);
  }, [idB, loadSide]);

  const aligned = useMemo<[AlignedSide, AlignedSide] | null>(() => {
    const sa = sideA?.segmentation.shots[shotA];
    const sb = sideB?.segmentation.shots[shotB];
    if (!sideA || !sideB || !sa || !sb) return null;
    return [
      { processed: sideA.processed, shot: sa },
      { processed: sideB.processed, shot: sb },
    ];
  }, [sideA, sideB, shotA, shotB]);

  const metricsA = useMemo(() => (sideA ? summarizeSession(sideA.segmentation.shots.map((s) => computeShotMetrics(sideA.processed, s))) : null), [sideA]);
  const metricsB = useMemo(() => (sideB ? summarizeSession(sideB.segmentation.shots.map((s) => computeShotMetrics(sideB.processed, s))) : null), [sideB]);
  const shotMetricA = useMemo(() => (aligned ? computeShotMetrics(aligned[0].processed, aligned[0].shot) : null), [aligned]);
  const shotMetricB = useMemo(() => (aligned ? computeShotMetrics(aligned[1].processed, aligned[1].shot) : null), [aligned]);

  const attachVideo = async (file: File | undefined, side: LoadedSide | null, set: (v: LoadedVideo | null) => void) => {
    if (!file || !side) return;
    setError(null);
    try {
      const lv = await loadVideoFile(file);
      if (Math.abs(lv.durationMs - side.track.video.durationMs) > 500 || lv.width !== side.track.video.width) {
        lv.revoke();
        throw new Error(`影片與 Session「${side.name}」不符（長度 ${(lv.durationMs / 1000).toFixed(2)}s / ${lv.width}px，Session 為 ${(side.track.video.durationMs / 1000).toFixed(2)}s / ${side.track.video.width}px）。`);
      }
      set(lv);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const picker = (label: string, id: string, setId: (v: string) => void, side: LoadedSide | null, shot: number, setShot: (i: number) => void, setVideo: (v: LoadedVideo | null) => void, testid: string) => (
    <div className="compare-side-ctl">
      <b>{label}</b>{' '}
      <select value={id} onChange={(e) => setId(e.target.value)} data-testid={`${testid}-session`}>
        <option value="">（選擇 Session）</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>{' '}
      {side && (
        <>
          球{' '}
          <select value={shot} onChange={(e) => setShot(Number(e.target.value))} data-testid={`${testid}-shot`}>
            {side.segmentation.shots.map((s) => (
              <option key={s.index} value={s.index}>
                #{s.index + 1}
              </option>
            ))}
          </select>
          {side.segmentation.shots.length === 0 && <span className="error"> 此 Session 沒有切出任何一球</span>}{' '}
          <label className="note">
            附加原始影片 <input type="file" accept=".mp4,.mov,.m4v,video/mp4,video/quicktime" onChange={(e) => attachVideo(e.target.files?.[0], side, setVideo)} />
          </label>
        </>
      )}
    </div>
  );

  return (
    <div>
      <div className="row" style={{ gap: 24, marginBottom: 10 }}>
        {picker('A', idA, setIdA, sideA, shotA, setShotA, setVideoA, 'a')}
        {picker('B', idB, setIdB, sideB, shotB, setShotB, setVideoB, 'b')}
      </div>
      {error && <p className="error">{error}</p>}
      {options.length < 2 && <p className="note">需要至少兩個 Session（可先把目前分析存入 IndexedDB）。</p>}
      {aligned && sideA && sideB && (
        <>
          <AlignedPlayer a={aligned[0]} b={aligned[1]} nameA={sideA.name} nameB={sideB.name} videoA={videoA?.element ?? null} videoB={videoB?.element ?? null} />
          <h3 className="sub-h">指標（所選球 · Session 平均）</h3>
          <table className="quality metrics">
            <thead>
              <tr>
                <th>指標</th>
                <th>A 這一球</th>
                <th>B 這一球</th>
                <th>差（B − A）</th>
                <th>A Session 平均</th>
                <th>B Session 平均</th>
              </tr>
            </thead>
            <tbody>
              {METRIC_IDS.map((id) => {
                const va = shotMetricA?.values[id];
                const vb = shotMetricB?.values[id];
                const d = METRIC_DEFINITIONS[id];
                const diff = va?.value != null && vb?.value != null ? vb.value - va.value : null;
                const fmtMean = (m: typeof metricsA) => (m && m[id].mean !== null ? `${formatMetric(id, m[id].mean)}${m[id].sd !== null && m[id].n > 1 ? ` ± ${m[id].sd!.toFixed(d.decimals)}` : ''} (n=${m[id].n})` : '—');
                return (
                  <tr key={id}>
                    <td>
                      <b>{d.name}</b>
                    </td>
                    <td>{va?.value == null ? <span className="tag bad" title={va?.reason}>無法判讀</span> : formatMetric(id, va.value)}</td>
                    <td>{vb?.value == null ? <span className="tag bad" title={vb?.reason}>無法判讀</span> : formatMetric(id, vb.value)}</td>
                    <td>{diff === null ? '—' : `${diff >= 0 ? '+' : ''}${formatMetric(id, diff)}`}</td>
                    <td className="note">{fmtMean(metricsA)}</td>
                    <td className="note">{fmtMean(metricsB)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

interface PlayerProps {
  a: AlignedSide;
  b: AlignedSide;
  nameA: string;
  nameB: string;
  videoA: HTMLVideoElement | null;
  videoB: HTMLVideoElement | null;
}

function AlignedPlayer({ a, b, nameA, nameB, videoA, videoB }: PlayerProps) {
  const range = useMemo(() => alignedRange(a, b), [a, b]);
  const [tau, setTau] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(thresholds.display.defaultPlaybackRate);
  const canvasA = useRef<HTMLCanvasElement>(null);
  const canvasB = useRef<HTMLCanvasElement>(null);
  const tauRef = useRef(0);
  tauRef.current = tau;
  const token = useRef(0);

  // Release 對齊後重設到 τ = 0
  useEffect(() => {
    setTau(0);
    setPlaying(false);
  }, [a, b]);

  const paintSide = useCallback(async (side: AlignedSide, canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, label: string, t: number, myToken: number) => {
    if (!canvas) return;
    const p = side.processed;
    if (canvas.width !== p.width || canvas.height !== p.height) {
      canvas.width = p.width;
      canvas.height = p.height;
    }
    const idx = frameAtTau(side, t);
    if (video && idx !== null) {
      await seekVideoToIndex(video, p, idx);
      if (myToken !== token.current) return;
    }
    const ctx = canvas.getContext('2d')!;
    if (video && idx !== null) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const fs = Math.max(12, Math.round(canvas.width / 50));
    ctx.font = `${fs}px -apple-system, Segoe UI, sans-serif`;
    if (idx === null) {
      ctx.fillStyle = '#9a98a3';
      ctx.fillText(`${label}：此時間不在影片範圍內`, fs, fs * 2);
      return;
    }
    drawSkeleton(ctx, p, idx);
    const ph = phaseAtTau(side, t);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, canvas.width, fs * 1.8);
    ctx.fillStyle = '#e8e6e3';
    ctx.fillText(`${label} · #${idx} · τ ${t >= 0 ? '+' : ''}${Math.round(t)} ms · ${ph ?? '—'}`, fs * 0.5, fs * 1.3);
    if (ph) {
      ctx.fillStyle = phaseColor(ph as never);
      ctx.fillRect(0, fs * 1.8, canvas.width, Math.max(3, fs * 0.3));
    }
  }, []);

  // τ 改變 → 兩側同時重繪
  useEffect(() => {
    const my = ++token.current;
    paintSide(a, canvasA.current, videoA, nameA, tau, my);
    paintSide(b, canvasB.current, videoB, nameB, tau, my);
  }, [tau, a, b, videoA, videoB, nameA, nameB, paintSide]);

  // 主時鐘：以經過時間 × 倍率推進 τ
  useEffect(() => {
    if (!playing) return;
    const start = performance.now();
    const tau0 = tauRef.current >= range.maxMs ? range.minMs : tauRef.current;
    let raf = 0;
    let lastQ = Number.NaN;
    const frame = () => {
      const t = tau0 + (performance.now() - start) * rate;
      if (t >= range.maxMs) {
        setTau(range.maxMs);
        setPlaying(false);
        return;
      }
      const q = Math.round(t / range.stepMs) * range.stepMs;
      if (q !== lastQ) {
        lastQ = q;
        setTau(q);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, rate, range]);

  const step = (d: number) => {
    setPlaying(false);
    setTau((t) => Math.min(range.maxMs, Math.max(range.minMs, t + d * range.stepMs)));
  };

  const releaseTauA = tauOfFrame(a, a.shot.events.release);
  const releaseTauB = tauOfFrame(b, b.shot.events.release);

  return (
    <div>
      <div className="compare-grid">
        <div className="viewer">
          <canvas ref={canvasA} data-testid="cmp-canvas-a" />
        </div>
        <div className="viewer">
          <canvas ref={canvasB} data-testid="cmp-canvas-b" />
        </div>
      </div>
      <input
        className="scrub"
        type="range"
        min={range.minMs}
        max={range.maxMs}
        step={range.stepMs}
        value={tau}
        onChange={(e) => {
          setPlaying(false);
          setTau(Number(e.target.value));
        }}
      />
      <div className="row controls">
        <button className="secondary" onClick={() => step(-1)}>
          ◀︎ 幀
        </button>
        <button onClick={() => setPlaying((p) => !p)} data-testid="cmp-play">
          {playing ? '⏸ 暫停' : '▶ 同步播放'}
        </button>
        <button className="secondary" onClick={() => step(1)}>
          幀 ▶︎
        </button>
        <button className="secondary" onClick={() => { setPlaying(false); setTau(0); }}>
          跳到 Release（τ = 0）
        </button>
        <span className="seg">
          {thresholds.display.playbackRates.map((r) => (
            <button key={r} className={rate === r ? '' : 'secondary'} onClick={() => setRate(r)}>
              {r}x
            </button>
          ))}
        </span>
        <span className="note" data-testid="cmp-status">
          τ = {tau >= 0 ? '+' : ''}
          {Math.round(tau)} ms · A 幀 {frameAtTau(a, tau) ?? '—'} · B 幀 {frameAtTau(b, tau) ?? '—'} · 範圍 {Math.round(range.minMs)} … +{Math.round(range.maxMs)} ms
          {(releaseTauA !== 0 || releaseTauB !== 0) && ' · 對齊異常'}
        </span>
      </div>
      <div className="row note" style={{ gap: 14, marginTop: 4 }}>
        <span>
          <i className="swatch" style={{ background: chartColors.series[0] }} /> A {nameA} · 球 #{a.shot.index + 1}
        </span>
        <span>
          <i className="swatch" style={{ background: chartColors.series[1] }} /> B {nameB} · 球 #{b.shot.index + 1}
        </span>
        <span>紅線 = Release（τ = 0）</span>
      </div>
      <div style={{ marginTop: 10 }}>
        <OverlayCurves a={a} b={b} range={range} tau={tau} onSeek={(t) => { setPlaying(false); setTau(t); }} />
      </div>
    </div>
  );
}

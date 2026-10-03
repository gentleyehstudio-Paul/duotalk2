import { useEffect, useRef } from 'react';
import { thresholds } from '../config/thresholds';
import { JOINT_NAMES, SKELETON_CONNECTIONS } from '../pose/joints';
import type { PoseTrack } from '../types/pose';
import { waitForEvent } from '../video/fps';

interface Props {
  video: HTMLVideoElement;
  track: PoseTrack;
  /** 受控的目前幀索引（由 App 持有，與曲線面板共用）。 */
  index: number;
  onIndexChange: (index: number) => void;
}

/**
 * 步驟 1 的驗證用檢視器：把某一幀的影片畫面與該幀儲存的骨架疊在同一張 Canvas。
 * 完整的動態骨架播放器（播放、慢放、軌跡、角度曲線連動）在步驟 5 實作。
 */
export function FramePreview({ video, track, index, onIndexChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const setIndex = (next: number | ((i: number) => number)) =>
    onIndexChange(typeof next === 'function' ? next(index) : next);
  const total = track.frameCount;
  const minVis = thresholds.quality.minVisibility;

  useEffect(() => {
    let cancelled = false;
    const sample = track.series.nose[index];
    if (!sample) return;
    (async () => {
      video.pause();
      const seeked = waitForEvent(video, 'seeked', thresholds.extraction.seekTimeoutMs).catch(() => undefined);
      video.currentTime = sample.t_ms / 1000 + thresholds.extraction.seekEpsilonSeconds;
      await seeked;
      if (cancelled) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = track.video.width;
      canvas.height = track.video.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      drawSkeleton(ctx, track, index, minVis);
    })();
    return () => {
      cancelled = true;
    };
  }, [index, video, track, minVis]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(total - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total, index, onIndexChange]);

  const s = track.series.nose[index];
  const rec = track.frames.find((f) => f.frame === s?.frame);
  return (
    <div>
      <div className="viewer">
        <canvas ref={canvasRef} />
      </div>
      <input
        className="scrub"
        type="range"
        min={0}
        max={Math.max(0, total - 1)}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
      />
      <div className="row note">
        <span>
          幀 {s?.frame} / {total - 1}
        </span>
        <span>t = {s ? (s.t_ms / 1000).toFixed(3) : '-'} s</span>
        <span>狀態：{rec?.status ?? '-'}</span>
        <span>實際 mediaTime：{rec && Number.isFinite(rec.mediaTime) ? rec.mediaTime.toFixed(3) : '-'} s</span>
        <button className="secondary" onClick={() => setIndex((i) => Math.max(0, i - 1))}>
          ← 上一幀
        </button>
        <button className="secondary" onClick={() => setIndex((i) => Math.min(total - 1, i + 1))}>
          下一幀 →
        </button>
      </div>
    </div>
  );
}

function drawSkeleton(ctx: CanvasRenderingContext2D, track: PoseTrack, index: number, minVis: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pt = (name: (typeof JOINT_NAMES)[number]) => {
    const s = track.series[name][index];
    if (!s || s.x === null || s.y === null) return null;
    return { x: s.x * W, y: s.y * H, vis: s.visibility };
  };
  ctx.lineWidth = Math.max(2, W / 400);
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const pa = pt(a);
    const pb = pt(b);
    if (!pa || !pb) continue;
    const low = pa.vis < minVis || pb.vis < minVis;
    ctx.strokeStyle = low ? 'rgba(248,113,113,0.5)' : 'rgba(217,164,65,0.9)';
    ctx.setLineDash(low ? [6, 6] : []);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const name of JOINT_NAMES) {
    const p = pt(name);
    if (!p) continue;
    ctx.fillStyle = p.vis < minVis ? 'rgba(248,113,113,0.7)' : '#8b5cf6';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(3, W / 300), 0, Math.PI * 2);
    ctx.fill();
  }
}

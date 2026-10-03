import { useCallback, useEffect, useRef } from 'react';
import { thresholds } from '../../config/thresholds';
import type { ProcessedTrack } from '../../types/series';
import type { SegmentationResult } from '../../types/shot';
import { ShotTimeline, type EventLoop } from '../ShotTimeline';
import { AngleCurves } from './AngleCurves';
import { drawSkeleton, trailJointNames } from './drawSkeleton';
import { seekVideoToIndex, usePlayback } from './usePlayback';

interface Props {
  processed: ProcessedTrack;
  segmentation: SegmentationResult | null;
  video: HTMLVideoElement | null;
  frameIndex: number;
  setFrameIndex: (i: number) => void;
  loop: EventLoop | null;
  setLoop: (l: EventLoop | null) => void;
}

/**
 * 步驟 5：動態骨架播放器。
 * 骨架疊在影片上逐幀同步；可暫停、逐幀、0.25x / 0.5x 慢放；顯示手腕/手肘/髖軌跡；
 * 階段時間軸與四條角度曲線都與目前幀連動，點擊即跳幀。
 */
export function Player({ processed, segmentation, video, frameIndex, setFrameIndex, loop, setLoop }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seekToken = useRef(0);

  // 每個呈現幀：直接畫（不經 React state）
  const paint = useCallback(
    (index: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      if (canvas.width !== processed.width || canvas.height !== processed.height) {
        canvas.width = processed.width;
        canvas.height = processed.height;
      }
      if (video) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      drawSkeleton(ctx, processed, index);
      drawHud(ctx, processed, index);
    },
    [processed, video],
  );

  const setLoopCenter = useCallback((c: number | null) => setLoop(c === null ? null : { center: c }), [setLoop]);
  const pb = usePlayback({
    processed,
    video,
    frameIndex,
    setFrameIndex,
    onPresent: paint,
    loopCenter: loop?.center ?? null,
    setLoopCenter,
  });

  // 暫停 / 逐幀 / 循環：frameIndex 改變 → （有影片則 seek）→ 畫
  useEffect(() => {
    if (pb.playing) return;
    const token = ++seekToken.current;
    if (!video) {
      paint(frameIndex);
      return;
    }
    seekVideoToIndex(video, processed, frameIndex).then(() => {
      if (token === seekToken.current) paint(frameIndex);
    });
  }, [frameIndex, pb.playing, video, processed, paint]);

  // 鍵盤：空白鍵播放/暫停，←/→ 逐幀
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        pb.togglePlay();
      } else if (e.key === 'ArrowLeft') pb.step(-1);
      else if (e.key === 'ArrowRight') pb.step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pb]);

  const n = processed.frames.length;
  const t = processed.t_ms[frameIndex] ?? 0;
  const trails = trailJointNames(processed);

  return (
    <div className="player">
      <div className="viewer">
        <canvas ref={canvasRef} data-testid="player-canvas" />
      </div>
      <input className="scrub" type="range" min={0} max={Math.max(0, n - 1)} value={frameIndex} onChange={(e) => pb.seek(Number(e.target.value))} />
      <div className="row controls">
        <button className="secondary" onClick={() => pb.step(-1)} title="上一幀 (←)">
          ◀︎ 幀
        </button>
        <button onClick={pb.togglePlay} title="播放 / 暫停 (空白鍵)" data-testid="play-toggle">
          {pb.playing ? '⏸ 暫停' : '▶ 播放'}
        </button>
        <button className="secondary" onClick={() => pb.step(1)} title="下一幀 (→)">
          幀 ▶︎
        </button>
        <span className="seg">
          {thresholds.display.playbackRates.map((r) => (
            <button key={r} className={pb.rate === r ? '' : 'secondary'} onClick={() => pb.setRate(r)} data-testid={`rate-${r}`}>
              {r}x
            </button>
          ))}
        </span>
        <span className="note">
          幀 {frameIndex} / {n - 1} · t = {(t / 1000).toFixed(3)} s{!video && ' · 無原始影片，僅顯示骨架'}
        </span>
        <span className="note">
          軌跡：
          {trails.map((j) => (
            <code key={j} style={{ marginLeft: 4 }}>
              {j}
            </code>
          ))}
        </span>
      </div>

      {segmentation && (
        <div style={{ marginTop: 10 }}>
          <ShotTimeline processed={processed} result={segmentation} frameIndex={frameIndex} onSeek={pb.seek} loop={loop} setLoop={setLoop} />
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <AngleCurves processed={processed} segmentation={segmentation} frameIndex={frameIndex} onSeek={pb.seek} />
      </div>
    </div>
  );
}

function drawHud(ctx: CanvasRenderingContext2D, p: ProcessedTrack, index: number) {
  const W = ctx.canvas.width;
  const fs = Math.max(12, Math.round(W / 60));
  ctx.font = `${fs}px -apple-system, Segoe UI, sans-serif`;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, fs * 11, fs * 1.6);
  ctx.fillStyle = '#e8e6e3';
  ctx.fillText(`#${index}  ${(p.t_ms[index]! / 1000).toFixed(3)} s`, fs * 0.4, fs * 1.15);
}

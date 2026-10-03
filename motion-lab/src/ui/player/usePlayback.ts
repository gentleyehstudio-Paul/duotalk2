import { useCallback, useEffect, useRef, useState } from 'react';
import { thresholds } from '../../config/thresholds';
import type { ProcessedTrack } from '../../types/series';
import { waitForEvent } from '../../video/fps';
import { indexForTime } from './drawSkeleton';

interface Args {
  processed: ProcessedTrack;
  video: HTMLVideoElement | null;
  frameIndex: number;
  setFrameIndex: (i: number) => void;
  /** 每個呈現幀都會呼叫（Canvas 繪製用），不經 React state。 */
  onPresent: (index: number) => void;
  loopCenter: number | null;
  setLoopCenter: (c: number | null) => void;
}

type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;

/**
 * 播放控制：
 * - 播放（有影片）：video.play() + requestVideoFrameCallback，每個呈現幀以 mediaTime 對應到序列索引 → 逐幀同步。
 * - 播放（無影片，JSON 匯入）：以真實經過時間 × fps × 倍率計算索引（不會因主執行緒忙碌而變慢，只會跳幀，和真實影片一致）。
 * - 暫停 / 逐幀 / ±N 循環：由 frameIndex 驅動，有影片時 seek 到該幀再繪製。
 * React 介面的更新頻率受 display.playbackCursorMinIntervalMs 限制；Canvas 每個呈現幀都畫。
 */
export function usePlayback({ processed, video, frameIndex, setFrameIndex, onPresent, loopCenter, setLoopCenter }: Args) {
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<number>(thresholds.display.defaultPlaybackRate);
  const n = processed.frames.length;
  const playingRef = useRef(false);
  const lastUiUpdate = useRef(0);
  const lastIndexRef = useRef(frameIndex);
  lastIndexRef.current = frameIndex;

  const stop = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    video?.pause();
  }, [video]);

  const present = useCallback(
    (idx: number, force = false) => {
      onPresent(idx);
      const now = performance.now();
      if (force || now - lastUiUpdate.current >= thresholds.display.playbackCursorMinIntervalMs) {
        lastUiUpdate.current = now;
        setFrameIndex(idx);
      }
    },
    [onPresent, setFrameIndex],
  );

  // ── 播放 ──
  useEffect(() => {
    if (!playing) return;
    playingRef.current = true;
    setLoopCenter(null);
    const startIdx = lastIndexRef.current >= n - 1 ? 0 : lastIndexRef.current;

    if (video) {
      const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback;
      const tick = (_now: number, meta: { mediaTime: number }) => {
        if (!playingRef.current) return;
        const idx = indexForTime(processed, meta.mediaTime);
        if (idx >= n - 1 || video.ended) {
          present(idx, true);
          stop();
          return;
        }
        present(idx);
        rvfc!.call(video, tick);
      };
      video.playbackRate = rate;
      video.currentTime = processed.t_ms[startIdx]! / 1000 + thresholds.extraction.seekEpsilonSeconds;
      if (typeof rvfc === 'function') rvfc.call(video, tick);
      video.play().catch(() => stop());
      const onEnded = () => stop();
      video.addEventListener('ended', onEnded);
      return () => {
        video.removeEventListener('ended', onEnded);
        video.pause();
      };
    }

    // 無影片：以經過時間推進
    const t0 = performance.now();
    const base = processed.t_ms[startIdx]!;
    let raf = 0;
    let lastIdx = -1;
    const frame = () => {
      if (!playingRef.current) return;
      const elapsedMs = (performance.now() - t0) * rate;
      const idx = indexForTime(processed, (base + elapsedMs) / 1000);
      if (idx !== lastIdx) {
        lastIdx = idx;
        if (idx >= n - 1) {
          present(idx, true);
          stop();
          return;
        }
        present(idx);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate, video, processed]);

  // ── ±N 循環（暫停狀態下由索引驅動）──
  useEffect(() => {
    if (loopCenter === null) return;
    stop();
    const N = thresholds.display.eventContextFrames;
    const lo = Math.max(0, loopCenter - N);
    const hi = Math.min(n - 1, loopCenter + N);
    let i = lo;
    setFrameIndex(i);
    const id = setInterval(() => {
      i = i >= hi ? lo : i + 1;
      setFrameIndex(i);
    }, thresholds.display.eventClipFrameIntervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopCenter, n]);

  const togglePlay = useCallback(() => {
    if (playing) stop();
    else {
      setLoopCenter(null);
      setPlaying(true);
    }
  }, [playing, stop, setLoopCenter]);

  const step = useCallback(
    (d: number) => {
      stop();
      setLoopCenter(null);
      setFrameIndex(Math.min(n - 1, Math.max(0, lastIndexRef.current + d)));
    },
    [n, stop, setFrameIndex, setLoopCenter],
  );

  const seek = useCallback(
    (i: number) => {
      stop();
      setLoopCenter(null);
      setFrameIndex(Math.min(n - 1, Math.max(0, i)));
    },
    [n, stop, setFrameIndex, setLoopCenter],
  );

  return { playing, rate, setRate, togglePlay, step, seek, stop };
}

/** 暫停狀態：把影片 seek 到某幀並在完成後回呼（供 Canvas 繪製）。 */
export async function seekVideoToIndex(video: HTMLVideoElement, p: ProcessedTrack, index: number): Promise<void> {
  const seeked = waitForEvent(video, 'seeked', thresholds.extraction.seekTimeoutMs).catch(() => undefined);
  video.currentTime = p.t_ms[index]! / 1000 + thresholds.extraction.seekEpsilonSeconds;
  await seeked;
}

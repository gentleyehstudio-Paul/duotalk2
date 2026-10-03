import { thresholds } from '../config/thresholds';

export interface FpsEstimate {
  fps: number;
  source: 'measured' | 'fallback';
  sampleCount: number;
}

/**
 * 由一串 presented-frame 的 mediaTime（秒）估計 FPS：取相鄰差值的中位數。
 * 純函式，便於測試。差值為 0 或負值的樣本會被忽略。
 */
export function fpsFromMediaTimes(mediaTimes: readonly number[]): FpsEstimate {
  const { fpsSampleMinFrames, fallbackFps, fpsMin, fpsMax } = thresholds.extraction;
  const deltas: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i]! - mediaTimes[i - 1]!;
    if (d > 0) deltas.push(d);
  }
  if (deltas.length + 1 < fpsSampleMinFrames) {
    return { fps: fallbackFps, source: 'fallback', sampleCount: mediaTimes.length };
  }
  deltas.sort((a, b) => a - b);
  const mid = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 === 1 ? deltas[mid]! : (deltas[mid - 1]! + deltas[mid]!) / 2;
  const fps = 1 / median;
  if (!Number.isFinite(fps) || fps < fpsMin || fps > fpsMax) {
    return { fps: fallbackFps, source: 'fallback', sampleCount: mediaTimes.length };
  }
  return { fps: snapToCommonFps(fps), source: 'measured', sampleCount: mediaTimes.length };
}

/** 常見標準幀率；量測值在 ±2% 內就吸附，避免 29.97 被算成 29.8 之類。 */
const COMMON_FPS = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 120, 240];
export function snapToCommonFps(fps: number, tolerance = 0.02): number {
  let best: number | null = null;
  let bestErr = Infinity;
  for (const c of COMMON_FPS) {
    const err = Math.abs(fps - c) / c;
    if (err <= tolerance && err < bestErr) {
      best = c;
      bestErr = err;
    }
  }
  return best ?? Math.round(fps * 100) / 100;
}

type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;

/**
 * 以 requestVideoFrameCallback 實際播放一小段影片來量測 FPS。
 * 不支援 rVFC（例如舊版 Firefox）時回傳 fallback。
 */
export async function measureVideoFps(video: HTMLVideoElement): Promise<FpsEstimate> {
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback;
  if (typeof rvfc !== 'function') {
    return { fps: thresholds.extraction.fallbackFps, source: 'fallback', sampleCount: 0 };
  }
  const { fpsSampleSeconds } = thresholds.extraction;
  const times: number[] = [];
  const startAt = 0;
  video.currentTime = startAt;
  await waitForEvent(video, 'seeked', thresholds.extraction.seekTimeoutMs).catch(() => undefined);

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.pause();
      resolve();
    };
    const tick = (_now: number, meta: { mediaTime: number }) => {
      times.push(meta.mediaTime);
      if (meta.mediaTime - startAt >= fpsSampleSeconds || video.ended) {
        finish();
        return;
      }
      rvfc.call(video, tick);
    };
    rvfc.call(video, tick);
    video.playbackRate = 1;
    video.play().catch(() => finish());
    // 保險：取樣時間 × 3 後強制結束
    setTimeout(finish, fpsSampleSeconds * 3000);
  });

  video.currentTime = 0;
  await waitForEvent(video, 'seeked', thresholds.extraction.seekTimeoutMs).catch(() => undefined);
  return fpsFromMediaTimes(times);
}

export function waitForEvent(target: EventTarget, name: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      target.removeEventListener(name, onEvt);
      reject(new Error(`timeout waiting for ${name}`));
    }, timeoutMs);
    const onEvt = () => {
      clearTimeout(timer);
      resolve();
    };
    target.addEventListener(name, onEvt, { once: true });
  });
}

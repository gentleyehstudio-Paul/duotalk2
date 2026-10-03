import { thresholds } from '../config/thresholds';
import { waitForEvent } from './fps';

export interface FramePlanItem {
  frame: number;
  t_ms: number;
}

/**
 * 依 fps 與長度產生要讀取的幀計畫（純函式，可測試）。
 * frame 編號為原始影片幀號（stride > 1 時會跳號），t_ms 為該幀的時間戳。
 */
export function buildFramePlan(
  durationMs: number,
  fps: number,
  stride: number = thresholds.extraction.frameStride,
): FramePlanItem[] {
  if (!(fps > 0) || !(durationMs > 0)) return [];
  const s = Math.max(1, Math.floor(stride));
  const total = Math.max(1, Math.floor((durationMs / 1000) * fps));
  const plan: FramePlanItem[] = [];
  for (let f = 0; f < total; f += s) {
    plan.push({ frame: f, t_ms: Math.round((f / fps) * 1000 * 1000) / 1000 });
  }
  return plan;
}

export interface SteppedFrame extends FramePlanItem {
  /** 瀏覽器實際呈現的 mediaTime（秒）；seek 失敗時為 NaN。 */
  mediaTime: number;
  status: 'ok' | 'seek_failed' | 'duplicate';
}

type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;

/**
 * 逐幀步進器：對每一個計畫幀做 seek，等到畫面真的更新後才交出控制權，
 * 確保後續 detectForVideo 看到的是正確的那一幀。
 *
 * 做法：currentTime = t + epsilon → 等 'seeked' → 若支援 rVFC 再等該幀被 present，取得真實 mediaTime。
 * 若 mediaTime 與上一幀相同（可變幀率或 seek 精度問題），往後微調 epsilon 重試；仍相同則標記 duplicate。
 */
export async function* stepFrames(
  video: HTMLVideoElement,
  plan: readonly FramePlanItem[],
  signal?: AbortSignal,
): AsyncGenerator<SteppedFrame> {
  const { seekEpsilonSeconds, seekTimeoutMs, maxDuplicateRetries } = thresholds.extraction;
  const rvfc = (video as unknown as { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback;
  const hasRvfc = typeof rvfc === 'function';
  video.pause();

  let lastMediaTime = -1;
  for (const item of plan) {
    if (signal?.aborted) return;
    let mediaTime = NaN;
    let status: SteppedFrame['status'] = 'ok';
    const base = item.t_ms / 1000;

    for (let attempt = 0; attempt <= maxDuplicateRetries; attempt++) {
      const target = Math.min(base + seekEpsilonSeconds * (attempt + 1), Math.max(0, video.duration - 1e-4));
      const ok = await seekTo(video, target, seekTimeoutMs, hasRvfc ? rvfc : undefined);
      if (!ok) {
        status = 'seek_failed';
        break;
      }
      mediaTime = ok.mediaTime;
      if (!hasRvfc || mediaTime !== lastMediaTime) break;
      // 同一畫面：往後微調重試
      if (attempt === maxDuplicateRetries) status = 'duplicate';
    }
    if (status === 'ok') lastMediaTime = mediaTime;
    yield { ...item, mediaTime, status };
  }
}

async function seekTo(
  video: HTMLVideoElement,
  targetSeconds: number,
  timeoutMs: number,
  rvfc?: RVFC,
): Promise<{ mediaTime: number } | null> {
  try {
    if (rvfc) {
      // 先掛 rVFC，再設定 currentTime，避免錯過 present 事件。
      const presented = new Promise<number>((resolve) => {
        rvfc.call(video, (_now, meta) => resolve(meta.mediaTime));
      });
      const seeked = waitForEvent(video, 'seeked', timeoutMs);
      video.currentTime = targetSeconds;
      await seeked;
      const mediaTime = await Promise.race([
        presented,
        // 部分瀏覽器在暫停狀態 seek 後不一定觸發 rVFC；逾時就以 currentTime 代替。
        new Promise<number>((resolve) => setTimeout(() => resolve(video.currentTime), timeoutMs)),
      ]);
      return { mediaTime };
    }
    const seeked = waitForEvent(video, 'seeked', timeoutMs);
    video.currentTime = targetSeconds;
    await seeked;
    return { mediaTime: video.currentTime };
  } catch {
    return null;
  }
}

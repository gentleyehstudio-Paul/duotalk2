import type { ProcessedTrack } from '../types/series';
import type { Shot } from '../types/shot';
import { indexForTime } from '../ui/player/drawSkeleton';

/**
 * 以 Release 幀對齊兩球：對齊時間 τ = t − t_release（毫秒），Release 處 τ = 0。
 * 所有函式都是純函式，便於測試。
 */
export interface AlignedSide {
  processed: ProcessedTrack;
  shot: Shot;
}

export interface TauRange {
  /** 最早（負值，Setup 起點相對 Release） */
  minMs: number;
  /** 最晚（Follow-through 結束相對 Release） */
  maxMs: number;
  /** 主時鐘步進（毫秒）＝ 兩側較高 fps 的幀間隔。 */
  stepMs: number;
}

export function releaseMs(side: AlignedSide): number {
  return side.processed.t_ms[side.shot.events.release]!;
}

/** 兩球各自的 [Setup 起點, Follow-through 結束] 相對 Release 的範圍取聯集。 */
export function alignedRange(a: AlignedSide, b: AlignedSide): TauRange {
  const span = (s: AlignedSide) => {
    const r = releaseMs(s);
    return { min: s.processed.t_ms[s.shot.events.setupStart]! - r, max: s.processed.t_ms[s.shot.events.followThroughEnd]! - r };
  };
  const sa = span(a);
  const sb = span(b);
  return {
    minMs: Math.min(sa.min, sb.min),
    maxMs: Math.max(sa.max, sb.max),
    stepMs: 1000 / Math.max(a.processed.fps, b.processed.fps),
  };
}

/** 某側在對齊時間 τ 的幀索引；超出該球可用範圍（影片邊界）時回傳 null。 */
export function frameAtTau(side: AlignedSide, tauMs: number): number | null {
  const t = releaseMs(side) + tauMs;
  const tms = side.processed.t_ms;
  if (t < tms[0]! - 1 || t > tms[tms.length - 1]! + 1) return null;
  return indexForTime(side.processed, t / 1000);
}

/** 某幀相對 Release 的 τ（毫秒）。 */
export function tauOfFrame(side: AlignedSide, index: number): number {
  return side.processed.t_ms[index]! - releaseMs(side);
}

export interface OverlayPoint {
  tau: number;
  a: number | null;
  b: number | null;
}

/**
 * 在共同的 τ 網格上取樣兩側的角度序列（最近幀），超出範圍或缺值為 null，供疊圖。
 */
export function overlaySeries(a: AlignedSide, b: AlignedSide, angle: keyof ProcessedTrack['angles'], range: TauRange): OverlayPoint[] {
  const out: OverlayPoint[] = [];
  const pick = (s: AlignedSide, tau: number) => {
    const i = frameAtTau(s, tau);
    if (i === null) return null;
    const v = s.processed.angles[angle].deg[i]!;
    return Number.isNaN(v) ? null : Math.round(v * 10) / 10;
  };
  for (let tau = range.minMs; tau <= range.maxMs + 1e-6; tau += range.stepMs) {
    const r = Math.round(tau);
    out.push({ tau: r, a: pick(a, tau), b: pick(b, tau) });
  }
  return out;
}

/** 目前 τ 落在哪個階段（給 HUD）。 */
export function phaseAtTau(side: AlignedSide, tauMs: number): string | null {
  const i = frameAtTau(side, tauMs);
  if (i === null) return null;
  for (const ph of side.shot.phases) if (i >= ph.startIndex && i <= ph.endIndex) return ph.name;
  return null;
}

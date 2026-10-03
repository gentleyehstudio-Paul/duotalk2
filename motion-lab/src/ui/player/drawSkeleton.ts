import { thresholds } from '../../config/thresholds';
import { JOINT_NAMES, SKELETON_CONNECTIONS, type JointName } from '../../pose/joints';
import type { ProcessedTrack } from '../../types/series';
import { chartColors } from '../chartColors';

/**
 * 在 Canvas 上畫某一幀的骨架（平滑後像素座標）與關節軌跡尾跡。
 * 缺值關節不畫（不補造）；尾跡只連接相鄰的有效幀。
 */
export function drawSkeleton(ctx: CanvasRenderingContext2D, p: ProcessedTrack, index: number, opts: { trails?: boolean } = {}) {
  const W = ctx.canvas.width;
  const lw = Math.max(2, W / 400);
  const r = Math.max(3, W / 300);

  if (opts.trails !== false) drawTrails(ctx, p, index);

  ctx.lineWidth = lw;
  ctx.strokeStyle = 'rgba(217,164,65,0.9)';
  ctx.lineCap = 'round';
  for (const [a, b] of SKELETON_CONNECTIONS) {
    const ja = p.joints[a];
    const jb = p.joints[b];
    if (!ja.valid[index] || !jb.valid[index]) continue;
    ctx.beginPath();
    ctx.moveTo(ja.x[index]!, ja.y[index]!);
    ctx.lineTo(jb.x[index]!, jb.y[index]!);
    ctx.stroke();
  }
  ctx.fillStyle = '#8b5cf6';
  for (const name of JOINT_NAMES) {
    const j = p.joints[name];
    if (!j.valid[index]) continue;
    ctx.beginPath();
    ctx.arc(j.x[index]!, j.y[index]!, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function trailJointNames(p: ProcessedTrack): JointName[] {
  return thresholds.display.trailJoints.map((j) => `${p.shootingSide}_${j}` as JointName);
}

const TRAIL_COLORS = [chartColors.series[2], chartColors.series[1], chartColors.phaseExtra];

function drawTrails(ctx: CanvasRenderingContext2D, p: ProcessedTrack, index: number) {
  const n = thresholds.display.trailFrames;
  const W = ctx.canvas.width;
  ctx.lineWidth = Math.max(1.5, W / 600);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  trailJointNames(p).forEach((name, ti) => {
    const j = p.joints[name];
    const color = TRAIL_COLORS[ti % TRAIL_COLORS.length]!;
    const from = Math.max(0, index - n);
    for (let i = from + 1; i <= index; i++) {
      if (!j.valid[i] || !j.valid[i - 1]) continue;
      const age = (index - i) / n; // 0 = 最新
      ctx.strokeStyle = hexWithAlpha(color, 0.15 + 0.85 * (1 - age));
      ctx.beginPath();
      ctx.moveTo(j.x[i - 1]!, j.y[i - 1]!);
      ctx.lineTo(j.x[i]!, j.y[i]!);
      ctx.stroke();
    }
  });
}

function hexWithAlpha(hex: string, a: number): string {
  const v = parseInt(hex.slice(1), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${a.toFixed(3)})`;
}

/** 以 t_ms 找最接近 mediaTime（秒）的序列索引（二分搜尋）。 */
export function indexForTime(p: ProcessedTrack, seconds: number): number {
  const t = p.t_ms;
  const ms = seconds * 1000;
  let lo = 0;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid]! < ms) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(t[lo - 1]! - ms) <= Math.abs(t[lo]! - ms)) return lo - 1;
  return lo;
}

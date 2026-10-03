/**
 * 幾何角度工具。所有輸入都是像素座標（已修正長寬比），任一點為 NaN 則回傳 NaN。
 */
export interface Pt {
  x: number;
  y: number;
}

const RAD2DEG = 180 / Math.PI;

/** 三點內角 ∠ABC（度），頂點在 B。0..180，180 = 伸直。 */
export function interiorAngleDeg(a: Pt, b: Pt, c: Pt): number {
  const v1x = a.x - b.x;
  const v1y = a.y - b.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const n1 = Math.hypot(v1x, v1y);
  const n2 = Math.hypot(v2x, v2y);
  if (!(n1 > 0) || !(n2 > 0) || [a.x, a.y, b.x, b.y, c.x, c.y].some(Number.isNaN)) return NaN;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(cos) * RAD2DEG;
}

/**
 * 線段（from → to）相對鉛直向上方向的有號傾角（度）。
 * 影像座標 y 向下。正值 = to 相對 from 偏向 +x（畫面右側）。
 */
export function leanFromVerticalDeg(from: Pt, to: Pt): number {
  const dx = to.x - from.x;
  const dy = from.y - to.y; // 轉成 y 向上
  if ([dx, dy].some(Number.isNaN) || (dx === 0 && dy === 0)) return NaN;
  return Math.atan2(dx, dy) * RAD2DEG;
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

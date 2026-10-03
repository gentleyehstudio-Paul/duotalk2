import { thresholds } from '../config/thresholds';
import type { JointName } from '../pose/joints';
import type { JointSeries } from '../types/pose';
import type { Side } from '../types/series';

export interface SideDecision {
  side: Side;
  source: 'config' | 'auto' | 'auto_uncertain';
  leftVisibility: number;
  rightVisibility: number;
}

function meanVisibility(series: JointSeries, joints: JointName[]): number {
  let sum = 0;
  let n = 0;
  for (const j of joints) {
    for (const s of series[j]) {
      if (s.x !== null) {
        sum += s.visibility;
        n++;
      }
    }
  }
  return n ? sum / n : 0;
}

/** 投籃手判定：設定強制，或依手腕/手肘平均 visibility（側拍時近側較清楚）。 */
export function decideShootingSide(series: JointSeries): SideDecision {
  const cfg = thresholds.side;
  const leftVisibility = meanVisibility(series, ['left_wrist', 'left_elbow']);
  const rightVisibility = meanVisibility(series, ['right_wrist', 'right_elbow']);
  if (cfg.shootingSide !== 'auto') {
    return { side: cfg.shootingSide, source: 'config', leftVisibility, rightVisibility };
  }
  const gap = Math.abs(leftVisibility - rightVisibility);
  const side: Side = rightVisibility >= leftVisibility ? 'right' : 'left';
  return { side, source: gap < cfg.minSideVisibilityGap ? 'auto_uncertain' : 'auto', leftVisibility, rightVisibility };
}

/**
 * 面向判定：鼻子相對肩膀中點偏左或偏右（多數決）。偏移小於肩寬 × facingMinNoseOffsetRatio 的幀不投票。
 * 輸入為像素座標陣列（NaN = 缺值）。
 */
export function decideFacing(
  noseX: readonly number[],
  lShoulderX: readonly number[],
  rShoulderX: readonly number[],
  lHipX: readonly number[],
  rHipX: readonly number[],
): Side | 'unknown' {
  const ratio = thresholds.side.facingMinNoseOffsetRatio;
  let left = 0;
  let right = 0;
  for (let i = 0; i < noseX.length; i++) {
    const nx = noseX[i]!;
    const ls = lShoulderX[i]!;
    const rs = rShoulderX[i]!;
    if ([nx, ls, rs].some(Number.isNaN)) continue;
    const mid = (ls + rs) / 2;
    // 側拍時兩肩幾乎重疊，肩寬不可靠；改用肩膀中點到髖中點的距離（軀幹長度）當尺度的一部分。
    const lh = lHipX[i]!;
    const rh = rHipX[i]!;
    const scale = Math.max(Math.abs(ls - rs), Number.isNaN(lh) || Number.isNaN(rh) ? 0 : Math.abs(mid - (lh + rh) / 2), 1);
    const off = nx - mid;
    if (Math.abs(off) < scale * ratio) continue;
    if (off > 0) right++;
    else left++;
  }
  if (left === 0 && right === 0) return 'unknown';
  return right >= left ? 'right' : 'left';
}

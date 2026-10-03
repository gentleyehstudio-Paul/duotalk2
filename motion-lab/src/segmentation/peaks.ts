/**
 * 含缺值（NaN）序列的局部極大值與 prominence。
 * 缺值視為序列中斷：峰值的左右基底只在同一段連續有效資料內尋找。
 */
export interface Peak {
  index: number;
  value: number;
  prominence: number;
  leftBase: number;
  rightBase: number;
}

/**
 * @param bridgeGapFrames 搜尋基底時可跨越的最長連續缺值幀數（短缺口不應讓峰值失去它真正的谷底）；0 = 缺值即邊界。
 */
export function findPeaks(v: readonly number[], minProminence: number, bridgeGapFrames = 0): Peak[] {
  const n = v.length;
  const out: Peak[] = [];
  const valid = (i: number) => i >= 0 && i < n && !Number.isNaN(v[i]!);
  for (let i = 0; i < n; i++) {
    if (!valid(i)) continue;
    const l = valid(i - 1) ? v[i - 1]! : -Infinity;
    // 左鄰必須更低（平頂時取「到達最高點的第一幀」= 事件發生時刻）
    if (!(v[i]! > l)) continue;
    // 往右跨過平頂，平頂之後必須下降（或段落結束）
    let k = i + 1;
    while (valid(k) && v[k] === v[i]) k++;
    if (valid(k) && v[k]! > v[i]!) continue;
    // 左基底：往左走到比峰值高的點或段落邊界，取途中最小值
    let leftMin = v[i]!;
    let leftBase = i;
    let leftHas = false;
    for (let k = i - 1, gap = 0; k >= 0; k--) {
      if (!valid(k)) {
        if (++gap > bridgeGapFrames) break;
        continue;
      }
      gap = 0;
      if (v[k]! > v[i]!) break;
      leftHas = true;
      if (v[k]! < leftMin) {
        leftMin = v[k]!;
        leftBase = k;
      }
    }
    let rightMin = v[i]!;
    let rightBase = i;
    let rightHas = false;
    for (let k = i + 1, gap = 0; k < n; k++) {
      if (!valid(k)) {
        if (++gap > bridgeGapFrames) break;
        continue;
      }
      gap = 0;
      if (v[k]! > v[i]!) break;
      rightHas = true;
      if (v[k]! < rightMin) {
        rightMin = v[k]!;
        rightBase = k;
      }
    }
    // 某一側完全沒有資料（段落邊界緊鄰峰值）時，只看另一側；兩側都沒有則不算峰值。
    if (!leftHas && !rightHas) continue;
    const base = leftHas && rightHas ? Math.max(leftMin, rightMin) : leftHas ? leftMin : rightMin;
    const prominence = v[i]! - base;
    if (prominence >= minProminence) out.push({ index: i, value: v[i]!, prominence, leftBase, rightBase });
  }
  return out;
}

/** 以最小間隔做非極大值抑制：距離太近的峰值只留較高者。 */
export function suppressClosePeaks(peaks: Peak[], tIndex: readonly number[], minGap: number): Peak[] {
  const sorted = [...peaks].sort((a, b) => b.value - a.value);
  const kept: Peak[] = [];
  for (const p of sorted) {
    if (kept.every((k) => Math.abs(tIndex[k.index]! - tIndex[p.index]!) >= minGap)) kept.push(p);
  }
  return kept.sort((a, b) => a.index - b.index);
}

export function argmin(v: readonly number[], from: number, to: number): number {
  let best = -1;
  for (let i = Math.max(0, from); i <= Math.min(v.length - 1, to); i++) {
    const x = v[i]!;
    if (Number.isNaN(x)) continue;
    if (best < 0 || x < v[best]!) best = i;
  }
  return best;
}

export function argmax(v: readonly number[], from: number, to: number): number {
  let best = -1;
  for (let i = Math.max(0, from); i <= Math.min(v.length - 1, to); i++) {
    const x = v[i]!;
    if (Number.isNaN(x)) continue;
    if (best < 0 || x > v[best]!) best = i;
  }
  return best;
}

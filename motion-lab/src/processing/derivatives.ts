/**
 * 時間序列差分。全部以真實 t（秒）計算，缺口（NaN 或幀距超過 maxGapFrames）不計算，輸出 NaN。
 * 內部點用中央差分，缺口邊緣用單側差分。
 */
export function derivative(
  values: readonly number[],
  tSeconds: readonly number[],
  frames: readonly number[],
  maxGapFrames: number,
): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(NaN);
  const ok = (i: number) => i >= 0 && i < n && !Number.isNaN(values[i]!);
  const adjacent = (i: number, j: number) => Math.abs(frames[j]! - frames[i]!) <= maxGapFrames;

  for (let i = 0; i < n; i++) {
    if (!ok(i)) continue;
    const hasPrev = ok(i - 1) && adjacent(i - 1, i);
    const hasNext = ok(i + 1) && adjacent(i, i + 1);
    if (hasPrev && hasNext) {
      out[i] = (values[i + 1]! - values[i - 1]!) / (tSeconds[i + 1]! - tSeconds[i - 1]!);
    } else if (hasNext) {
      out[i] = (values[i + 1]! - values[i]!) / (tSeconds[i + 1]! - tSeconds[i]!);
    } else if (hasPrev) {
      out[i] = (values[i]! - values[i - 1]!) / (tSeconds[i]! - tSeconds[i - 1]!);
    }
  }
  return out;
}

export function magnitude(a: readonly number[], b: readonly number[]): number[] {
  return a.map((v, i) => Math.hypot(v, b[i]!));
}

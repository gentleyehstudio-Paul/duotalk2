/**
 * One Euro Filter（Casiez, Roussel & Vogel, CHI 2012）。
 * 自適應低通：靜止時用低截止頻率抑制抖動，快速移動時提高截止頻率降低延遲。
 * 以真實時間戳計算 dt，因此可處理可變幀率與缺口後的續接。
 */
export interface OneEuroParams {
  minCutoffHz: number;
  beta: number;
  derivativeCutoffHz: number;
}

function smoothingFactor(dtSeconds: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSeconds;
  return r / (r + 1);
}

export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(private readonly p: OneEuroParams) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /** @param tSeconds 樣本時間（秒）；必須單調遞增。 */
  filter(x: number, tSeconds: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = tSeconds;
      this.dxPrev = 0;
      return x;
    }
    const dt = tSeconds - this.tPrev;
    if (!(dt > 0)) return this.xPrev;

    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.p.derivativeCutoffHz);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;

    const cutoff = this.p.minCutoffHz + this.p.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;

    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tSeconds;
    return xHat;
  }
}

/**
 * 對一條含缺值（NaN）的序列做 One Euro 平滑。
 * - 缺值位置輸出 NaN（不補造）。
 * - 連續缺值超過 resetAfterGapFrames 幀後，濾波器重設，缺口後第一個有效樣本原樣輸出。
 */
export function smoothSeries(
  values: readonly number[],
  tSeconds: readonly number[],
  params: OneEuroParams,
  resetAfterGapFrames: number,
): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  const f = new OneEuroFilter(params);
  let gap = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isNaN(v)) {
      gap++;
      continue;
    }
    if (gap > resetAfterGapFrames) f.reset();
    gap = 0;
    out[i] = f.filter(v, tSeconds[i]!);
  }
  return out;
}

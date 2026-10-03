import { describe, expect, it } from 'vitest';
import { OneEuroFilter, smoothSeries } from './oneEuro';

const params = { minCutoffHz: 1.5, beta: 0.3, derivativeCutoffHz: 1.0 };
const t = (n: number, fps = 30) => Array.from({ length: n }, (_, i) => i / fps);

function variance(xs: number[]) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

describe('OneEuroFilter', () => {
  it('passes a constant signal unchanged', () => {
    const f = new OneEuroFilter(params);
    const out = t(30).map((ts) => f.filter(0.42, ts));
    out.forEach((v) => expect(v).toBeCloseTo(0.42, 10));
  });

  it('reduces jitter variance on a noisy constant', () => {
    const f = new OneEuroFilter(params);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
    const noisy = t(300).map(() => 0.5 + rnd());
    const out = noisy.map((v, i) => f.filter(v, i / 30));
    expect(variance(out.slice(30))).toBeLessThan(variance(noisy.slice(30)) * 0.5);
  });

  it('follows a fast ramp with small lag (beta > 0)', () => {
    const f = new OneEuroFilter(params);
    const ts = t(60);
    const ramp = ts.map((x) => x * 2); // 2 units/s
    const out = ramp.map((v, i) => f.filter(v, ts[i]!));
    const lag = ramp[59]! - out[59]!;
    expect(lag).toBeGreaterThan(0);
    expect(lag).toBeLessThan(0.15);
  });
});

describe('smoothSeries (missing values)', () => {
  it('keeps NaN where input is NaN and never fabricates', () => {
    const ts = t(10);
    const v = [0.1, 0.1, NaN, NaN, 0.1, 0.1, NaN, 0.1, 0.1, 0.1];
    const out = smoothSeries(v, ts, params, 3);
    v.forEach((x, i) => expect(Number.isNaN(out[i]!)).toBe(Number.isNaN(x)));
  });

  it('resets after a gap longer than resetAfterGapFrames', () => {
    const ts = t(12);
    const v = [0, 0, 0, 0, NaN, NaN, NaN, NaN, NaN, 1, 1, 1];
    const out = smoothSeries(v, ts, params, 3);
    // gap of 5 > 3 -> reset: first value after the gap is passed through unchanged
    expect(out[9]).toBe(1);
  });

  it('continues filtering across a short gap', () => {
    const ts = t(8);
    const v = [0, 0, 0, NaN, 1, 1, 1, 1];
    const out = smoothSeries(v, ts, params, 3);
    // gap of 1 <= 3 -> no reset: output after the gap is pulled toward previous state (< 1)
    expect(out[4]!).toBeLessThan(1);
    expect(out[4]!).toBeGreaterThan(0);
  });
});

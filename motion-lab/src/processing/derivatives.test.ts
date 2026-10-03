import { describe, expect, it } from 'vitest';
import { derivative } from './derivatives';

describe('derivative', () => {
  const frames = [0, 1, 2, 3, 4, 5];
  const t = frames.map((f) => f / 30);

  it('recovers slope of a linear series (central + one-sided at ends)', () => {
    const v = t.map((x) => 3 * x + 1);
    const d = derivative(v, t, frames, 1);
    d.forEach((x) => expect(x).toBeCloseTo(3, 6));
  });

  it('does not differentiate across missing values', () => {
    const v = [0, 1, NaN, 3, 4, 5].map((x, i) => (Number.isNaN(x) ? NaN : 3 * t[i]!));
    const d = derivative(v, t, frames, 1);
    expect(Number.isNaN(d[2]!)).toBe(true);
    // neighbours of the gap fall back to one-sided differences, still finite
    expect(d[1]).toBeCloseTo(3, 6);
    expect(d[3]).toBeCloseTo(3, 6);
  });

  it('treats frame jumps larger than maxGapFrames as gaps', () => {
    const fr = [0, 1, 5, 6];
    const tt = fr.map((f) => f / 30);
    const v = tt.map((x) => 2 * x);
    const d = derivative(v, tt, fr, 1);
    expect(d[0]).toBeCloseTo(2);
    expect(d[1]).toBeCloseTo(2); // only prev neighbour usable
    expect(d[2]).toBeCloseTo(2); // only next neighbour usable
  });
});

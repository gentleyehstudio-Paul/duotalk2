import { describe, expect, it } from 'vitest';
import { interiorAngleDeg, leanFromVerticalDeg } from './angles';

describe('interiorAngleDeg', () => {
  it('returns 90 for a right angle and 180 for a straight limb', () => {
    expect(interiorAngleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeCloseTo(90);
    expect(interiorAngleDeg({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180);
  });
  it('is NaN when any point is missing or degenerate', () => {
    expect(Number.isNaN(interiorAngleDeg({ x: NaN, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }))).toBe(true);
    expect(Number.isNaN(interiorAngleDeg({ x: 0, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 1 }))).toBe(true);
  });
});

describe('leanFromVerticalDeg', () => {
  it('is 0 when upright, positive when the top point is to the right (image coords)', () => {
    expect(leanFromVerticalDeg({ x: 0, y: 10 }, { x: 0, y: 0 })).toBeCloseTo(0);
    expect(leanFromVerticalDeg({ x: 0, y: 10 }, { x: 10, y: 0 })).toBeCloseTo(45);
    expect(leanFromVerticalDeg({ x: 0, y: 10 }, { x: -10, y: 0 })).toBeCloseTo(-45);
  });
});

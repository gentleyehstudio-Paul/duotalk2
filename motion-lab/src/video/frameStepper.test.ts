import { describe, expect, it } from 'vitest';
import { buildFramePlan } from './frameStepper';

describe('buildFramePlan', () => {
  it('covers every frame at stride 1', () => {
    const plan = buildFramePlan(2000, 30, 1);
    expect(plan.length).toBe(60);
    expect(plan[0]).toEqual({ frame: 0, t_ms: 0 });
    expect(plan[1]!.t_ms).toBeCloseTo(33.333, 2);
    expect(plan[59]!.frame).toBe(59);
  });

  it('keeps original frame numbers when striding', () => {
    const plan = buildFramePlan(1000, 30, 3);
    expect(plan.map((p) => p.frame)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
  });

  it('returns empty plan on invalid input', () => {
    expect(buildFramePlan(0, 30)).toEqual([]);
    expect(buildFramePlan(1000, 0)).toEqual([]);
  });
});

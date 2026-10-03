import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { fpsFromMediaTimes, snapToCommonFps } from './fps';

const seq = (fps: number, n: number) => Array.from({ length: n }, (_, i) => i / fps);

describe('fpsFromMediaTimes', () => {
  it('measures 30 fps from evenly spaced timestamps', () => {
    const r = fpsFromMediaTimes(seq(30, 40));
    expect(r.source).toBe('measured');
    expect(r.fps).toBe(30);
  });

  it('measures 59.94 fps and snaps to the standard rate', () => {
    const r = fpsFromMediaTimes(seq(59.94, 60));
    expect(r.fps).toBe(59.94);
  });

  it('is robust to a few dropped frames (uses median)', () => {
    const t = seq(30, 40);
    t.splice(10, 3); // drop 3 frames -> one large gap
    const r = fpsFromMediaTimes(t);
    expect(r.fps).toBe(30);
  });

  it('falls back when too few samples', () => {
    const r = fpsFromMediaTimes(seq(30, thresholds.extraction.fpsSampleMinFrames - 2));
    expect(r.source).toBe('fallback');
    expect(r.fps).toBe(thresholds.extraction.fallbackFps);
  });

  it('falls back on absurd rates', () => {
    const r = fpsFromMediaTimes(seq(1000, 40));
    expect(r.source).toBe('fallback');
  });
});

describe('snapToCommonFps', () => {
  it('snaps near-standard values', () => {
    expect(snapToCommonFps(29.8)).toBe(29.97);
    expect(snapToCommonFps(24.2)).toBe(24);
  });
  it('keeps unusual values (rounded)', () => {
    expect(snapToCommonFps(37.123)).toBe(37.12);
  });
});

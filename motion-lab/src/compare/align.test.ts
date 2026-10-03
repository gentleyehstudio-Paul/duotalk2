import { describe, expect, it } from 'vitest';
import { processTrack } from '../processing/processTrack';
import { segmentShots } from '../segmentation/segmentShots';
import { buildSyntheticShotTrack, DEFAULT_SCRIPT } from '../testutils/syntheticShot';
import { alignedRange, frameAtTau, overlaySeries, phaseAtTau, tauOfFrame, type AlignedSide } from './align';

function side(startS: number, fps = 30, overrides = {}): AlignedSide {
  const processed = processTrack(buildSyntheticShotTrack([{ startS, ...DEFAULT_SCRIPT }], startS + 3.5, fps, [], overrides));
  const shot = segmentShots(processed).shots[0]!;
  return { processed, shot };
}

describe('Release alignment', () => {
  const a = side(0.5);
  const b = side(1.2, 60); // 不同起始時間、不同 fps

  it('maps τ = 0 to each side’s own Release frame', () => {
    expect(frameAtTau(a, 0)).toBe(a.shot.events.release);
    expect(frameAtTau(b, 0)).toBe(b.shot.events.release);
    expect(tauOfFrame(a, a.shot.events.release)).toBe(0);
  });

  it('range is the union of both shots’ spans and steps at the higher fps', () => {
    const r = alignedRange(a, b);
    expect(r.minMs).toBeLessThan(0);
    expect(r.maxMs).toBeGreaterThan(0);
    expect(r.minMs).toBeLessThanOrEqual(tauOfFrame(a, a.shot.events.setupStart));
    expect(r.minMs).toBeLessThanOrEqual(tauOfFrame(b, b.shot.events.setupStart));
    expect(r.maxMs).toBeGreaterThanOrEqual(tauOfFrame(a, a.shot.events.followThroughEnd));
    expect(r.stepMs).toBeCloseTo(1000 / 60, 6);
  });

  it('returns null outside a side’s video and never fabricates', () => {
    expect(frameAtTau(a, -100000)).toBeNull();
    expect(frameAtTau(a, 100000)).toBeNull();
  });

  it('overlays both angle series on a common τ grid with Release at τ = 0', () => {
    const r = alignedRange(a, b);
    const pts = overlaySeries(a, b, 'elbow_right', r);
    expect(pts.length).toBeGreaterThan(10);
    const atZero = pts.find((p) => p.tau === 0)!;
    expect(atZero.a).not.toBeNull();
    expect(atZero.b).not.toBeNull();
    // 兩側同一合成動作：Release 時肘屈曲應接近
    expect(Math.abs(atZero.a! - atZero.b!)).toBeLessThan(8);
    expect(pts[0]!.tau).toBe(Math.round(r.minMs));
  });

  it('reports the phase at a τ for the HUD', () => {
    expect(phaseAtTau(a, 0)).toBe('release');
    expect(phaseAtTau(a, 200)).toBe('follow_through');
    expect(phaseAtTau(a, -5000)).toBeNull();
  });
});

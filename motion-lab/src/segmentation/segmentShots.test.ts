import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { processTrack } from '../processing/processTrack';
import { buildSyntheticShotTrack, DEFAULT_SCRIPT, truthFor, type ShotScript } from '../testutils/syntheticShot';
import { PHASE_NAMES } from '../types/shot';
import { findPeaks } from './peaks';
import { segmentShots } from './segmentShots';

const FPS = 30;
const frameOf = (s: number) => Math.round(s * FPS);

describe('findPeaks', () => {
  it('returns the first frame of a plateau and respects prominence', () => {
    const v = [0, 0.2, 0.5, 0.5, 0.5, 0.1, 0, 0.05, 0];
    const peaks = findPeaks(v, 0.1);
    expect(peaks.map((p) => p.index)).toEqual([2]);
    expect(peaks[0]!.prominence).toBeCloseTo(0.5);
  });
  it('treats NaN as a segment boundary', () => {
    const v = [0, 0.5, NaN, 0.6, 0.1];
    expect(findPeaks(v, 0.1).map((p) => p.index)).toEqual([1, 3]);
  });
});

describe('segmentShots — single shot video (minShotsPerSession = 1)', () => {
  const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
  const truth = truthFor(script);
  const p = processTrack(buildSyntheticShotTrack([script], 4));
  const r = segmentShots(p);

  it('detects exactly one shot with no failures', () => {
    expect(r.failures).toEqual([]);
    expect(r.shots.length).toBe(1);
    expect(r.shots[0]!.readable).toBe(true);
  });

  it('places Release where the wrist stops rising after extension (±3 frames)', () => {
    expect(Math.abs(r.shots[0]!.events.release - frameOf(truth.releaseS))).toBeLessThanOrEqual(3);
  });

  it('places Dip bottom, Set Point and Dip start near ground truth', () => {
    const e = r.shots[0]!.events;
    expect(Math.abs(e.dipBottom - frameOf(truth.dipBottomS))).toBeLessThanOrEqual(3);
    expect(Math.abs(e.setPoint - frameOf(truth.setPointS))).toBeLessThanOrEqual(3);
    expect(Math.abs(e.dipStart - frameOf(truth.dipStartS))).toBeLessThanOrEqual(4);
  });

  it('ends Follow-through when the arm starts to recover', () => {
    const e = r.shots[0]!.events;
    const ftMs = p.t_ms[e.followThroughEnd]! - p.t_ms[e.release]!;
    expect(ftMs).toBeGreaterThan(DEFAULT_SCRIPT.holdS * 1000 * 0.8);
    expect(ftMs).toBeLessThan((DEFAULT_SCRIPT.holdS + DEFAULT_SCRIPT.recoverS) * 1000);
  });

  it('produces six ordered, contiguous phases', () => {
    const ph = r.shots[0]!.phases;
    expect(ph.map((x) => x.name)).toEqual([...PHASE_NAMES]);
    for (let i = 1; i < ph.length; i++) expect(ph[i]!.startIndex).toBeGreaterThanOrEqual(ph[i - 1]!.endIndex);
    expect(ph[4]!.startIndex).toBe(ph[4]!.endIndex); // release is an instant
    expect(ph[0]!.durationMs).toBeGreaterThan(0); // quiet setup found
  });
});

describe('segmentShots — three shots', () => {
  const scripts: ShotScript[] = [0.5, 3.5, 6.5].map((startS) => ({ startS, ...DEFAULT_SCRIPT }));
  const p = processTrack(buildSyntheticShotTrack(scripts, 10));
  const r = segmentShots(p);

  it('splits every shot and keeps them in order', () => {
    expect(r.shots.length).toBe(3);
    scripts.forEach((s, i) => {
      expect(Math.abs(r.shots[i]!.events.release - frameOf(truthFor(s).releaseS))).toBeLessThanOrEqual(3);
    });
    for (let i = 1; i < 3; i++) expect(r.shots[i]!.events.setupStart).toBeGreaterThan(r.shots[i - 1]!.events.followThroughEnd);
  });
});

describe('segmentShots — degenerate inputs', () => {
  it('reports no candidates on a static video instead of guessing', () => {
    const p = processTrack(buildSyntheticShotTrack([], 3));
    const r = segmentShots(p);
    expect(r.shots).toEqual([]);
    expect(r.failures).toContain('no_release_candidates');
  });

  it('tolerates a short gap in the rise but rejects a long one', () => {
    const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
    const sp = frameOf(truthFor(script).setPointS);
    const short = Array.from({ length: thresholds.segmentation.maxGapFramesInRise }, (_, k) => sp - 1 + k);
    const long = Array.from({ length: thresholds.segmentation.maxGapFramesInRise + 3 }, (_, k) => sp - 1 + k);
    expect(segmentShots(processTrack(buildSyntheticShotTrack([script], 4, FPS, short))).shots.length).toBe(1);
    const r = segmentShots(processTrack(buildSyntheticShotTrack([script], 4, FPS, long)));
    expect(r.shots.length).toBe(0);
    expect(r.failures.length).toBeGreaterThan(0);
  });

  it('flags a shot whose data is missing around the release', () => {
    const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
    const rel = frameOf(truthFor(script).releaseS);
    const drop = Array.from({ length: 10 }, (_, k) => rel + 2 + k);
    const p = processTrack(buildSyntheticShotTrack([script], 4, FPS, drop));
    const r = segmentShots(p);
    expect(r.shots.length).toBe(1);
    expect(r.shots[0]!.issues).toContain('follow_through_gap');
  });
});

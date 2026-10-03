import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { appendFrameToSeries, createEmptySeries, summarizeQuality } from './extractPoseTrack';
import { JOINT_COUNT, JOINT_NAMES } from './joints';

const fakeLandmarks = (vis: number) =>
  Array.from({ length: JOINT_COUNT }, (_, i) => ({ x: i / 100, y: i / 200, z: 0, visibility: vis }));

describe('appendFrameToSeries', () => {
  it('writes one sample per joint with frame and t_ms', () => {
    const s = createEmptySeries();
    appendFrameToSeries(s, 7, 233.3, fakeLandmarks(0.9));
    for (const name of JOINT_NAMES) {
      expect(s[name].length).toBe(1);
      expect(s[name][0]!.frame).toBe(7);
      expect(s[name][0]!.t_ms).toBe(233.3);
    }
    expect(s.left_wrist[0]!.x).toBeCloseTo(15 / 100);
  });

  it('marks undetected frames as null (no fabricated data)', () => {
    const s = createEmptySeries();
    appendFrameToSeries(s, 0, 0, null);
    expect(s.nose[0]).toEqual({ frame: 0, t_ms: 0, x: null, y: null, z: null, visibility: 0 });
  });
});

describe('summarizeQuality', () => {
  it('counts valid frames by the configured visibility threshold', () => {
    const s = createEmptySeries();
    const minVis = thresholds.quality.minVisibility;
    appendFrameToSeries(s, 0, 0, fakeLandmarks(minVis + 0.1));
    appendFrameToSeries(s, 1, 33, fakeLandmarks(minVis - 0.1));
    appendFrameToSeries(s, 2, 66, null);
    const q = summarizeQuality(s, ['right_wrist']);
    expect(q[0]).toMatchObject({ joint: 'right_wrist', totalFrames: 3, detectedFrames: 2, validFrames: 1 });
    expect(q[0]!.validRatio).toBeCloseTo(1 / 3);
  });
});

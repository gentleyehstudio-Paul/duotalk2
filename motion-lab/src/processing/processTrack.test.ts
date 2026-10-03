import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { appendFrameToSeries, createEmptySeries } from '../pose/extractPoseTrack';
import { JOINT_COUNT, JOINT_INDEX } from '../pose/joints';
import type { PoseTrack } from '../types/pose';
import { processTrack } from './processTrack';

/**
 * 合成一段「右側面向右、右手較清楚」的簡化骨架：膝蓋先彎後伸，手肘從 90° 伸到 180°。
 */
function syntheticTrack(nFrames = 60, fps = 30): PoseTrack {
  const series = createEmptySeries();
  const W = 1000;
  const H = 1000;
  for (let f = 0; f < nFrames; f++) {
    const t = f / fps;
    const lm = Array.from({ length: JOINT_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    const set = (name: keyof typeof JOINT_INDEX, x: number, y: number, vis = 0.9) => {
      lm[JOINT_INDEX[name]] = { x: x / W, y: y / H, z: 0, visibility: vis };
    };
    const kneeBend = Math.sin((t / 2) * Math.PI) * 100; // 0 → 100 px forward over 2 s
    set('right_hip', 500, 500);
    set('right_knee', 500 + kneeBend, 650);
    set('right_ankle', 500, 800);
    set('left_hip', 500, 500, 0.6);
    set('left_knee', 500 + kneeBend, 650, 0.6);
    set('left_ankle', 500, 800, 0.6);
    set('right_shoulder', 500, 300);
    set('left_shoulder', 500, 300, 0.6);
    const elbowAngle = 90 + (90 * f) / (nFrames - 1); // 90 → 180
    set('right_elbow', 500, 200);
    const a = ((180 - elbowAngle) * Math.PI) / 180;
    set('right_wrist', 500 + 100 * Math.sin(a), 200 - 100 * Math.cos(a));
    set('left_elbow', 500, 200, 0.3);
    set('left_wrist', 500, 100, 0.3);
    set('nose', 560, 220); // nose to the right of shoulders → facing right
    appendFrameToSeries(series, f, (f / fps) * 1000, lm);
  }
  // 在中間挖一個缺值（未偵測）
  for (const name of Object.keys(series) as (keyof typeof series)[]) {
    const s = series[name][30]!;
    series[name][30] = { ...s, x: null, y: null, z: null, visibility: 0 };
  }
  return {
    schemaVersion: 1,
    createdAt: '',
    video: { fileName: 't.mp4', fileSizeBytes: 0, mimeType: 'video/mp4', width: W, height: H, durationMs: (nFrames / fps) * 1000, fps, fpsSource: 'measured' },
    frameCount: nFrames,
    frames: Array.from({ length: nFrames }, (_, f) => ({ frame: f, t_ms: (f / fps) * 1000, status: f === 30 ? 'no_pose' : 'ok', mediaTime: f / fps })),
    series,
    extraction: { frameStride: 1, minVisibility: thresholds.quality.minVisibility, modelPath: '', delegate: 'CPU' },
  };
}

describe('processTrack', () => {
  const p = processTrack(syntheticTrack());

  it('converts to pixel coordinates and masks the missing frame', () => {
    expect(p.joints.right_hip.x[0]).toBeCloseTo(500, 0);
    expect(p.joints.right_hip.valid[30]).toBe(false);
    expect(Number.isNaN(p.joints.right_hip.x[30]!)).toBe(true);
    expect(Number.isNaN(p.angles.knee_right.deg[30]!)).toBe(true);
  });

  it('masks low-visibility joints (left arm below minVisibility)', () => {
    expect(p.joints.left_wrist.valid.every((v) => !v)).toBe(true);
    expect(p.angles.elbow_left.valid.every((v) => !v)).toBe(true);
  });

  it('computes elbow angle opening from ~90 to ~180 degrees', () => {
    expect(p.angles.elbow_right.deg[0]).toBeCloseTo(90, 0);
    expect(p.angles.elbow_right.deg[59]!).toBeGreaterThan(170);
    // angular velocity positive while extending
    expect(p.angles.elbow_right.vel[20]!).toBeGreaterThan(0);
  });

  it('knee angle reaches its minimum near peak bend (~1 s), from the time series', () => {
    const deg = p.angles.knee_right.deg;
    let minI = 0;
    deg.forEach((v, i) => {
      if (!Number.isNaN(v) && v < deg[minI]!) minI = i;
    });
    expect(Math.abs(minI - 30)).toBeLessThanOrEqual(3);
  });

  it('picks shooting side and facing from the data', () => {
    expect(p.shootingSide).toBe('right');
    expect(p.shootingSideSource).toBe('auto');
    expect(p.facing).toBe('right');
  });

  it('reports undetected stats', () => {
    expect(p.stats.undetectedFrames).toBe(1);
  });
});

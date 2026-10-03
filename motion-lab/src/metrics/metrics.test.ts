import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { processTrack } from '../processing/processTrack';
import { segmentShots } from '../segmentation/segmentShots';
import { buildSyntheticShotTrack, DEFAULT_SCRIPT, truthFor, type ShotScript } from '../testutils/syntheticShot';
import { METRIC_IDS } from '../types/metrics';
import { computeShotMetrics } from './computeShotMetrics';
import { computeBaseline, deviationFromBaseline, summarizeSession } from './summary';

const FPS = 30;

describe('computeShotMetrics on a synthetic shot', () => {
  const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
  const p = processTrack(buildSyntheticShotTrack([script], 4));
  const seg = segmentShots(p);
  const m = computeShotMetrics(p, seg.shots[0]!);
  const v = (id: (typeof METRIC_IDS)[number]) => m.values[id].value;

  it('computes all seven metrics', () => {
    for (const id of METRIC_IDS) expect(v(id), id).not.toBeNull();
  });

  it('knee max flexion ≈ 40° (synthetic dip, minus smoothing attenuation) at the dip bottom', () => {
    expect(v('knee_max_flexion_deg')).toBeGreaterThan(34);
    expect(v('knee_max_flexion_deg')).toBeLessThan(41);
    const truth = truthFor(script);
    expect(Math.abs(m.values.knee_max_flexion_deg.frameIndex! - Math.round(truth.dipBottomS * FPS))).toBeLessThanOrEqual(2);
  });

  it('elbow flexion at set point ≈ 95°', () => {
    expect(Math.abs(v('elbow_flexion_at_set_point_deg')! - 95)).toBeLessThan(4);
  });

  it('release height relative to stature ≈ 1.07 (wrist above head)', () => {
    // ankle y 800, wrist y at release ≈ 62, body height 600/0.87
    expect(v('release_height_ratio')).toBeGreaterThan(1.0);
    expect(v('release_height_ratio')).toBeLessThan(1.12);
  });

  it('dip→release ≈ rise + extend (550 ms) within smoothing lag', () => {
    expect(v('dip_to_release_ms')).toBeGreaterThan(500);
    expect(v('dip_to_release_ms')).toBeLessThan(700);
  });

  it('knee starts extending before the elbow (positive lag ≈ rise 400 ms minus smoothing lag)', () => {
    expect(v('knee_elbow_extension_lag_ms')).toBeGreaterThanOrEqual(250);
    expect(v('knee_elbow_extension_lag_ms')).toBeLessThan(500);
  });

  it('trunk lean ≈ 0 for an upright synthetic body', () => {
    expect(Math.abs(v('trunk_lean_at_release_deg')!)).toBeLessThan(1);
  });

  it('follow-through hold ≈ 500 ms', () => {
    expect(v('follow_through_hold_ms')).toBeGreaterThan(400);
    expect(v('follow_through_hold_ms')).toBeLessThan(700);
  });
});

describe('unreadable inputs produce null with a reason, never a number', () => {
  it('knee metrics are null when the knee is occluded during the dip', () => {
    const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
    const track = buildSyntheticShotTrack([script], 4);
    const truth = truthFor(script);
    const from = Math.round((truth.dipStartS - 0.1) * FPS);
    const to = Math.round(truth.releaseS * FPS);
    for (let i = from; i <= to; i++) {
      // 膝蓋被遮擋：visibility 低於門檻 → 缺值（不補造）
      track.series.right_knee[i]!.visibility = thresholds.quality.minVisibility - 0.2;
    }
    const p = processTrack(track);
    const seg = segmentShots(p);
    expect(seg.shots.length).toBe(1);
    const m = computeShotMetrics(p, seg.shots[0]!);
    expect(m.values.knee_max_flexion_deg.value).toBeNull();
    expect(m.values.knee_max_flexion_deg.reason).toContain('膝角');
    expect(m.values.knee_elbow_extension_lag_ms.value).toBeNull();
    expect(m.values.knee_elbow_extension_lag_ms.reason).toBeTruthy();
    // 其他不依賴膝的指標仍可計算
    expect(m.values.elbow_flexion_at_set_point_deg.value).not.toBeNull();
    expect(m.values.release_height_ratio.value).not.toBeNull();
    for (const id of METRIC_IDS) {
      const mv = m.values[id];
      if (mv.value === null) expect(mv.reason, id).toBeTruthy();
    }
  });
});

describe('release inside a short data gap', () => {
  it('keeps the shot but marks release-dependent metrics unreadable', () => {
    const script: ShotScript = { startS: 0.5, ...DEFAULT_SCRIPT };
    const rel = Math.round(truthFor(script).releaseS * FPS);
    const drop = Array.from({ length: thresholds.segmentation.maxGapFramesInRise }, (_, k) => rel + k);
    const p = processTrack(buildSyntheticShotTrack([script], 4, FPS, drop));
    const seg = segmentShots(p);
    expect(seg.shots.length).toBe(1);
    expect(seg.shots[0]!.issues).toContain('release_in_gap');
    const m = computeShotMetrics(p, seg.shots[0]!);
    for (const id of ['release_height_ratio', 'dip_to_release_ms', 'trunk_lean_at_release_deg', 'follow_through_hold_ms'] as const) {
      expect(m.values[id].value, id).toBeNull();
      expect(m.values[id].reason).toContain('缺口');
    }
    // 不依賴 Release 精確時刻的指標仍可計算
    expect(m.values.knee_max_flexion_deg.value).not.toBeNull();
    expect(m.values.elbow_flexion_at_set_point_deg.value).not.toBeNull();
  });
});

describe('summarizeSession / baseline', () => {
  const scripts: ShotScript[] = [0.5, 3.5, 6.5].map((startS) => ({ startS, ...DEFAULT_SCRIPT }));
  const p = processTrack(buildSyntheticShotTrack(scripts, 10));
  const seg = segmentShots(p);
  const all = seg.shots.map((s) => computeShotMetrics(p, s));
  const summary = summarizeSession(all);

  it('aggregates three identical shots with CV ≈ 0', () => {
    expect(summary.knee_max_flexion_deg.n).toBe(3);
    expect(summary.knee_max_flexion_deg.cv).not.toBeNull();
    expect(summary.knee_max_flexion_deg.cv!).toBeLessThan(0.02);
  });

  it('refuses CV when shots are fewer than the configured minimum', () => {
    const one = summarizeSession(all.slice(0, thresholds.shots.minShotsForConsistency - 1));
    expect(one.knee_max_flexion_deg.cv).toBeNull();
    expect(one.knee_max_flexion_deg.cvReason).toContain('球數不足');
  });

  it('uses sd instead of CV for signed metrics', () => {
    expect(summary.trunk_lean_at_release_deg.cv).toBeNull();
    expect(summary.trunk_lean_at_release_deg.sd).not.toBeNull();
  });

  it('builds a baseline only with enough prior shots and excludes the current session', () => {
    const prior = all.map((m) => ({ sessionId: 'old', metrics: m }));
    expect(computeBaseline(prior).knee_max_flexion_deg).toBeNull(); // 3 < minShots (5)
    const more = [...prior, ...prior].map((r, i) => ({ ...r, sessionId: i < 3 ? 'old1' : 'old2' }));
    const b = computeBaseline(more, 'current');
    expect(b.knee_max_flexion_deg?.n).toBe(6);
    expect(b.knee_max_flexion_deg?.sessions).toBe(2);
    expect(computeBaseline(more, 'old1').knee_max_flexion_deg).toBeNull();
  });

  it('reports deviation as diff and z (z null when baseline sd is tiny)', () => {
    const d = deviationFromBaseline('knee_max_flexion_deg', summary.knee_max_flexion_deg, { n: 10, sessions: 2, mean: 30, sd: 4 });
    expect(d!.diff).toBeCloseTo(summary.knee_max_flexion_deg.mean! - 30, 6);
    expect(d!.z).toBeCloseTo(d!.diff / 4, 6);
    const tiny = deviationFromBaseline('knee_max_flexion_deg', summary.knee_max_flexion_deg, { n: 10, sessions: 2, mean: 30, sd: 0.1 });
    expect(tiny!.z).toBeNull();
  });
});

import { thresholds } from '../config/thresholds';
import { JOINT_NAMES, type JointName } from '../pose/joints';
import type { PoseTrack } from '../types/pose';
import { ANGLE_NAMES, type AngleName, type AngleSeries, type ProcessedJoint, type ProcessedTrack } from '../types/series';
import { interiorAngleDeg, leanFromVerticalDeg, midpoint, type Pt } from './angles';
import { derivative, magnitude } from './derivatives';
import { smoothSeries } from './oneEuro';
import { decideFacing, decideShootingSide } from './side';

/**
 * 步驟 2 主流程：PoseTrack（原始、正規化、含 visibility）→ ProcessedTrack（遮罩、平滑、像素、導數、角度）。
 * 決定性：同樣的 track 與 thresholds 永遠得到同樣的結果。
 */
export function processTrack(track: PoseTrack): ProcessedTrack {
  const { width, height, fps } = track.video;
  const ref = track.series.nose;
  const n = ref.length;
  const frames = ref.map((s) => s.frame);
  const t_ms = ref.map((s) => s.t_ms);
  const tSec = t_ms.map((t) => t / 1000);
  const minVis = thresholds.quality.minVisibility;
  const sm = thresholds.smoothing;
  const maxGap = thresholds.derivatives.maxGapFrames;

  const joints = {} as Record<JointName, ProcessedJoint>;
  for (const name of JOINT_NAMES) {
    const samples = track.series[name];
    const valid = samples.map((s) => s.x !== null && s.visibility >= minVis);
    // 在正規化座標上遮罩 + 平滑（參數與解析度無關），再轉像素。
    const nx = samples.map((s, i) => (valid[i] ? (s.x as number) : NaN));
    const ny = samples.map((s, i) => (valid[i] ? (s.y as number) : NaN));
    const sx = smoothSeries(nx, tSec, sm, sm.resetAfterGapFrames).map((v) => v * width);
    const sy = smoothSeries(ny, tSec, sm, sm.resetAfterGapFrames).map((v) => v * height);
    const vx = derivative(sx, tSec, frames, maxGap);
    const vy = derivative(sy, tSec, frames, maxGap);
    joints[name] = {
      x: sx,
      y: sy,
      rawX: nx.map((v) => v * width),
      rawY: ny.map((v) => v * height),
      valid,
      vx,
      vy,
      speed: magnitude(vx, vy),
      ax: derivative(vx, tSec, frames, maxGap),
      ay: derivative(vy, tSec, frames, maxGap),
    };
  }

  const facing = decideFacing(
    joints.nose.x,
    joints.left_shoulder.x,
    joints.right_shoulder.x,
    joints.left_hip.x,
    joints.right_hip.x,
  );
  const sideDecision = decideShootingSide(track.series);

  const pt = (name: JointName, i: number): Pt => ({ x: joints[name].x[i]!, y: joints[name].y[i]! });
  const angleDef: Record<AngleName, (i: number) => number> = {
    knee_left: (i) => interiorAngleDeg(pt('left_hip', i), pt('left_knee', i), pt('left_ankle', i)),
    knee_right: (i) => interiorAngleDeg(pt('right_hip', i), pt('right_knee', i), pt('right_ankle', i)),
    hip_left: (i) => interiorAngleDeg(pt('left_shoulder', i), pt('left_hip', i), pt('left_knee', i)),
    hip_right: (i) => interiorAngleDeg(pt('right_shoulder', i), pt('right_hip', i), pt('right_knee', i)),
    elbow_left: (i) => interiorAngleDeg(pt('left_shoulder', i), pt('left_elbow', i), pt('left_wrist', i)),
    elbow_right: (i) => interiorAngleDeg(pt('right_shoulder', i), pt('right_elbow', i), pt('right_wrist', i)),
    shoulder_left: (i) => interiorAngleDeg(pt('left_hip', i), pt('left_shoulder', i), pt('left_elbow', i)),
    shoulder_right: (i) => interiorAngleDeg(pt('right_hip', i), pt('right_shoulder', i), pt('right_elbow', i)),
    trunk_lean: (i) => {
      const hip = midpoint(pt('left_hip', i), pt('right_hip', i));
      const sh = midpoint(pt('left_shoulder', i), pt('right_shoulder', i));
      const lean = leanFromVerticalDeg(hip, sh); // 正值 = 肩膀在髖部右側
      // 轉成「正值 = 向面向方向前傾」；面向未知時保留影像座標定義。
      return facing === 'left' ? -lean : lean;
    },
  };

  const angles = {} as Record<AngleName, AngleSeries>;
  for (const a of ANGLE_NAMES) {
    const deg = new Array<number>(n);
    for (let i = 0; i < n; i++) deg[i] = angleDef[a](i);
    angles[a] = {
      deg,
      vel: derivative(deg, tSec, frames, maxGap),
      valid: deg.map((v) => !Number.isNaN(v)),
    };
  }

  const undetected = track.frames.filter((f) => f.status === 'no_pose' || f.status === 'seek_failed').length;

  return {
    frames,
    t_ms,
    fps,
    width,
    height,
    joints,
    angles,
    shootingSide: sideDecision.side,
    shootingSideSource: sideDecision.source,
    facing,
    stats: { totalFrames: n, undetectedFrames: undetected, undetectedRatio: n ? undetected / n : 0 },
  };
}

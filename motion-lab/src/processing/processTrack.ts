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
  // 屈曲量 = 180 − 內角（使用者決定：膝/髖/肘以屈曲量呈現）
  const flexion = (a: Pt, b: Pt, c: Pt) => 180 - interiorAngleDeg(a, b, c);
  const angleDef: Record<AngleName, (i: number) => number> = {
    knee_left: (i) => flexion(pt('left_hip', i), pt('left_knee', i), pt('left_ankle', i)),
    knee_right: (i) => flexion(pt('right_hip', i), pt('right_knee', i), pt('right_ankle', i)),
    hip_left: (i) => flexion(pt('left_shoulder', i), pt('left_hip', i), pt('left_knee', i)),
    hip_right: (i) => flexion(pt('right_shoulder', i), pt('right_hip', i), pt('right_knee', i)),
    elbow_left: (i) => flexion(pt('left_shoulder', i), pt('left_elbow', i), pt('left_wrist', i)),
    elbow_right: (i) => flexion(pt('right_shoulder', i), pt('right_elbow', i), pt('right_wrist', i)),
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
  const body = estimateBodyHeight(joints, n);

  return {
    bodyHeightPx: body.px,
    bodyHeightSource: body.source,
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

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * 身高（像素）估計：鼻子到較低腳踝的垂直距離的中位數 ÷ 身高比例；
 * 不足時用軀幹長度（肩中點到髖中點）÷ 軀幹比例。
 */
function estimateBodyHeight(joints: Record<JointName, ProcessedJoint>, n: number): { px: number; source: ProcessedTrack['bodyHeightSource'] } {
  const cfg = thresholds.bodyScale;
  const na: number[] = [];
  const trunk: number[] = [];
  for (let i = 0; i < n; i++) {
    const nose = joints.nose.y[i]!;
    const la = joints.left_ankle.y[i]!;
    const ra = joints.right_ankle.y[i]!;
    const ankle = Number.isNaN(la) ? ra : Number.isNaN(ra) ? la : Math.max(la, ra);
    if (!Number.isNaN(nose) && !Number.isNaN(ankle) && ankle > nose) na.push(ankle - nose);

    const sh = avg(joints.left_shoulder.y[i]!, joints.right_shoulder.y[i]!);
    const hp = avg(joints.left_hip.y[i]!, joints.right_hip.y[i]!);
    const shx = avg(joints.left_shoulder.x[i]!, joints.right_shoulder.x[i]!);
    const hpx = avg(joints.left_hip.x[i]!, joints.right_hip.x[i]!);
    if (![sh, hp, shx, hpx].some(Number.isNaN)) trunk.push(Math.hypot(shx - hpx, sh - hp));
  }
  if (na.length >= cfg.minValidFrames) return { px: median(na) / cfg.noseToAnkleStatureRatio, source: 'nose_ankle' };
  if (trunk.length >= cfg.minValidFrames) return { px: median(trunk) / cfg.trunkToStatureRatio, source: 'trunk' };
  return { px: NaN, source: 'none' };
}

/** 兩值平均；任一為 NaN 時回傳另一個（側拍時遠側常缺）。 */
export function avg(a: number, b: number): number {
  if (Number.isNaN(a)) return b;
  if (Number.isNaN(b)) return a;
  return (a + b) / 2;
}

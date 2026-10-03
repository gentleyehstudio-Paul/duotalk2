import { thresholds } from '../config/thresholds';
import { appendFrameToSeries, createEmptySeries } from '../pose/extractPoseTrack';
import { JOINT_COUNT, JOINT_INDEX, type JointName } from '../pose/joints';
import type { PoseTrack } from '../types/pose';

/**
 * 合成投籃骨架（右手、面向右、側拍）。用於單元測試，提供每球的 ground-truth 事件時間。
 * 身體：鼻 y=200、肩 y=300、髖 y=500、膝 y=650、踝 y=800（像素，畫布 1000×1000）。
 * 手臂：上臂 120、前臂 120；θs = 肩抬臂角（0 = 垂下、180 = 直上），φ = 肘屈曲量。
 */
export interface ShotScript {
  startS: number;
  setupS: number;
  dipS: number;
  riseS: number;
  extendS: number; // Set Point → Release
  holdS: number; // Follow-through 停留
  recoverS: number;
}

export const DEFAULT_SCRIPT: Omit<ShotScript, 'startS'> = {
  setupS: 0.6,
  dipS: 0.3,
  riseS: 0.4,
  extendS: 0.15,
  holdS: 0.5,
  recoverS: 0.5,
};

export interface ShotTruth {
  dipStartS: number;
  dipBottomS: number;
  setPointS: number;
  releaseS: number;
  followThroughEndApproxS: number;
}

interface Pose {
  thetaS: number;
  phi: number;
  kneeFlex: number;
}

const POSES = {
  setup: { thetaS: 30, phi: 90, kneeFlex: 5 },
  dipBottom: { thetaS: 20, phi: 70, kneeFlex: 40 },
  setPoint: { thetaS: 150, phi: 95, kneeFlex: 10 },
  release: { thetaS: 170, phi: 10, kneeFlex: 0 },
} as const satisfies Record<string, Pose>;

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const lerpPose = (a: Pose, b: Pose, u: number): Pose => ({
  thetaS: lerp(a.thetaS, b.thetaS, u),
  phi: lerp(a.phi, b.phi, u),
  kneeFlex: lerp(a.kneeFlex, b.kneeFlex, u),
});

function poseAt(tS: number, shots: ShotScript[]): Pose {
  for (const s of shots) {
    let t0 = s.startS;
    if (tS < t0) break;
    const seg: Array<[number, Pose, Pose]> = [
      [s.setupS, POSES.setup, POSES.setup],
      [s.dipS, POSES.setup, POSES.dipBottom],
      [s.riseS, POSES.dipBottom, POSES.setPoint],
      [s.extendS, POSES.setPoint, POSES.release],
      [s.holdS, POSES.release, POSES.release],
      [s.recoverS, POSES.release, POSES.setup],
    ];
    for (const [dur, a, b] of seg) {
      if (tS < t0 + dur) return lerpPose(a, b, (tS - t0) / dur);
      t0 += dur;
    }
  }
  return POSES.setup;
}

export function truthFor(s: ShotScript): ShotTruth {
  const dipStartS = s.startS + s.setupS;
  const dipBottomS = dipStartS + s.dipS;
  const setPointS = dipBottomS + s.riseS;
  const releaseS = setPointS + s.extendS;
  return { dipStartS, dipBottomS, setPointS, releaseS, followThroughEndApproxS: releaseS + s.holdS };
}

export function buildSyntheticShotTrack(shots: ShotScript[], totalS: number, fps = 30, dropFrames: number[] = []): PoseTrack {
  const W = 1000;
  const H = 1000;
  const n = Math.round(totalS * fps);
  const series = createEmptySeries();
  const d2r = Math.PI / 180;
  for (let f = 0; f < n; f++) {
    const tS = f / fps;
    const pose = poseAt(tS, shots);
    const lm = Array.from({ length: JOINT_COUNT }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
    const set = (name: JointName, x: number, y: number, vis = 0.9) => {
      lm[JOINT_INDEX[name]] = { x: x / W, y: y / H, z: 0, visibility: vis };
    };
    const shoulder = { x: 500, y: 300 };
    const thS = pose.thetaS * d2r;
    const elbow = { x: shoulder.x + 120 * Math.sin(thS), y: shoulder.y + 120 * Math.cos(thS) };
    const thF = (pose.thetaS + pose.phi) * d2r;
    const wrist = { x: elbow.x + 120 * Math.sin(thF), y: elbow.y + 120 * Math.cos(thF) };
    // 膝：由屈曲量反推膝蓋前移量 b（髖 (500,500)、踝 (500,800)、膝 (500+b,650)）
    const interior = (180 - pose.kneeFlex) * d2r;
    const cosI = Math.cos(interior);
    const b = pose.kneeFlex < 0.01 ? 0 : 150 * Math.sqrt((1 + cosI) / (1 - cosI));

    set('nose', 560, 200);
    set('right_shoulder', shoulder.x, shoulder.y);
    set('left_shoulder', shoulder.x, shoulder.y, 0.6);
    set('right_elbow', elbow.x, elbow.y);
    set('right_wrist', wrist.x, wrist.y);
    set('right_index', wrist.x + 10, wrist.y - 10);
    set('left_elbow', elbow.x - 10, elbow.y, 0.3);
    set('left_wrist', wrist.x - 10, wrist.y, 0.3);
    set('right_hip', 500, 500);
    set('left_hip', 500, 500, 0.6);
    set('right_knee', 500 + b, 650);
    set('left_knee', 500 + b, 650, 0.6);
    set('right_ankle', 500, 800);
    set('left_ankle', 500, 800, 0.6);
    appendFrameToSeries(series, f, (f / fps) * 1000, dropFrames.includes(f) ? null : lm);
  }
  return {
    schemaVersion: 1,
    createdAt: '',
    video: { fileName: 'synthetic.mp4', fileSizeBytes: 0, mimeType: 'video/mp4', width: W, height: H, durationMs: (n / fps) * 1000, fps, fpsSource: 'measured' },
    frameCount: n,
    frames: Array.from({ length: n }, (_, f) => ({ frame: f, t_ms: (f / fps) * 1000, status: dropFrames.includes(f) ? 'no_pose' : 'ok', mediaTime: f / fps })),
    series,
    extraction: { frameStride: 1, minVisibility: thresholds.quality.minVisibility, modelPath: '', delegate: 'CPU' },
  };
}

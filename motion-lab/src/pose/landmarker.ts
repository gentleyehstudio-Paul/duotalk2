import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { assets } from '../config/assets';
import { thresholds } from '../config/thresholds';

let instance: PoseLandmarker | null = null;
let resolvedModelPath = '';
let resolvedDelegate: 'GPU' | 'CPU' = thresholds.pose.delegate;

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

/** 建立（或取得已建立的）PoseLandmarker，VIDEO 模式。本地資產不存在時退回 CDN。 */
export async function getPoseLandmarker(): Promise<PoseLandmarker> {
  if (instance) return instance;

  const wasmBase = (await urlExists(`${assets.wasmBasePath}/vision_wasm_internal.js`))
    ? assets.wasmBasePath
    : assets.wasmFallbackBasePath;
  const modelPath = (await urlExists(assets.poseModelLocalPath))
    ? assets.poseModelLocalPath
    : assets.poseModelFallbackUrl;

  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  const p = thresholds.pose;

  const create = (delegate: 'GPU' | 'CPU') =>
    PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelPath, delegate },
      runningMode: 'VIDEO',
      numPoses: p.numPoses,
      minPoseDetectionConfidence: p.minPoseDetectionConfidence,
      minPosePresenceConfidence: p.minPosePresenceConfidence,
      minTrackingConfidence: p.minTrackingConfidence,
      outputSegmentationMasks: false,
    });

  try {
    instance = await create(p.delegate);
    resolvedDelegate = p.delegate;
  } catch (err) {
    if (p.delegate === 'GPU') {
      console.warn('[landmarker] GPU delegate failed, falling back to CPU', err);
      instance = await create('CPU');
      resolvedDelegate = 'CPU';
    } else {
      throw err;
    }
  }
  resolvedModelPath = modelPath;
  return instance;
}

export function getLandmarkerInfo() {
  return { modelPath: resolvedModelPath, delegate: resolvedDelegate };
}

export function disposePoseLandmarker() {
  instance?.close();
  instance = null;
}

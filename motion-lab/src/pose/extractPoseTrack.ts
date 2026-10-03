import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { thresholds } from '../config/thresholds';
import type { FrameRecord, JointQuality, JointSample, JointSeries, PoseTrack, VideoMeta } from '../types/pose';
import type { LoadedVideo } from '../video/loadVideo';
import { measureVideoFps } from '../video/fps';
import { buildFramePlan, stepFrames } from '../video/frameStepper';
import { JOINT_COUNT, JOINT_NAMES, PRIMARY_JOINTS, type JointName } from './joints';
import { getLandmarkerInfo, getPoseLandmarker } from './landmarker';

export interface ExtractionProgress {
  phase: 'loading_model' | 'measuring_fps' | 'extracting' | 'done';
  frame: number;
  totalFrames: number;
  fps: number;
  elapsedMs: number;
  /** 估計剩餘毫秒數（extracting 階段才有意義）。 */
  etaMs: number;
  detected: number;
  noPose: number;
  seekFailed: number;
  duplicates: number;
}

export interface ExtractOptions {
  onProgress?: (p: ExtractionProgress) => void;
  signal?: AbortSignal;
}

export function createEmptySeries(): JointSeries {
  const s = {} as JointSeries;
  for (const name of JOINT_NAMES) s[name] = [];
  return s;
}

/** 把一幀的 33 個 landmark（或 null）追加到各關節序列。純函式邏輯，可測試。 */
export function appendFrameToSeries(
  series: JointSeries,
  frame: number,
  t_ms: number,
  landmarks: readonly NormalizedLandmark[] | null,
): void {
  for (let i = 0; i < JOINT_COUNT; i++) {
    const name = JOINT_NAMES[i]!;
    const lm = landmarks?.[i];
    const sample: JointSample = lm
      ? { frame, t_ms, x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 0 }
      : { frame, t_ms, x: null, y: null, z: null, visibility: 0 };
    series[name].push(sample);
  }
}

/** 計算每個關節的品質摘要（有效幀比例等）。 */
export function summarizeQuality(series: JointSeries, joints: readonly JointName[] = PRIMARY_JOINTS): JointQuality[] {
  const minVis = thresholds.quality.minVisibility;
  return joints.map((joint) => {
    const samples = series[joint];
    let detected = 0;
    let valid = 0;
    let visSum = 0;
    for (const s of samples) {
      if (s.x !== null) {
        detected++;
        visSum += s.visibility;
        if (s.visibility >= minVis) valid++;
      }
    }
    return {
      joint,
      totalFrames: samples.length,
      detectedFrames: detected,
      validFrames: valid,
      validRatio: samples.length ? valid / samples.length : 0,
      meanVisibility: detected ? visSum / detected : 0,
    };
  });
}

/**
 * 主流程：量測 FPS → 建立幀計畫 → 逐幀 seek + detectForVideo → 產生 PoseTrack。
 * 全程在瀏覽器執行，影片不上傳。
 */
export async function extractPoseTrack(loaded: LoadedVideo, opts: ExtractOptions = {}): Promise<PoseTrack> {
  const { onProgress, signal } = opts;
  const started = performance.now();
  const progress: ExtractionProgress = {
    phase: 'loading_model',
    frame: 0,
    totalFrames: 0,
    fps: 0,
    elapsedMs: 0,
    etaMs: 0,
    detected: 0,
    noPose: 0,
    seekFailed: 0,
    duplicates: 0,
  };
  const report = () => {
    progress.elapsedMs = performance.now() - started;
    onProgress?.({ ...progress });
  };

  report();
  const landmarker = await getPoseLandmarker();

  progress.phase = 'measuring_fps';
  report();
  const fpsEstimate = await measureVideoFps(loaded.element);
  const fps = fpsEstimate.fps;

  const plan = buildFramePlan(loaded.durationMs, fps);
  progress.phase = 'extracting';
  progress.totalFrames = plan.length;
  progress.fps = fps;
  report();

  const series = createEmptySeries();
  const frames: FrameRecord[] = [];
  const video = loaded.element;
  const { progressEveryFrames } = thresholds.extraction;
  let processed = 0;
  // detectForVideo 要求時間戳嚴格遞增（毫秒），用自己的計數器避免 seek 誤差造成相同時間戳。
  let lastTimestampMs = -1;

  for await (const step of stepFrames(video, plan, signal)) {
    if (step.status === 'duplicate') {
      progress.duplicates++;
      frames.push({ frame: step.frame, t_ms: step.t_ms, status: 'duplicate', mediaTime: step.mediaTime });
    } else if (step.status === 'seek_failed') {
      progress.seekFailed++;
      frames.push({ frame: step.frame, t_ms: step.t_ms, status: 'seek_failed', mediaTime: NaN });
      appendFrameToSeries(series, step.frame, step.t_ms, null);
    } else {
      const ts = Math.max(Math.round(step.t_ms), lastTimestampMs + 1);
      lastTimestampMs = ts;
      const result = landmarker.detectForVideo(video, ts);
      const lms = result.landmarks[0] ?? null;
      if (lms && lms.length === JOINT_COUNT) {
        progress.detected++;
        frames.push({ frame: step.frame, t_ms: step.t_ms, status: 'ok', mediaTime: step.mediaTime });
        appendFrameToSeries(series, step.frame, step.t_ms, lms);
      } else {
        progress.noPose++;
        frames.push({ frame: step.frame, t_ms: step.t_ms, status: 'no_pose', mediaTime: step.mediaTime });
        appendFrameToSeries(series, step.frame, step.t_ms, null);
      }
    }
    processed++;
    progress.frame = processed;
    if (processed % progressEveryFrames === 0 || processed === plan.length) {
      const elapsed = performance.now() - started;
      progress.etaMs = processed > 0 ? (elapsed / processed) * (plan.length - processed) : 0;
      report();
    }
  }

  if (signal?.aborted) throw new DOMException('extraction aborted', 'AbortError');

  const info = getLandmarkerInfo();
  const videoMeta: VideoMeta = {
    fileName: loaded.file.name,
    fileSizeBytes: loaded.file.size,
    mimeType: loaded.file.type,
    width: loaded.width,
    height: loaded.height,
    durationMs: loaded.durationMs,
    fps,
    fpsSource: fpsEstimate.source,
  };

  progress.phase = 'done';
  report();

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    video: videoMeta,
    frameCount: series.nose.length,
    frames,
    series,
    extraction: {
      frameStride: thresholds.extraction.frameStride,
      minVisibility: thresholds.quality.minVisibility,
      modelPath: info.modelPath,
      delegate: info.delegate,
    },
  };
}

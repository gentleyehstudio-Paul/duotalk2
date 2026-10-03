// Copies the MediaPipe WASM runtime into public/wasm and fetches the
// PoseLandmarker model into public/models so the PWA can run fully offline.
// Nothing here is a tuning parameter; model/wasm locations live in
// src/config/assets.ts and must match the paths used below.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const wasmSrc = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const wasmDst = join(root, 'public', 'wasm');
const modelDir = join(root, 'public', 'models');
const modelFile = join(modelDir, 'pose_landmarker_full.task');
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

mkdirSync(wasmDst, { recursive: true });
mkdirSync(modelDir, { recursive: true });

if (existsSync(wasmSrc)) {
  for (const f of readdirSync(wasmSrc)) {
    const src = join(wasmSrc, f);
    const dst = join(wasmDst, f);
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
  }
  console.log('[prepare-assets] wasm runtime ready in public/wasm');
} else {
  console.warn('[prepare-assets] @mediapipe/tasks-vision not installed yet; skipping wasm copy');
}

if (!existsSync(modelFile)) {
  try {
    const res = await fetch(modelUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(modelFile, Buffer.from(await res.arrayBuffer()));
    console.log('[prepare-assets] downloaded pose_landmarker_full.task');
  } catch (err) {
    console.warn(
      `[prepare-assets] could not download model (${err.message}). ` +
        'The app will fall back to loading it from the MediaPipe CDN at runtime. ' +
        `To work offline, place the file manually at ${modelFile}`,
    );
  }
} else {
  console.log('[prepare-assets] model already present');
}

import { thresholds } from '../config/thresholds';

export interface LoadedVideo {
  element: HTMLVideoElement;
  objectUrl: string;
  width: number;
  height: number;
  durationMs: number;
  file: File;
  revoke: () => void;
}

export type FileValidation = { ok: true } | { ok: false; reason: string };

/** 規則 1：只接受影片檔。純函式，可單元測試。 */
export function validateVideoFile(name: string, mimeType: string): FileValidation {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const { acceptedMimeTypes, acceptedExtensions } = thresholds.input;
  const mimeOk = mimeType !== '' && acceptedMimeTypes.includes(mimeType);
  const extOk = acceptedExtensions.includes(ext);
  if (mimeType.startsWith('image/')) {
    return { ok: false, reason: '不接受單張圖片；請上傳投籃影片（mp4 / mov）。' };
  }
  if (!mimeOk && !extOk) {
    return {
      ok: false,
      reason: `不支援的檔案格式（${mimeType || '未知'} / .${ext}）；只接受 ${acceptedExtensions.join(', ')}。`,
    };
  }
  return { ok: true };
}

export function validateDuration(durationSeconds: number): FileValidation {
  const { minDurationSeconds, maxDurationSeconds } = thresholds.input;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return { ok: false, reason: '無法讀取影片長度；檔案可能損毀或編碼不受瀏覽器支援。' };
  }
  if (durationSeconds < minDurationSeconds) {
    return { ok: false, reason: `影片太短（${durationSeconds.toFixed(2)} 秒），無法包含完整投籃動作。` };
  }
  if (durationSeconds > maxDurationSeconds) {
    return {
      ok: false,
      reason: `影片太長（${durationSeconds.toFixed(0)} 秒），上限 ${maxDurationSeconds} 秒；請先裁切。`,
    };
  }
  return { ok: true };
}

/** 把使用者選的影片檔載入到一個隱藏的 <video>，解析完 metadata 後回傳。影片不會離開瀏覽器。 */
export async function loadVideoFile(file: File): Promise<LoadedVideo> {
  const v = validateVideoFile(file.name, file.type);
  if (!v.ok) throw new Error(v.reason);

  const objectUrl = URL.createObjectURL(file);
  const element = document.createElement('video');
  element.preload = 'auto';
  element.muted = true;
  element.playsInline = true;
  element.crossOrigin = 'anonymous';
  element.src = objectUrl;

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(
        new Error(
          '瀏覽器無法解碼這段影片的編碼（常見原因：iPhone 的 HEVC/H.265，或此瀏覽器不支援 H.264）；請轉成 H.264 mp4 後再試。',
        ),
      );
    };
    const cleanup = () => {
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
    };
    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('error', onError);
  });

  // 有些瀏覽器要等 loadeddata 才有正確的 videoWidth/Height。
  if (element.videoWidth === 0 || element.videoHeight === 0) {
    await new Promise<void>((resolve) => {
      element.addEventListener('loadeddata', () => resolve(), { once: true });
    });
  }

  const d = validateDuration(element.duration);
  if (!d.ok) {
    URL.revokeObjectURL(objectUrl);
    throw new Error(d.reason);
  }

  return {
    element,
    objectUrl,
    width: element.videoWidth,
    height: element.videoHeight,
    durationMs: element.duration * 1000,
    file,
    revoke: () => URL.revokeObjectURL(objectUrl),
  };
}

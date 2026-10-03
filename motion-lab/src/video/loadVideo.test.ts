import { describe, expect, it } from 'vitest';
import { thresholds } from '../config/thresholds';
import { validateDuration, validateVideoFile } from './loadVideo';

describe('validateVideoFile (rule 1: video only)', () => {
  it('accepts mp4 and mov', () => {
    expect(validateVideoFile('shot.mp4', 'video/mp4').ok).toBe(true);
    expect(validateVideoFile('shot.MOV', 'video/quicktime').ok).toBe(true);
    // Some browsers report an empty MIME for .mov; extension must be enough.
    expect(validateVideoFile('shot.mov', '').ok).toBe(true);
  });

  it('rejects images explicitly', () => {
    const r = validateVideoFile('frame.png', 'image/png');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不接受單張圖片');
  });

  it('rejects other formats', () => {
    expect(validateVideoFile('clip.webm', 'video/webm').ok).toBe(false);
    expect(validateVideoFile('notes.txt', 'text/plain').ok).toBe(false);
  });
});

describe('validateDuration', () => {
  it('enforces configured bounds', () => {
    expect(validateDuration(thresholds.input.minDurationSeconds - 0.01).ok).toBe(false);
    expect(validateDuration(thresholds.input.maxDurationSeconds + 1).ok).toBe(false);
    expect(validateDuration(30).ok).toBe(true);
    expect(validateDuration(NaN).ok).toBe(false);
  });
});

import { thresholds } from '../config/thresholds';
import { avg } from '../processing/processTrack';
import type { ProcessedTrack } from '../types/series';
import type { Phase, SegmentationFailure, SegmentationResult, Shot, ShotEvents, ShotIssue } from '../types/shot';
import { argmax, argmin, findPeaks, suppressClosePeaks } from './peaks';

/**
 * 步驟 3：投籃與六階段切分。完全由時間序列事件決定，不看任何單一畫面的姿勢。
 *
 * 1. 手腕高度 h[i] = (肩線 y − 投籃側手腕 y) / 身高px。
 * 2. Release 候選 = h 的局部極大（prominence、絕對高度過門檻，最小間隔抑制）。
 * 3. 候選驗證：前 riseWindow 內手腕向上速度峰值 ≥ 門檻，且 Release 時肘屈曲 ≤ 上限。
 * 4. 每球往前：Dip 底（視窗內 h 最低）、Dip 起點（膝屈曲或手腕下沉的起始）、Setup（安靜段）；
 *    Dip 底與 Release 之間：Set Point（最後一次肘屈曲局部極大）；往後：Follow-through 結束。
 */
export function segmentShots(p: ProcessedTrack): SegmentationResult {
  const cfg = thresholds.segmentation;
  const n = p.frames.length;
  const side = p.shootingSide;
  const failures: SegmentationFailure[] = [];
  const rejected: SegmentationResult['rejected'] = [];

  if (!(p.bodyHeightPx > 0)) {
    return { shots: [], failures: ['no_body_scale'], rejected, wristHeightRatio: new Array(n).fill(NaN) };
  }
  const H = p.bodyHeightPx;
  const wrist = p.joints[`${side}_wrist`];
  const elbowFlex = p.angles[`elbow_${side}`];
  const kneeFlex = p.angles[`knee_${side}`];
  const shoulderNear = p.joints[`${side}_shoulder`];
  const shoulderFar = p.joints[side === 'right' ? 'left_shoulder' : 'right_shoulder'];

  // 手腕相對肩線高度（身高比），向上為正；手腕向上速度（身高比/秒）。
  const h = new Array<number>(n);
  const upSpeed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const shY = avg(shoulderNear.y[i]!, shoulderFar.y[i]!);
    h[i] = (shY - wrist.y[i]!) / H;
    upSpeed[i] = -wrist.vy[i]! / H;
  }
  const wristValid = wrist.valid.filter(Boolean).length / Math.max(1, n);
  if (wristValid < 0.1) {
    return { shots: [], failures: ['wrist_unreadable'], rejected, wristHeightRatio: h };
  }

  const t = p.t_ms;
  const msToFrames = (ms: number) => Math.max(1, Math.round((ms / 1000) * p.fps));

  // ── Release 候選：手腕高度峰值 ──
  const rawPeaks = findPeaks(h, cfg.minReleaseProminenceRatio, cfg.maxGapFramesInRise).filter((pk) => pk.value >= cfg.minReleaseHeightRatio);
  if (rawPeaks.length === 0) {
    return { shots: [], failures: ['no_release_candidates'], rejected, wristHeightRatio: h };
  }

  // ── 候選驗證（先驗證，再做最小間隔抑制，避免被否決的高峰壓掉合法的低峰）──
  interface Candidate {
    peakI: number;
    rel: number;
    riseSpeedI: number;
    maxRise: number;
    elbowAtRel: number;
    prominence: number;
    releaseInGap: boolean;
  }
  const candidates: Candidate[] = [];
  for (const pk of rawPeaks) {
    const peakI = pk.index;
    const riseFrom = Math.max(0, peakI - msToFrames(cfg.riseWindowMs));
    const riseSpeedI = argmax(upSpeed, riseFrom, peakI);
    const maxRise = riseSpeedI >= 0 ? upSpeed[riseSpeedI]! : NaN;
    if (!(maxRise >= cfg.minRiseSpeedRatioPerS)) {
      rejected.push({ index: peakI, reason: `rise speed ${maxRise.toFixed(2)} < ${cfg.minRiseSpeedRatioPerS}` });
      continue;
    }
    // 上升段到峰值之間的資料中斷不得超過上限，否則無法確認這個峰值是由這段上升到達的。
    let longestGap = 0;
    let run = 0;
    for (let k = riseSpeedI; k <= peakI; k++) {
      run = Number.isNaN(h[k]!) ? run + 1 : 0;
      longestGap = Math.max(longestGap, run);
    }
    if (longestGap > cfg.maxGapFramesInRise) {
      rejected.push({ index: peakI, reason: `data gap of ${longestGap} frames between rise and peak` });
      continue;
    }
    // Release = 從手腕高度峰值往回走，最後一次由「上升」轉為「停止上升」的那一幀。
    // （不能從上升速度峰值往後找第一次停止：Set Point 的短暫停頓也會讓速度降到門檻以下。）
    let rel = peakI;
    let releaseInGap = false;
    while (rel - 1 > riseSpeedI) {
      const prev = upSpeed[rel - 1]!;
      if (Number.isNaN(prev)) {
        // 停止上升的那一刻落在資料缺口內：Release 時刻不確定，取缺口後第一幀並標記。
        releaseInGap = true;
        break;
      }
      if (prev > cfg.releaseUpSpeedRatioPerS) break;
      rel--;
    }
    const elbowAtRel = nearestValid(elbowFlex.deg, rel, 2);
    if (!Number.isNaN(elbowAtRel) && elbowAtRel > cfg.maxElbowFlexionAtReleaseDeg) {
      rejected.push({ index: rel, reason: `elbow flexion ${elbowAtRel.toFixed(0)}° > ${cfg.maxElbowFlexionAtReleaseDeg}°` });
      continue;
    }
    candidates.push({ peakI, rel, riseSpeedI, maxRise, elbowAtRel, prominence: pk.prominence, releaseInGap });
  }
  const byPeak = new Map(candidates.map((c) => [c.peakI, c]));
  const kept = suppressClosePeaks(
    rawPeaks.filter((pk) => byPeak.has(pk.index)),
    t,
    cfg.minShotIntervalMs,
  ).map((pk) => byPeak.get(pk.index)!);

  // 安靜判定用「短視窗內的位移範圍」而不是瞬時速度：差分會放大關節抖動，速度門檻在真實資料上不可靠。
  const quietWin = msToFrames(cfg.setupQuietWindowMs);
  const quietAt = (k: number) => {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minK = Infinity, maxK = -Infinity;
    let nW = 0, nK = 0;
    for (let i = Math.max(0, k - quietWin); i <= k; i++) {
      const x = wrist.x[i]!, y = wrist.y[i]!, kf = kneeFlex.deg[i]!;
      if (!Number.isNaN(x) && !Number.isNaN(y)) { nW++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      if (!Number.isNaN(kf)) { nK++; minK = Math.min(minK, kf); maxK = Math.max(maxK, kf); }
    }
    const wristQuiet = nW === 0 || Math.max(maxX - minX, maxY - minY) / H < cfg.setupQuietWristRangeRatio;
    const kneeQuiet = nK === 0 || maxK - minK < cfg.setupQuietKneeRangeDeg;
    return wristQuiet && kneeQuiet;
  };

  const shots: Shot[] = [];
  let prevEnd = -1;
  for (const c of kept) {
    const { rel, maxRise, elbowAtRel } = c;
    if (rel <= prevEnd) continue;
    const issues: ShotIssue[] = [];
    if (c.releaseInGap) issues.push('release_in_gap');

    // ── Dip 底：視窗內手腕最低 ──
    const dipFrom = Math.max(prevEnd + 1, rel - msToFrames(cfg.dipSearchWindowMs));
    let dipBottom = argmin(h, dipFrom, rel - 1);
    if (dipBottom < 0) dipBottom = Math.max(dipFrom, rel - 1);

    // ── Dip 起點：膝屈曲開始增加 或 手腕開始下沉，取較早者 ──
    // 基準取「Dip 底之前最後一個安靜幀」的姿勢（上一球的 Follow-through 手很高，不能拿視窗極值當基準）。
    let dipStart = -1;
    let refI = -1;
    for (let k = dipBottom - 1; k >= dipFrom; k--) {
      if (quietAt(k) && !Number.isNaN(h[k]!)) {
        refI = k;
        break;
      }
    }
    // 膝
    const kneeBaseI = refI >= 0 && !Number.isNaN(kneeFlex.deg[refI]!) ? refI : argmin(kneeFlex.deg, dipFrom, dipBottom);
    if (kneeBaseI >= 0) {
      const base = kneeFlex.deg[kneeBaseI]!;
      let k = dipBottom;
      while (k > kneeBaseI && (Number.isNaN(kneeFlex.deg[k]!) || kneeFlex.deg[k]! > base + cfg.dipOnsetKneeFlexionDeg)) k--;
      if (k < dipBottom) dipStart = k;
    }
    // 手腕
    const preDipHighI = refI >= 0 ? refI : argmax(h, dipFrom, dipBottom);
    if (preDipHighI >= 0 && preDipHighI < dipBottom) {
      const level = h[preDipHighI]!;
      let k = dipBottom;
      while (k > preDipHighI && (Number.isNaN(h[k]!) || h[k]! < level - cfg.dipOnsetWristDropRatio)) k--;
      if (k < dipBottom && (dipStart < 0 || k < dipStart)) dipStart = k;
    }
    if (dipStart < 0) {
      dipStart = dipBottom;
      issues.push('dip_onset_undetermined');
    } else {
      // 門檻式偵測會晚幾幀；往前回溯到動作真正開始（前一幀仍是安靜）的那一幀。
      const backMin = Math.max(prevEnd + 1, dipStart - msToFrames(cfg.dipOnsetBacktrackMaxMs));
      while (dipStart - 1 >= backMin && !quietAt(dipStart - 1)) dipStart--;
    }

    // ── Setup：Dip 起點往前的安靜段 ──
    const setupMin = Math.max(prevEnd + 1, dipStart - msToFrames(cfg.setupMaxMs));
    let setupStart = dipStart;
    for (let k = dipStart - 1; k >= setupMin; k--) {
      if (!quietAt(k)) break;
      setupStart = k;
    }
    if (setupStart === dipStart) issues.push('no_quiet_setup');

    // ── Set Point：Dip 底與 Release 之間最後一次肘屈曲局部極大 ──
    const spLatest = rel - msToFrames(cfg.minSetPointToReleaseMs);
    let setPoint = -1;
    for (let k = spLatest; k > dipBottom; k--) {
      const c = elbowFlex.deg[k]!;
      if (Number.isNaN(c) || c < cfg.minSetPointElbowFlexionDeg) continue;
      const l = nearestValid(elbowFlex.deg, k - 1, 1, 'left');
      const r = nearestValid(elbowFlex.deg, k + 1, 1, 'right');
      if ((Number.isNaN(l) || c >= l) && (Number.isNaN(r) || c > r)) {
        setPoint = k;
        break;
      }
    }
    if (setPoint < 0) {
      const slow = argmin(upSpeed, dipBottom + 1, spLatest);
      if (slow >= 0) {
        setPoint = slow;
        issues.push('set_point_fallback');
      } else {
        setPoint = Math.round((dipBottom + rel) / 2);
        issues.push('set_point_undetermined');
      }
    }
    if (setPoint <= dipBottom) setPoint = Math.min(dipBottom + 1, rel);

    // ── Follow-through 結束 ──
    const ftMax = Math.min(n - 1, rel + msToFrames(cfg.followThroughMaxMs));
    const hRel = h[rel]!;
    const eRel = nearestValid(elbowFlex.deg, rel, 2);
    let ftEnd = -1;
    for (let k = rel + 1; k <= ftMax; k++) {
      const hk = h[k]!;
      const ek = elbowFlex.deg[k]!;
      if (Number.isNaN(hk)) {
        ftEnd = k - 1;
        issues.push('follow_through_gap');
        break;
      }
      if (hk < hRel - cfg.followThroughEndWristDropRatio || (!Number.isNaN(ek) && !Number.isNaN(eRel) && ek > eRel + cfg.followThroughEndElbowFlexionDeg)) {
        ftEnd = k;
        break;
      }
    }
    if (ftEnd < 0) {
      ftEnd = ftMax;
      if (ftMax === rel + msToFrames(cfg.followThroughMaxMs)) issues.push('follow_through_truncated');
    }

    const events: ShotEvents = { setupStart, dipStart, dipBottom, setPoint, release: rel, followThroughEnd: ftEnd };
    const wristValidRatio = ratioValid(wrist.valid, setupStart, ftEnd);
    const elbowValidRatio = ratioValid(elbowFlex.valid, setupStart, ftEnd);
    if (wristValidRatio < cfg.minValidRatioInShot || elbowValidRatio < cfg.minValidRatioInShot) issues.push('low_valid_ratio');

    shots.push({
      index: shots.length,
      events,
      phases: buildPhases(events, t),
      evidence: {
        releaseWristHeightRatio: h[rel]!,
        releaseProminenceRatio: c.prominence,
        maxRiseSpeedRatioPerS: maxRise,
        elbowFlexionAtReleaseDeg: elbowAtRel,
        wristValidRatio,
        elbowValidRatio,
      },
      issues,
      readable: !issues.includes('low_valid_ratio'),
    });
    prevEnd = ftEnd;
  }

  if (shots.length === 0) failures.push('candidates_rejected');
  return { shots, failures, rejected, wristHeightRatio: h };
}

function buildPhases(e: ShotEvents, t: readonly number[]): Phase[] {
  const mk = (name: Phase['name'], a: number, b: number): Phase => ({
    name,
    startIndex: a,
    endIndex: b,
    startMs: t[a]!,
    endMs: t[b]!,
    durationMs: t[b]! - t[a]!,
  });
  return [
    mk('setup', e.setupStart, Math.max(e.setupStart, e.dipStart - 1)),
    mk('dip', e.dipStart, Math.max(e.dipStart, e.dipBottom - 1)),
    mk('rise', e.dipBottom, Math.max(e.dipBottom, e.setPoint - 1)),
    mk('set_point', e.setPoint, Math.max(e.setPoint, e.release - 1)),
    mk('release', e.release, e.release),
    mk('follow_through', Math.min(e.release + 1, e.followThroughEnd), e.followThroughEnd),
  ];
}

function ratioValid(valid: readonly boolean[], from: number, to: number): number {
  let c = 0;
  for (let i = from; i <= to; i++) if (valid[i]) c++;
  return (to - from + 1) > 0 ? c / (to - from + 1) : 0;
}

/** 從 i 往指定方向（或雙向）找最近的有效值，最多 radius 幀；找不到為 NaN。 */
function nearestValid(v: readonly number[], i: number, radius: number, dir: 'both' | 'left' | 'right' = 'both'): number {
  for (let d = 0; d <= radius; d++) {
    if (dir !== 'left' && i + d < v.length && i + d >= 0 && !Number.isNaN(v[i + d]!)) return v[i + d]!;
    if (dir !== 'right' && i - d >= 0 && i - d < v.length && !Number.isNaN(v[i - d]!)) return v[i - d]!;
  }
  return NaN;
}

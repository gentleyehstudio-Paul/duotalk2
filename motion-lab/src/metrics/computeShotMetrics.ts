import { thresholds } from '../config/thresholds';
import { argmax } from '../segmentation/peaks';
import { METRIC_IDS, type MetricId, type MetricValue, type ShotMetrics } from '../types/metrics';
import type { ProcessedTrack } from '../types/series';
import type { Shot } from '../types/shot';

/**
 * 步驟 4：由 ProcessedTrack 與切分結果計算每球的七個首批指標。
 * 每個值都來自時間序列的區間或事件；輸入缺值時回傳 null 與原因。
 */
export function computeShotMetrics(p: ProcessedTrack, shot: Shot): ShotMetrics {
  const cfg = thresholds.metrics;
  const side = p.shootingSide;
  const e = shot.events;
  const knee = p.angles[`knee_${side}`];
  const elbow = p.angles[`elbow_${side}`];
  const trunk = p.angles.trunk_lean;
  const wrist = p.joints[`${side}_wrist`];
  const t = p.t_ms;

  const values = {} as Record<MetricId, MetricValue>;
  const nul = (id: MetricId, reason: string, frameIndex: number | null = null): MetricValue => ({ id, value: null, frameIndex, reason });
  /** Release 時刻落在缺口內時，依賴 Release 精確時刻/姿勢的指標一律不計算。 */
  const releaseUncertain = shot.issues.includes('release_in_gap');
  const RELEASE_GAP_REASON = 'Release 時刻落在資料缺口內';

  // 1. 膝最大屈曲（Dip 起點 → Release）
  {
    const id = 'knee_max_flexion_deg';
    const from = e.dipStart;
    const to = e.release;
    const vr = validRatio(knee.deg, from, to);
    if (vr < cfg.minWindowValidRatio) {
      values[id] = nul(id, `膝角序列在 Dip→Release 區間有效幀僅 ${(vr * 100).toFixed(0)}%`, from);
    } else {
      const i = argmax(knee.deg, from, to);
      values[id] = { id, value: knee.deg[i]!, frameIndex: i, endFrameIndex: to };
    }
  }

  // 2. Set Point 肘屈曲
  {
    const id = 'elbow_flexion_at_set_point_deg';
    if (shot.issues.includes('set_point_undetermined')) {
      values[id] = nul(id, 'Set Point 無法決定', e.setPoint);
    } else {
      const v = nearestValid(elbow.deg, e.setPoint, cfg.eventValueSearchFrames);
      values[id] = Number.isNaN(v) ? nul(id, 'Set Point 前後肘角缺值', e.setPoint) : { id, value: v, frameIndex: e.setPoint };
    }
  }

  // 3. 出手高度（相對身高）
  {
    const id = 'release_height_ratio';
    const ground = groundY(p, shot);
    const wy = nearestValid(wrist.y, e.release, cfg.eventValueSearchFrames);
    if (releaseUncertain) values[id] = nul(id, RELEASE_GAP_REASON, e.release);
    else if (!(p.bodyHeightPx > 0)) values[id] = nul(id, '無法估計身高', e.release);
    else if (Number.isNaN(ground)) values[id] = nul(id, '腳踝缺值，無法定義地面', e.release);
    else if (Number.isNaN(wy)) values[id] = nul(id, 'Release 前後手腕缺值', e.release);
    else values[id] = { id, value: (ground - wy) / p.bodyHeightPx, frameIndex: e.release };
  }

  // 4. Dip → Release 時間
  {
    const id = 'dip_to_release_ms';
    values[id] = releaseUncertain
      ? nul(id, RELEASE_GAP_REASON, e.dipBottom)
      : { id, value: t[e.release]! - t[e.dipBottom]!, frameIndex: e.dipBottom, endFrameIndex: e.release };
  }

  // 5. 膝伸展 → 肘伸展時間差
  {
    const id = 'knee_elbow_extension_lag_ms';
    const kneeMax = values.knee_max_flexion_deg;
    if (kneeMax.value === null || kneeMax.frameIndex === null) values[id] = nul(id, '膝最大屈曲無法判讀，無法定義膝伸展起點', e.setPoint);
    else if (values.elbow_flexion_at_set_point_deg.value === null) values[id] = nul(id, 'Set Point 無法判讀，無法定義肘伸展起點', e.setPoint);
    else values[id] = { id, value: t[e.setPoint]! - t[kneeMax.frameIndex]!, frameIndex: kneeMax.frameIndex, endFrameIndex: e.setPoint };
  }

  // 6. 軀幹前傾角（Release）
  {
    const id = 'trunk_lean_at_release_deg';
    const v = nearestValid(trunk.deg, e.release, cfg.eventValueSearchFrames);
    if (releaseUncertain) values[id] = nul(id, RELEASE_GAP_REASON, e.release);
    else if (p.facing === 'unknown') values[id] = nul(id, '面向未知，無法決定前傾方向', e.release);
    else values[id] = Number.isNaN(v) ? nul(id, 'Release 前後肩/髖缺值', e.release) : { id, value: v, frameIndex: e.release };
  }

  // 7. Follow-through 停留時間
  {
    const id = 'follow_through_hold_ms';
    if (releaseUncertain) values[id] = nul(id, RELEASE_GAP_REASON, e.release);
    else if (shot.issues.includes('follow_through_gap')) values[id] = nul(id, 'Follow-through 期間資料中斷', e.release);
    else if (shot.issues.includes('follow_through_truncated')) values[id] = nul(id, 'Follow-through 超過上限仍未結束', e.release);
    else values[id] = { id, value: t[e.followThroughEnd]! - t[e.release]!, frameIndex: e.release, endFrameIndex: e.followThroughEnd };
  }

  for (const id of METRIC_IDS) if (!values[id]) values[id] = nul(id, '未計算');
  return { shotIndex: shot.index, values };
}

/** 地面 y：該球 Setup 區間內較低腳踝 y 的中位數；Setup 太短則用整段。 */
function groundY(p: ProcessedTrack, shot: Shot): number {
  const la = p.joints.left_ankle.y;
  const ra = p.joints.right_ankle.y;
  const lower = (i: number) => {
    const a = la[i]!;
    const b = ra[i]!;
    if (Number.isNaN(a)) return b;
    if (Number.isNaN(b)) return a;
    return Math.max(a, b);
  };
  const setup = shot.phases[0]!;
  const ranges: Array<[number, number]> =
    setup.endIndex - setup.startIndex + 1 >= thresholds.metrics.groundMinSetupFrames ? [[setup.startIndex, setup.endIndex]] : [];
  ranges.push([0, p.frames.length - 1]);
  for (const [a, b] of ranges) {
    const xs: number[] = [];
    for (let i = a; i <= b; i++) {
      const v = lower(i);
      if (!Number.isNaN(v)) xs.push(v);
    }
    if (xs.length) {
      xs.sort((x, y) => x - y);
      const m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
    }
  }
  return NaN;
}

function validRatio(v: readonly number[], from: number, to: number): number {
  let c = 0;
  for (let i = from; i <= to; i++) if (!Number.isNaN(v[i]!)) c++;
  return to >= from ? c / (to - from + 1) : 0;
}

function nearestValid(v: readonly number[], i: number, radius: number): number {
  for (let d = 0; d <= radius; d++) {
    if (i + d < v.length && !Number.isNaN(v[i + d]!)) return v[i + d]!;
    if (i - d >= 0 && !Number.isNaN(v[i - d]!)) return v[i - d]!;
  }
  return NaN;
}

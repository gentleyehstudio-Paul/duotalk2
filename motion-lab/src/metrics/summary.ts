import { thresholds } from '../config/thresholds';
import { METRIC_IDS, type Baseline, type BaselineEntry, type Deviation, type MetricId, type MetricStats, type SessionMetricsSummary, type ShotMetrics } from '../types/metrics';
import { METRIC_DEFINITIONS } from './definitions';

function basicStats(xs: number[]) {
  const n = xs.length;
  if (n === 0) return { mean: null, sd: null, min: null, max: null, median: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(n / 2);
  return { mean, sd, min: s[0]!, max: s[n - 1]!, median: n % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2 };
}

/** Session 層級彙總：每個指標的 n、平均、標準差、CV（球數不足或指標不適用時 null 並說明）。 */
export function summarizeSession(shots: ShotMetrics[]): SessionMetricsSummary {
  const minN = thresholds.shots.minShotsForConsistency;
  const out = {} as SessionMetricsSummary;
  for (const id of METRIC_IDS) {
    const values = shots.map((s) => s.values[id].value);
    const xs = values.filter((v): v is number => v !== null && !Number.isNaN(v));
    const b = basicStats(xs);
    let cv: number | null = null;
    let cvReason: string | undefined;
    if (!METRIC_DEFINITIONS[id].cvMeaningful) cvReason = '有號量，以標準差表示一致性';
    else if (xs.length < minN) cvReason = `球數不足（${xs.length} < ${minN}），無法計算一致性`;
    else if (b.mean === null || Math.abs(b.mean) < 1e-9) cvReason = '平均接近 0，CV 無意義';
    else cv = b.sd! / Math.abs(b.mean);
    const stats: MetricStats = { n: xs.length, mean: b.mean, sd: b.sd, cv, min: b.min, max: b.max, median: b.median, values };
    if (cvReason) stats.cvReason = cvReason;
    out[id] = stats;
  }
  return out;
}

export interface BaselineSource {
  sessionId: string;
  metrics: ShotMetrics;
}

/** 個人基準：先前 Session 的所有可讀球（排除目前 Session）。 */
export function computeBaseline(prior: BaselineSource[], excludeSessionId?: string): Baseline {
  const minShots = thresholds.baseline.minShots;
  const rows = prior.filter((r) => r.sessionId !== excludeSessionId);
  const out = {} as Baseline;
  for (const id of METRIC_IDS) {
    const xs: number[] = [];
    const sessions = new Set<string>();
    for (const r of rows) {
      const v = r.metrics.values[id]?.value;
      if (v !== null && v !== undefined && !Number.isNaN(v)) {
        xs.push(v);
        sessions.add(r.sessionId);
      }
    }
    if (xs.length < minShots) {
      out[id] = null;
      continue;
    }
    const b = basicStats(xs);
    const entry: BaselineEntry = { n: xs.length, sessions: sessions.size, mean: b.mean!, sd: b.sd! };
    out[id] = entry;
  }
  return out;
}

/** 本次平均相對個人基準的偏離：差值與標準差倍數（基準 sd 太小時 z 為 null）。 */
export function deviationFromBaseline(id: MetricId, current: MetricStats, baseline: BaselineEntry | null): Deviation | null {
  if (!baseline || current.mean === null) return null;
  const minSd = thresholds.baseline.minBaselineSd[METRIC_DEFINITIONS[id].unit];
  const diff = current.mean - baseline.mean;
  return { diff, z: baseline.sd >= minSd ? diff / baseline.sd : null };
}

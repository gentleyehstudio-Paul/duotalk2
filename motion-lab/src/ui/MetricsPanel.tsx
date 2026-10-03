import { thresholds } from '../config/thresholds';
import { formatMetric, METRIC_DEFINITIONS, UNIT_LABEL } from '../metrics/definitions';
import { deviationFromBaseline } from '../metrics/summary';
import { METRIC_IDS, type Baseline, type MetricId, type SessionMetricsSummary, type ShotMetrics } from '../types/metrics';

interface Props {
  shots: ShotMetrics[];
  summary: SessionMetricsSummary;
  baseline: Baseline | null;
  /** 點擊某球某指標 → 以該指標的代表幀為中心循環播放 ±N 幀。 */
  onShowEvent: (frameIndex: number) => void;
}

/**
 * 步驟 4 檢視：每球 × 七指標、Session 平均/標準差/CV、個人基準與偏離。
 * 不顯示任何總分或好壞判定；所有數字都可點擊回到對應的動態片段。
 */
export function MetricsPanel({ shots, summary, baseline, onShowEvent }: Props) {
  const N = thresholds.display.eventContextFrames;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="quality metrics">
        <thead>
          <tr>
            <th>指標</th>
            {shots.map((s) => (
              <th key={s.shotIndex}>#{s.shotIndex + 1}</th>
            ))}
            <th>平均 ± SD</th>
            <th>一致性</th>
            <th>個人基準</th>
            <th>偏離</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_IDS.map((id) => (
            <MetricRow key={id} id={id} shots={shots} summary={summary} baseline={baseline} onShowEvent={onShowEvent} />
          ))}
        </tbody>
      </table>
      <p className="note" style={{ marginTop: 8 }}>
        點擊任一數值會以該指標的代表幀為中心循環播放 ±{N} 幀。一致性 = 變異係數 CV（SD ÷ |平均|），球數少於{' '}
        {thresholds.shots.minShotsForConsistency} 球或有號量不計算。個人基準 = 先前已儲存 Session 的所有可讀球（至少{' '}
        {thresholds.baseline.minShots} 球）。
      </p>
    </div>
  );
}

function MetricRow({ id, shots, summary, baseline, onShowEvent }: Props & { id: MetricId }) {
  const def = METRIC_DEFINITIONS[id];
  const st = summary[id];
  const base = baseline?.[id] ?? null;
  const dev = deviationFromBaseline(id, st, base);
  return (
    <tr>
      <td title={`${def.source}\n${def.description}`}>
        <b>{def.name}</b>
        <br />
        <span className="note">{UNIT_LABEL[def.unit]}</span>
      </td>
      {shots.map((s) => {
        const mv = s.values[id];
        return (
          <td key={s.shotIndex}>
            {mv.value === null ? (
              <span className="tag bad" title={mv.reason}>
                無法判讀
              </span>
            ) : (
              <button className="link" onClick={() => mv.frameIndex !== null && onShowEvent(mv.frameIndex)} title={`代表幀 ${mv.frameIndex}`}>
                {formatMetric(id, mv.value)}
              </button>
            )}
            {mv.value === null && mv.reason && (
              <>
                <br />
                <span className="note" style={{ fontSize: 11 }}>
                  {mv.reason}
                </span>
              </>
            )}
          </td>
        );
      })}
      <td>
        {st.mean === null ? '—' : `${formatMetric(id, st.mean)} ± ${st.sd === null ? '—' : st.sd.toFixed(def.decimals)}`}
        <br />
        <span className="note">n = {st.n}</span>
      </td>
      <td>
        {st.cv !== null ? `CV ${(st.cv * 100).toFixed(1)}%` : <span className="note">{st.cvReason}</span>}
      </td>
      <td>
        {base ? (
          <>
            {formatMetric(id, base.mean)} ± {base.sd.toFixed(def.decimals)}
            <br />
            <span className="note">
              {base.n} 球 / {base.sessions} 場
            </span>
          </>
        ) : (
          <span className="note">尚無基準</span>
        )}
      </td>
      <td>
        {dev ? (
          <>
            {dev.diff >= 0 ? '+' : ''}
            {formatMetric(id, dev.diff)}
            <br />
            <span className="note">{dev.z === null ? '基準 SD 太小' : `${dev.z >= 0 ? '+' : ''}${dev.z.toFixed(2)} SD`}</span>
          </>
        ) : (
          '—'
        )}
      </td>
    </tr>
  );
}

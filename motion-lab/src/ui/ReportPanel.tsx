import { memo, useState } from 'react';
import { thresholds } from '../config/thresholds';
import { METRIC_DEFINITIONS } from '../metrics/definitions';
import { reportToMarkdown } from '../rules/engine';
import type { ExperimentRecord } from '../storage/db';
import type { Recommendation, Report } from '../types/report';

interface Props {
  report: Report;
  sessionName: string;
  onShowEvent: (frameIndex: number) => void;
  /** 使用者決定開始這條建議的實驗（Cue + 開始日期）。 */
  onStartExperiment: (rec: Recommendation) => void;
  openExperiments: ExperimentRecord[];
  /** 把目前 Session 的指標值記錄為某個實驗的 Retest 結果。 */
  onRecordRetest: (exp: ExperimentRecord) => void;
  currentValueFor: (metric: ExperimentRecord['metric']) => number | null;
}

const KIND_LABEL: Record<Report['unreadable'][number]['kind'], string> = {
  camera: '機位/畫面',
  occlusion: '遮擋/缺值',
  confidence: '信心/球數不足',
  segmentation: '切分',
  baseline: '基準',
};

/**
 * 步驟 6：報告。固定三段：重點整理（3–5 條）、建議（最多 N 條，Observation → Cue → Drill → Retest）、無法判讀項目。
 * 沒有任何總分、等級或好壞判定；每條都可回到對應的 ±N 幀片段。
 */
export const ReportPanel = memo(function ReportPanel({ report, sessionName, onShowEvent, onStartExperiment, openExperiments, onRecordRetest, currentValueFor }: Props) {
  const [showEval, setShowEval] = useState(false);
  const [copied, setCopied] = useState(false);
  const md = reportToMarkdown(report, sessionName);

  const download = () => {
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${sessionName}.report.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪貼簿不可用時忽略 */
    }
  };

  return (
    <div className="report">
      <p className="note">
        分析 {report.shotsAnalyzed} 球（可讀 {report.shotsReadable} 球）· 產生於 {new Date(report.generatedAt).toLocaleString()}
      </p>

      <h3>1. 重點整理</h3>
      {report.highlights.length === 0 ? (
        <p className="note">無可讀指標。</p>
      ) : (
        <table className="quality">
          <thead>
            <tr>
              <th>指標</th>
              <th>本次</th>
              <th>個人基準</th>
              <th>偏離</th>
              <th>一致性</th>
            </tr>
          </thead>
          <tbody>
            {report.highlights.map((h) => (
              <tr key={h.metric}>
                <td>
                  <b>{h.name}</b>
                </td>
                <td>
                  {h.frameIndex !== null ? (
                    <button className="link" onClick={() => onShowEvent(h.frameIndex!)} title="播放代表幀 ±N 幀">
                      {h.current}
                    </button>
                  ) : (
                    h.current
                  )}{' '}
                  <span className="note">n={h.n}</span>
                </td>
                <td>{h.baseline}</td>
                <td>{h.deviation}</td>
                <td>{h.consistency}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>2. 建議（最多 {thresholds.report.maxRecommendations} 條）</h3>
      {report.recommendations.length === 0 ? (
        <p className="note">本次沒有符合條件的建議（規則條件未成立，或尚無個人基準）。</p>
      ) : (
        <ol className="recs">
          {report.recommendations.map((r) => {
            const already = openExperiments.some((e) => e.ruleId === r.ruleId && !e.retest);
            return (
              <li key={r.ruleId}>
                <div>
                  <b>Observation</b>{' '}
                  {r.frameIndex !== null ? (
                    <button className="link" onClick={() => onShowEvent(r.frameIndex!)} title="播放代表幀 ±N 幀">
                      {r.observation}
                    </button>
                  ) : (
                    r.observation
                  )}
                </div>
                <div>
                  <b>Cue</b> {r.cue}
                </div>
                <div>
                  <b>Drill</b> {r.drill}
                </div>
                <div>
                  <b>Retest</b> 目標：{r.retest.target}（{METRIC_DEFINITIONS[r.retest.metric].name}）· 方式：{r.retest.method}
                </div>
                <div style={{ marginTop: 4 }}>
                  <button className="secondary" onClick={() => onStartExperiment(r)} disabled={already}>
                    {already ? '實驗進行中' : '開始這個實驗（記錄 Cue 與開始日期）'}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <h3>3. 無法判讀項目</h3>
      {report.unreadable.length === 0 ? (
        <p className="note">無。</p>
      ) : (
        <ul className="unreadable">
          {report.unreadable.map((u, i) => (
            <li key={i}>
              <span className="tag">{KIND_LABEL[u.kind]}</span> {u.text}
            </li>
          ))}
        </ul>
      )}

      {openExperiments.length > 0 && (
        <>
          <h3>進行中的實驗（Retest）</h3>
          <table className="quality">
            <thead>
              <tr>
                <th>Cue</th>
                <th>指標</th>
                <th>開始時的值</th>
                <th>目標</th>
                <th>本次</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {openExperiments.map((e) => {
                const cur = currentValueFor(e.metric);
                return (
                  <tr key={e.id}>
                    <td>
                      {e.cue}
                      <br />
                      <span className="note">開始 {new Date(e.startedAt).toLocaleDateString()}</span>
                    </td>
                    <td>{METRIC_DEFINITIONS[e.metric].name}</td>
                    <td>{e.startValue === null ? '—' : e.startValue.toFixed(METRIC_DEFINITIONS[e.metric].decimals)}</td>
                    <td>{e.target}</td>
                    <td>{cur === null ? '—' : cur.toFixed(METRIC_DEFINITIONS[e.metric].decimals)}</td>
                    <td>
                      <button className="secondary" onClick={() => onRecordRetest(e)} disabled={cur === null}>
                        記錄為 Retest 結果
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="row" style={{ marginTop: 12 }}>
        <button className="secondary" onClick={download}>
          下載報告（Markdown）
        </button>
        <button className="secondary" onClick={copy}>
          {copied ? '已複製' : '複製報告'}
        </button>
        <button className="secondary" onClick={() => setShowEval((v) => !v)}>
          {showEval ? '隱藏' : '顯示'}規則評估明細（{report.evaluations.filter((e) => e.triggered).length} / {report.evaluations.length} 觸發）
        </button>
      </div>
      {showEval && (
        <table className="quality" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>規則</th>
              <th>指標</th>
              <th>結果</th>
              <th>原因 / 數值</th>
            </tr>
          </thead>
          <tbody>
            {report.evaluations.map((e) => (
              <tr key={e.ruleId}>
                <td>
                  <code>{e.ruleId}</code>
                </td>
                <td>{METRIC_DEFINITIONS[e.metric].name}</td>
                <td>{e.triggered ? <span className="tag warn">觸發</span> : <span className="tag">未觸發</span>}</td>
                <td className="note">{e.triggered ? `z ${e.values.z?.toFixed(2) ?? '—'} · cv ${e.values.cv !== null ? (e.values.cv * 100).toFixed(1) + '%' : '—'}` : e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
});

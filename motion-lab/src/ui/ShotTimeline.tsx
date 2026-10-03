import { useRef } from 'react';
import { thresholds } from '../config/thresholds';
import type { ProcessedTrack } from '../types/series';
import { PHASE_NAMES, type PhaseName, type SegmentationFailure, type SegmentationResult, type Shot, type ShotIssue } from '../types/shot';
import { chartColors } from './chartColors';

const PHASE_LABEL: Record<PhaseName, string> = {
  setup: 'Setup',
  dip: 'Dip',
  rise: 'Rise',
  set_point: 'Set Point',
  release: 'Release',
  follow_through: 'Follow-through',
};

const ISSUE_LABEL: Record<ShotIssue, string> = {
  low_valid_ratio: '投籃側手腕/手肘有效幀不足',
  release_in_gap: 'Release 時刻落在資料缺口內（取缺口後第一幀，時刻不確定）',
  dip_onset_undetermined: '找不到下蹲/下沉起點（Dip 起點 = Dip 底）',
  no_quiet_setup: 'Dip 前沒有安靜的 Setup 段',
  set_point_fallback: 'Set Point 以手腕上升速度最小點替代',
  set_point_undetermined: '無法決定 Set Point（取 Rise 中點）',
  follow_through_truncated: 'Follow-through 達上限仍未結束（已截斷）',
  follow_through_gap: 'Follow-through 期間資料中斷',
};

const FAILURE_LABEL: Record<SegmentationFailure, string> = {
  no_body_scale: '無法估計身高尺度（鼻子/腳踝/軀幹都不可用），無法切分',
  wrist_unreadable: '投籃側手腕幾乎沒有有效幀，無法切分',
  no_release_candidates: '沒有找到手腕高於肩線且夠突出的高度峰值（沒有出手動作，或機位不符）',
  candidates_rejected: '有手腕高度峰值，但都不符合上升速度／肘伸展條件（可能是舉手而非出手）',
};

export interface EventLoop {
  center: number;
}

interface Props {
  processed: ProcessedTrack;
  result: SegmentationResult;
  frameIndex: number;
  onSeek: (index: number) => void;
  /** 目前的 ±N 幀循環（由 App 持有，指標面板也會觸發）。 */
  loop: EventLoop | null;
  setLoop: (l: EventLoop | null) => void;
}

/**
 * 步驟 3 檢視：時間軸上標示每球的六個階段，點擊跳幀；
 * Release 等關鍵時刻一律以 ±N 幀循環片段呈現（規則 1），不提供靜態單幀「結論」。
 * ±N 循環本身由播放器（usePlayback）執行，這裡只負責設定 loop。
 */
export function ShotTimeline({ processed, result, frameIndex, onSeek, loop, setLoop }: Props) {
  const n = processed.frames.length;
  const barRef = useRef<HTMLDivElement>(null);
  const N = thresholds.display.eventContextFrames;

  const pct = (i: number) => `${(i / Math.max(1, n - 1)) * 100}%`;
  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = barRef.current!.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setLoop(null);
    onSeek(Math.round(u * (n - 1)));
  };

  return (
    <div>
      <div ref={barRef} className="timeline" onClick={onBarClick} title="點擊跳到該時間">
        {result.shots.map((s) =>
          s.phases.map((ph) =>
            ph.name === 'release' ? (
              <div
                key={`${s.index}-${ph.name}`}
                className="tl-release"
                style={{ left: pct(ph.startIndex), background: phaseColor('release') }}
              />
            ) : (
              <div
                key={`${s.index}-${ph.name}`}
                className="tl-seg"
                style={{ left: pct(ph.startIndex), width: `calc(${pct(ph.endIndex + 1)} - ${pct(ph.startIndex)})`, background: phaseColor(ph.name) }}
              />
            ),
          ),
        )}
        <div className="tl-cursor" style={{ left: pct(frameIndex) }} />
      </div>
      <div className="row note" style={{ gap: 14, marginTop: 6 }}>
        {PHASE_NAMES.map((p) => (
          <span key={p}>
            <i className="swatch" style={{ background: phaseColor(p) }} /> {PHASE_LABEL[p]}
          </span>
        ))}
        <span>目前：{currentPhaseLabel(result.shots, frameIndex)}</span>
        {loop && (
          <button className="secondary" onClick={() => setLoop(null)}>
            停止循環（中心幀 {loop.center}）
          </button>
        )}
      </div>

      {result.failures.length > 0 && (
        <ul className="note" style={{ marginTop: 10 }}>
          {result.failures.map((f) => (
            <li key={f} className="error">
              {FAILURE_LABEL[f]}
            </li>
          ))}
        </ul>
      )}

      {result.shots.length > 0 && (
        <table className="quality" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>球</th>
              {PHASE_NAMES.filter((p) => p !== 'release').map((p) => (
                <th key={p}>{PHASE_LABEL[p]} (ms)</th>
              ))}
              <th>Release t</th>
              <th>依據</th>
              <th>備註</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.shots.map((s) => (
              <tr key={s.index}>
                <td>#{s.index + 1}</td>
                {s.phases
                  .filter((p) => p.name !== 'release')
                  .map((p) => (
                    <td key={p.name}>
                      <button className="link" onClick={() => { setLoop(null); onSeek(p.startIndex); }} title="跳到階段起點">
                        {Math.round(p.durationMs)}
                      </button>
                    </td>
                  ))}
                <td>{(processed.t_ms[s.events.release]! / 1000).toFixed(3)} s</td>
                <td className="note">
                  腕高 {s.evidence.releaseWristHeightRatio.toFixed(2)} · 上升 {s.evidence.maxRiseSpeedRatioPerS.toFixed(2)}/s · 肘屈{' '}
                  {Number.isNaN(s.evidence.elbowFlexionAtReleaseDeg) ? '—' : `${s.evidence.elbowFlexionAtReleaseDeg.toFixed(0)}°`}
                </td>
                <td className="note">
                  {!s.readable && <span className="tag bad">無法判讀</span>}{' '}
                  {s.issues.map((i) => ISSUE_LABEL[i]).join('；') || '—'}
                </td>
                <td>
                  <button
                    className={loop?.center === s.events.release ? '' : 'secondary'}
                    onClick={() => setLoop(loop?.center === s.events.release ? null : { center: s.events.release })}
                  >
                    {loop?.center === s.events.release ? '停止' : `Release ±${N} 幀`}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.rejected.length > 0 && (
        <p className="note" style={{ marginTop: 8 }}>
          被否決的候選：{result.rejected.map((r) => `t=${(processed.t_ms[r.index]! / 1000).toFixed(2)}s（${r.reason}）`).join('、')}
        </p>
      )}
    </div>
  );
}

function currentPhaseLabel(shots: Shot[], i: number): string {
  for (const s of shots) {
    for (const ph of s.phases) {
      if (i >= ph.startIndex && i <= ph.endIndex) return `#${s.index + 1} ${PHASE_LABEL[ph.name]}`;
    }
  }
  return '—';
}

/** 階段色：序位類別，固定順序指派（dataviz 驗證過的深色面板色）。 */
export function phaseColor(p: PhaseName): string {
  const map: Record<PhaseName, string> = {
    setup: chartColors.raw,
    dip: chartColors.series[1],
    rise: chartColors.series[2],
    set_point: chartColors.series[0],
    release: chartColors.series[3],
    follow_through: chartColors.phaseExtra,
  };
  return map[p];
}

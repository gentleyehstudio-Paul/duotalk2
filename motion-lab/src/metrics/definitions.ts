import type { MetricDefinition, MetricId } from '../types/metrics';

export const METRIC_DEFINITIONS: Record<MetricId, MetricDefinition> = {
  knee_max_flexion_deg: {
    id: 'knee_max_flexion_deg',
    name: '膝最大屈曲',
    unit: 'deg',
    decimals: 1,
    source: 'Dip 起點 → Release 區間的膝屈曲序列（投籃側）',
    description: '區間內膝屈曲量的最大值（0° = 伸直）。對應原需求的「膝屈最小角」，以屈曲量呈現。',
    cvMeaningful: true,
  },
  elbow_flexion_at_set_point_deg: {
    id: 'elbow_flexion_at_set_point_deg',
    name: 'Set Point 肘屈曲',
    unit: 'deg',
    decimals: 1,
    source: 'Set Point 事件幀的肘屈曲（投籃側）',
    description: 'Release 前最後一次肘屈曲局部極大時的屈曲量。',
    cvMeaningful: true,
  },
  release_height_ratio: {
    id: 'release_height_ratio',
    name: '出手高度（相對身高）',
    unit: 'ratio',
    decimals: 2,
    source: 'Release 事件幀的手腕 y 與該球 Setup 區間的地面（較低腳踝 y 中位數）',
    description: '(地面 y − Release 手腕 y) ÷ 估計身高。1.0 = 與身高同高。',
    cvMeaningful: true,
  },
  dip_to_release_ms: {
    id: 'dip_to_release_ms',
    name: 'Dip → Release 時間',
    unit: 'ms',
    decimals: 0,
    source: 'Dip 底（手腕最低）到 Release 的時間差',
    description: '手腕由最低點到出手所需時間。',
    cvMeaningful: true,
  },
  knee_elbow_extension_lag_ms: {
    id: 'knee_elbow_extension_lag_ms',
    name: '膝伸展 → 肘伸展時間差',
    unit: 'ms',
    decimals: 0,
    source: '膝最大屈曲幀（膝開始伸展）到 Set Point 幀（肘開始伸展）',
    description: '正值 = 肘在膝之後開始伸展（動力鏈由下而上）；負值 = 肘先於膝。',
    cvMeaningful: false,
  },
  trunk_lean_at_release_deg: {
    id: 'trunk_lean_at_release_deg',
    name: '軀幹前傾角（Release）',
    unit: 'deg',
    decimals: 1,
    source: 'Release 事件幀的軀幹相對鉛直線傾角',
    description: '正值 = 向面向方向前傾，負值 = 後仰。',
    cvMeaningful: false,
  },
  follow_through_hold_ms: {
    id: 'follow_through_hold_ms',
    name: 'Follow-through 停留時間',
    unit: 'ms',
    decimals: 0,
    source: 'Release 到 Follow-through 結束（手腕下降或手臂收回）',
    description: '出手後手臂維持伸展的時間。',
    cvMeaningful: true,
  },
};

export const UNIT_LABEL: Record<MetricDefinition['unit'], string> = { deg: '°', ms: 'ms', ratio: '×身高' };

export function formatMetric(id: MetricId, v: number | null): string {
  if (v === null || Number.isNaN(v)) return '—';
  const d = METRIC_DEFINITIONS[id];
  return `${v.toFixed(d.decimals)}${d.unit === 'ratio' ? '' : d.unit === 'deg' ? '°' : ' ms'}`;
}

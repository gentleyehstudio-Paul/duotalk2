import { memo, useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ProcessedTrack } from '../../types/series';
import type { SegmentationResult } from '../../types/shot';
import { chartColors } from '../chartColors';
import { phaseColor } from '../ShotTimeline';
import { CursorOverlay } from './CursorOverlay';

interface Props {
  processed: ProcessedTrack;
  segmentation: SegmentationResult | null;
  frameIndex: number;
  onSeek: (index: number) => void;
}

const nn = (v: number) => (Number.isNaN(v) ? null : Math.round(v * 10) / 10);
const Y_AXIS_W = 44;
const MARGIN_R = 12;
const ROW_H = 110;
const X_AXIS_H = 20;

/**
 * 規則 2：膝 / 髖 / 肘 / 肩 角度曲線與影片時間軸連動。
 * 四張小圖各自一個 y 軸（不做雙軸），背景色帶 = 自動切分的階段，紅線 = Release，白色游標 = 目前幀；點擊任一處跳到該幀。
 * 圖表本身 memo，不隨 frameIndex 重繪；游標是 DOM 覆蓋層。
 */
export function AngleCurves({ processed, segmentation, frameIndex, onSeek }: Props) {
  const tMax = processed.t_ms[processed.t_ms.length - 1] || 1;
  const frac = (processed.t_ms[frameIndex] ?? 0) / tMax;
  const side = processed.shootingSide;
  const labels = [`膝屈曲 (${side})`, `髖屈曲 (${side})`, `肘屈曲 (${side})`, `肩抬臂角 (${side})`];
  return (
    <div className="angle-curves">
      {(['knee', 'hip', 'elbow', 'shoulder'] as const).map((k, ri) => (
        <div key={k} style={{ position: 'relative', width: '100%', height: ROW_H }}>
          <Charts processed={processed} segmentation={segmentation} onSeek={onSeek} which={k} label={labels[ri]!} last={ri === 3} />
          <CursorOverlay frac={frac} leftPx={Y_AXIS_W} rightPx={MARGIN_R} topPx={6} bottomPx={ri === 3 ? X_AXIS_H : 0} />
        </div>
      ))}
    </div>
  );
}

interface ChartProps {
  processed: ProcessedTrack;
  segmentation: SegmentationResult | null;
  onSeek: (index: number) => void;
  which: 'knee' | 'hip' | 'elbow' | 'shoulder';
  label: string;
  last: boolean;
}

const Charts = memo(function Charts({ processed, segmentation, onSeek, which, label, last }: ChartProps) {
  const side = processed.shootingSide;
  const data = useMemo(() => {
    const deg = processed.angles[`${which}_${side}`].deg;
    return processed.t_ms.map((t, i) => ({ i, t: t / 1000, v: nn(deg[i]!) }));
  }, [processed, which, side]);
  const tMax = (processed.t_ms[processed.t_ms.length - 1] ?? 0) / 1000;

  const handleClick = (state: unknown) => {
    const s = state as { activeTooltipIndex?: number | string | null; activeLabel?: number | string | null } | null;
    const idx = s?.activeTooltipIndex;
    if (idx !== undefined && idx !== null && idx !== '' && Number.isFinite(Number(idx))) {
      onSeek(Number(idx));
      return;
    }
    if (s?.activeLabel === undefined || s.activeLabel === null) return;
    const ms = Number(s.activeLabel) * 1000;
    let best = 0;
    processed.t_ms.forEach((t, i) => {
      if (Math.abs(t - ms) < Math.abs(processed.t_ms[best]! - ms)) best = i;
    });
    onSeek(best);
  };

  const bands = useMemo(
    () =>
      segmentation?.shots.flatMap((s) =>
        s.phases
          .filter((ph) => ph.name !== 'release')
          .map((ph) => ({
            key: `${s.index}-${ph.name}`,
            x1: processed.t_ms[ph.startIndex]! / 1000,
            x2: processed.t_ms[Math.min(ph.endIndex + 1, processed.t_ms.length - 1)]! / 1000,
            color: phaseColor(ph.name),
          })),
      ) ?? [],
    [segmentation, processed],
  );
  const releases = segmentation?.shots.map((s) => processed.t_ms[s.events.release]! / 1000) ?? [];

  return (
    <>
      <ResponsiveContainer>
        <LineChart data={data} onClick={handleClick} margin={{ top: 6, right: MARGIN_R, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          {bands.map((b) => (
            <ReferenceArea key={b.key} x1={b.x1} x2={b.x2} fill={b.color} fillOpacity={0.14} strokeOpacity={0} />
          ))}
          {releases.map((x, k) => (
            <ReferenceLine key={k} x={x} stroke={phaseColor('release')} strokeWidth={1.5} />
          ))}
          <XAxis
            dataKey="t"
            type="number"
            domain={[0, tMax]}
            tick={last ? { fill: chartColors.axis, fontSize: 10 } : false}
            tickFormatter={(v: number) => `${v.toFixed(1)}s`}
            stroke={chartColors.grid}
            height={last ? X_AXIS_H : 1}
          />
          <YAxis tick={{ fill: chartColors.axis, fontSize: 10 }} stroke={chartColors.grid} width={Y_AXIS_W} unit="°" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.grid}`, fontSize: 11, padding: '2px 6px' }}
            labelFormatter={(v) => `t = ${Number(v).toFixed(3)} s`}
            formatter={(v) => [`${v}°`, label]}
          />
          <Line name={label} dataKey="v" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="curve-label">{label}</div>
    </>
  );
});

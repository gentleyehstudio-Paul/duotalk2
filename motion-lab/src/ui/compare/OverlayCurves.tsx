import { memo, useMemo } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { overlaySeries, type AlignedSide, type TauRange } from '../../compare/align';
import { chartColors } from '../chartColors';
import { CursorOverlay } from '../player/CursorOverlay';
import { phaseColor } from '../ShotTimeline';

interface Props {
  a: AlignedSide;
  b: AlignedSide;
  range: TauRange;
  tau: number;
  onSeek: (tau: number) => void;
}

const Y_AXIS_W = 44;
const MARGIN_R = 12;
const ROW_H = 120;
const X_AXIS_H = 20;
const LEGEND_H = 18;

/** 四條角度曲線（膝、髖、肘、肩）在 τ 軸上疊圖：A 金、B 紫；紅線 = Release。點擊跳到該 τ。 */
export function OverlayCurves({ a, b, range, tau, onSeek }: Props) {
  const frac = (tau - range.minMs) / Math.max(1, range.maxMs - range.minMs);
  const rows = [
    { key: 'knee', label: '膝屈曲' },
    { key: 'hip', label: '髖屈曲' },
    { key: 'elbow', label: '肘屈曲' },
    { key: 'shoulder', label: '肩抬臂角' },
  ] as const;
  return (
    <div className="angle-curves">
      {rows.map((r, i) => (
        <div key={r.key} style={{ position: 'relative', width: '100%', height: ROW_H }}>
          <Chart a={a} b={b} range={range} which={r.key} label={r.label} last={i === rows.length - 1} onSeek={onSeek} />
          <CursorOverlay frac={frac} leftPx={Y_AXIS_W} rightPx={MARGIN_R} topPx={6} bottomPx={(i === rows.length - 1 ? X_AXIS_H : 0) + (i === 0 ? LEGEND_H : 0)} />
        </div>
      ))}
    </div>
  );
}

const Chart = memo(function Chart({ a, b, range, which, label, last, onSeek }: { a: AlignedSide; b: AlignedSide; range: TauRange; which: 'knee' | 'hip' | 'elbow' | 'shoulder'; label: string; last: boolean; onSeek: (t: number) => void }) {
  const data = useMemo(() => {
    const angleA = `${which}_${a.processed.shootingSide}` as const;
    const angleB = `${which}_${b.processed.shootingSide}` as const;
    // 兩側可能是不同投籃側：各取自己那一側
    const sa = overlaySeries(a, b, angleA, range);
    const sb = overlaySeries(a, b, angleB, range);
    return sa.map((p, i) => ({ tau: p.tau, a: p.a, b: sb[i]!.b }));
  }, [a, b, range, which]);

  const handleClick = (state: unknown) => {
    const s = state as { activeLabel?: number | string | null } | null;
    if (s?.activeLabel === undefined || s.activeLabel === null) return;
    onSeek(Number(s.activeLabel));
  };

  return (
    <>
      <ResponsiveContainer>
        <LineChart data={data} onClick={handleClick} margin={{ top: 6, right: MARGIN_R, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={chartColors.grid} vertical={false} />
          <ReferenceLine x={0} stroke={phaseColor('release')} strokeWidth={1.5} />
          <XAxis
            dataKey="tau"
            type="number"
            domain={[Math.round(range.minMs), Math.round(range.maxMs)]}
            tick={last ? { fill: chartColors.axis, fontSize: 10 } : false}
            tickFormatter={(v: number) => `${v >= 0 ? '+' : ''}${v}`}
            unit=" ms"
            stroke={chartColors.grid}
            height={last ? X_AXIS_H : 1}
          />
          <YAxis tick={{ fill: chartColors.axis, fontSize: 10 }} stroke={chartColors.grid} width={Y_AXIS_W} unit="°" domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.grid}`, fontSize: 11, padding: '2px 6px' }}
            labelFormatter={(v) => `τ = ${Number(v) >= 0 ? '+' : ''}${v} ms`}
          />
          {which === 'knee' && <Legend verticalAlign="top" height={LEGEND_H} wrapperStyle={{ fontSize: 11 }} />}
          <Line name={`A ${label}`} dataKey="a" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
          <Line name={`B ${label}`} dataKey="b" stroke={chartColors.series[1]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
      <div className="curve-label" style={{ top: which === 'knee' ? LEGEND_H + 4 : 2 }}>{label}</div>
    </>
  );
});

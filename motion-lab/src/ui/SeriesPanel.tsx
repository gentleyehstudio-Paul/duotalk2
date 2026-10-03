import { memo, useMemo, useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PRIMARY_JOINTS, type JointName } from '../pose/joints';
import { ANGLE_NAMES, type AngleName, type ProcessedTrack } from '../types/series';
import { chartColors } from './chartColors';
import { CursorOverlay } from './player/CursorOverlay';

type Axis = 'x' | 'y' | 'speed';

interface Props {
  processed: ProcessedTrack;
  frameIndex: number;
  onSeek: (index: number) => void;
}

const nn = (v: number) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100);
const Y_AXIS_W = 56;
const MARGIN_R = 16;
const CHART_H = 220;
/** x 軸 + 圖例所佔高度（游標覆蓋層的底部留白）。 */
const BOTTOM_PX = 56;

/** 由 Recharts 點擊事件取得幀索引（activeTooltipIndex；備援：由 activeLabel 的秒數找最近幀）。 */
export function indexFromChartClick(processed: ProcessedTrack, state: unknown): number | null {
  const s = state as { activeTooltipIndex?: number | string | null; activeLabel?: number | string | null } | null;
  const idx = s?.activeTooltipIndex;
  if (idx !== undefined && idx !== null && idx !== '' && Number.isFinite(Number(idx))) return Number(idx);
  if (s?.activeLabel === undefined || s.activeLabel === null) return null;
  const ms = Number(s.activeLabel) * 1000;
  let best = 0;
  processed.t_ms.forEach((t, i) => {
    if (Math.abs(t - ms) < Math.abs(processed.t_ms[best]! - ms)) best = i;
  });
  return best;
}

/**
 * 診斷面板：原始 vs 平滑的關節座標／速率曲線，與任選兩條角度曲線對照。
 * 點擊曲線跳到該幀；游標為 DOM 覆蓋層，圖表本身 memo 不隨播放重繪。
 */
export function SeriesPanel({ processed, frameIndex, onSeek }: Props) {
  const side = processed.shootingSide;
  const [joint, setJoint] = useState<JointName>(`${side}_wrist`);
  const [axis, setAxis] = useState<Axis>('y');
  const [angle, setAngle] = useState<AngleName>(`elbow_${side}`);
  const [compareAngle, setCompareAngle] = useState<AngleName | ''>(`knee_${side}`);
  const tMax = processed.t_ms[processed.t_ms.length - 1] || 1;
  const frac = (processed.t_ms[frameIndex] ?? 0) / tMax;

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label>
          關節{' '}
          <select value={joint} onChange={(e) => setJoint(e.target.value as JointName)}>
            {PRIMARY_JOINTS.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <label>
          量{' '}
          <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)}>
            <option value="x">X 座標</option>
            <option value="y">Y 座標</option>
            <option value="speed">速率</option>
          </select>
        </label>
        <span className="note">
          投籃側：{processed.shootingSide}（{processed.shootingSideSource}）· 面向：{processed.facing}
        </span>
      </div>
      <div className="chart-box" style={{ height: CHART_H }}>
        <JointChart processed={processed} joint={joint} axis={axis} onSeek={onSeek} />
        <CursorOverlay frac={frac} leftPx={Y_AXIS_W} rightPx={MARGIN_R} topPx={8} bottomPx={BOTTOM_PX} />
      </div>

      <div className="row" style={{ margin: '12px 0 8px' }}>
        <label>
          角度{' '}
          <select value={angle} onChange={(e) => setAngle(e.target.value as AngleName)}>
            {ANGLE_NAMES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          對照{' '}
          <select value={compareAngle} onChange={(e) => setCompareAngle(e.target.value as AngleName | '')}>
            <option value="">（無）</option>
            {ANGLE_NAMES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <span className="note">knee/hip/elbow = 屈曲量（0° 伸直，越大越彎）；shoulder = 抬臂角；trunk_lean 正值 = 向面向方向前傾。缺值處曲線中斷。</span>
      </div>
      <div className="chart-box" style={{ height: CHART_H }}>
        <AngleChart processed={processed} angle={angle} compareAngle={compareAngle} onSeek={onSeek} />
        <CursorOverlay frac={frac} leftPx={Y_AXIS_W} rightPx={MARGIN_R} topPx={8} bottomPx={BOTTOM_PX} />
      </div>
    </div>
  );
}

const tooltipStyle = { background: chartColors.tooltipBg, border: `1px solid ${chartColors.grid}`, fontSize: 12 };
const labelFmt = (v: unknown) => `t = ${Number(v).toFixed(3)} s`;

const JointChart = memo(function JointChart({ processed, joint, axis, onSeek }: { processed: ProcessedTrack; joint: JointName; axis: Axis; onSeek: (i: number) => void }) {
  const data = useMemo(() => {
    const j = processed.joints[joint];
    return processed.t_ms.map((t, i) => ({
      i,
      t: t / 1000,
      raw: axis === 'x' ? nn(j.rawX[i]!) : axis === 'y' ? nn(j.rawY[i]!) : null,
      smooth: axis === 'x' ? nn(j.x[i]!) : axis === 'y' ? nn(j.y[i]!) : nn(j.speed[i]!),
    }));
  }, [processed, joint, axis]);
  const axisLabel = axis === 'speed' ? '速率 (px/s)' : `${axis.toUpperCase()} (px)`;
  return (
    <ResponsiveContainer>
      <LineChart data={data} onClick={(s) => { const i = indexFromChartClick(processed, s); if (i !== null) onSeek(i); }} margin={{ top: 8, right: MARGIN_R, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit="s" stroke={chartColors.grid} />
        <YAxis tick={{ fill: chartColors.axis, fontSize: 11 }} stroke={chartColors.grid} width={Y_AXIS_W} label={{ value: axisLabel, angle: -90, position: 'insideLeft', fill: chartColors.axis, fontSize: 11 }} reversed={axis === 'y'} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {axis !== 'speed' && <Line name="原始" dataKey="raw" stroke={chartColors.raw} dot={{ r: 1.5, fill: chartColors.raw, strokeWidth: 0 }} strokeWidth={1} connectNulls={false} isAnimationActive={false} />}
        <Line name="平滑 (One Euro)" dataKey="smooth" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});

const AngleChart = memo(function AngleChart({ processed, angle, compareAngle, onSeek }: { processed: ProcessedTrack; angle: AngleName; compareAngle: AngleName | ''; onSeek: (i: number) => void }) {
  const data = useMemo(
    () =>
      processed.t_ms.map((t, i) => ({
        i,
        t: t / 1000,
        a: nn(processed.angles[angle].deg[i]!),
        b: compareAngle ? nn(processed.angles[compareAngle].deg[i]!) : null,
      })),
    [processed, angle, compareAngle],
  );
  return (
    <ResponsiveContainer>
      <LineChart data={data} onClick={(s) => { const i = indexFromChartClick(processed, s); if (i !== null) onSeek(i); }} margin={{ top: 8, right: MARGIN_R, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit="s" stroke={chartColors.grid} />
        <YAxis tick={{ fill: chartColors.axis, fontSize: 11 }} stroke={chartColors.grid} width={Y_AXIS_W} unit="°" />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={labelFmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line name={angle} dataKey="a" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
        {compareAngle && <Line name={compareAngle} dataKey="b" stroke={chartColors.series[1]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />}
      </LineChart>
    </ResponsiveContainer>
  );
});

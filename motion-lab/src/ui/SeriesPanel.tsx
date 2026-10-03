import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PRIMARY_JOINTS, type JointName } from '../pose/joints';
import { ANGLE_NAMES, type AngleName, type ProcessedTrack } from '../types/series';
import { chartColors } from './chartColors';

type Axis = 'x' | 'y' | 'speed';

interface Props {
  processed: ProcessedTrack;
  frameIndex: number;
  onSeek: (index: number) => void;
}

const nn = (v: number) => (Number.isNaN(v) ? null : Math.round(v * 100) / 100);

/**
 * 步驟 2 驗證面板：原始 vs 平滑的關節座標／速率曲線，與關節角度曲線。
 * 點擊曲線任一點會跳到該幀（規則 2 的「曲線與影片時間軸連動」在此先行建立）。
 */
export function SeriesPanel({ processed, frameIndex, onSeek }: Props) {
  const side = processed.shootingSide;
  const [joint, setJoint] = useState<JointName>(`${side}_wrist`);
  const [axis, setAxis] = useState<Axis>('y');
  const [angle, setAngle] = useState<AngleName>(`elbow_${side}`);
  const [compareAngle, setCompareAngle] = useState<AngleName | ''>(`knee_${side}`);

  const jointData = useMemo(() => {
    const j = processed.joints[joint];
    return processed.t_ms.map((t, i) => ({
      i,
      t: t / 1000,
      raw: axis === 'x' ? nn(j.rawX[i]!) : axis === 'y' ? nn(j.rawY[i]!) : null,
      smooth: axis === 'x' ? nn(j.x[i]!) : axis === 'y' ? nn(j.y[i]!) : nn(j.speed[i]!),
    }));
  }, [processed, joint, axis]);

  const angleData = useMemo(
    () =>
      processed.t_ms.map((t, i) => ({
        i,
        t: t / 1000,
        a: nn(processed.angles[angle].deg[i]!),
        b: compareAngle ? nn(processed.angles[compareAngle].deg[i]!) : null,
      })),
    [processed, angle, compareAngle],
  );

  const tNow = (processed.t_ms[frameIndex] ?? 0) / 1000;
  const handleClick = (state: unknown) => {
    const s = state as { activeTooltipIndex?: number | string | null; activeLabel?: number | string | null } | null;
    const idx = s?.activeTooltipIndex;
    if (idx !== undefined && idx !== null && idx !== '' && Number.isFinite(Number(idx))) {
      onSeek(Number(idx));
      return;
    }
    // 備援：以點擊處的時間值找最近的幀。
    const label = s?.activeLabel;
    if (label === undefined || label === null) return;
    const tClick = Number(label) * 1000;
    let best = 0;
    let bestD = Infinity;
    processed.t_ms.forEach((t, i) => {
      const d = Math.abs(t - tClick);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    onSeek(best);
  };

  const axisLabel = axis === 'speed' ? '速率 (px/s)' : `${axis.toUpperCase()} (px)`;

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
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={jointData} onClick={handleClick} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit="s" stroke={chartColors.grid} />
            <YAxis tick={{ fill: chartColors.axis, fontSize: 11 }} stroke={chartColors.grid} width={56} label={{ value: axisLabel, angle: -90, position: 'insideLeft', fill: chartColors.axis, fontSize: 11 }} reversed={axis === 'y'} />
            <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.grid}`, fontSize: 12 }} labelFormatter={(v) => `t = ${Number(v).toFixed(3)} s`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {axis !== 'speed' && <Line name="原始" dataKey="raw" stroke={chartColors.raw} dot={{ r: 1.5, fill: chartColors.raw, strokeWidth: 0 }} strokeWidth={1} connectNulls={false} isAnimationActive={false} />}
            <Line name="平滑 (One Euro)" dataKey="smooth" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            <ReferenceLine x={tNow} stroke={chartColors.cursor} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
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
        <span className="note">關節角為內角（180° = 伸直）；trunk_lean 正值 = 向面向方向前傾。缺值處曲線中斷。</span>
      </div>
      <div style={{ width: '100%', height: 220 }}>
        <ResponsiveContainer>
          <LineChart data={angleData} onClick={handleClick} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={chartColors.grid} vertical={false} />
            <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tick={{ fill: chartColors.axis, fontSize: 11 }} tickFormatter={(v: number) => v.toFixed(1)} unit="s" stroke={chartColors.grid} />
            <YAxis tick={{ fill: chartColors.axis, fontSize: 11 }} stroke={chartColors.grid} width={56} unit="°" />
            <Tooltip contentStyle={{ background: chartColors.tooltipBg, border: `1px solid ${chartColors.grid}`, fontSize: 12 }} labelFormatter={(v) => `t = ${Number(v).toFixed(3)} s`} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line name={angle} dataKey="a" stroke={chartColors.series[0]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />
            {compareAngle && <Line name={compareAngle} dataKey="b" stroke={chartColors.series[1]} dot={false} strokeWidth={2} connectNulls={false} isAnimationActive={false} />}
            <ReferenceLine x={tNow} stroke={chartColors.cursor} strokeDasharray="4 4" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

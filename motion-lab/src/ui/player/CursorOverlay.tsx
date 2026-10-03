/**
 * 疊在 Recharts 圖上方的時間游標。用 DOM 覆蓋層而不是 ReferenceLine，
 * 這樣播放時只有這條線重繪，圖表本身（memo）不必每幀重新渲染。
 * leftPx / rightPx 必須與圖表的 YAxis 寬度與 margin 一致。
 */
export function CursorOverlay({ frac, leftPx, rightPx, topPx = 0, bottomPx = 0 }: { frac: number; leftPx: number; rightPx: number; topPx?: number; bottomPx?: number }) {
  const f = Math.min(1, Math.max(0, frac));
  return (
    <div
      className="cursor-overlay"
      style={{
        left: `calc(${leftPx}px + (100% - ${leftPx + rightPx}px) * ${f})`,
        top: topPx,
        bottom: bottomPx,
      }}
    />
  );
}

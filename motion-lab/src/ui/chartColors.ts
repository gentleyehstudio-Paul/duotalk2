/**
 * 圖表序列色（深色面板 #14141b 上以 dataviz 驗證腳本檢查過 CVD 可辨與對比）。
 * 固定順序指派，不循環：series1 = 主要（投籃側 / 平滑），series2 = 對照側，series3、series4 備用。
 * 原始資料用中性灰，不佔用類別色。
 */
export const chartColors = {
  series: ['#b8862a', '#8b5cf6', '#1fa897', '#d94f4f'] as const,
  raw: '#6b6b78',
  grid: '#262633',
  axis: '#9a98a3',
  cursor: '#e8e6e3',
  tooltipBg: '#1d1d27',
};

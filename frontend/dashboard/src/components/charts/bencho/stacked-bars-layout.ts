export function getColumnCount(length: number, requested: number) {
  return Math.min(length, Number.isFinite(requested) ? Math.max(0, Math.round(requested)) : 0);
}

export function getPlotGeometry(measuredWidth: number, count: number, requestedGap: number) {
  const width = Number.isFinite(measuredWidth) ? Math.max(0, measuredWidth) : 0;
  const maxGap = count > 1 ? Math.max(0, (width - 3 * count) / (count - 1)) : 0;
  const gap = Math.min(maxGap, Number.isFinite(requestedGap) ? Math.max(0, requestedGap) : 0);
  const barWidth = count > 0 ? Math.max(0, (width - gap * (count - 1)) / count) : 0;
  const columns = Array.from({ length: count }, (_, index) => ({ left: index * (barWidth + gap), width: barWidth }));
  return { width, gap, barWidth, columns };
}

type PlotGeometry = ReturnType<typeof getPlotGeometry>;

export function pickColumn(geometry: PlotGeometry, x: number): number | null {
  if (!Number.isFinite(x) || geometry.width <= 0 || x < 0 || x > geometry.width) return null;
  // Match the painted intervals; gaps do not belong to either adjacent column.
  const index = geometry.columns.findIndex((column, i) => x >= column.left && (
    x < column.left + column.width || (i === geometry.columns.length - 1 && x === geometry.width)
  ));
  return index >= 0 ? index : null;
}

export function getHoverGeometry(geometry: PlotGeometry, index: number, requestedTipWidth: number) {
  const column = geometry.columns[index];
  if (!column || geometry.width <= 0) return null;
  const ringLeft = Math.max(0, column.left - 3);
  const ringRight = Math.min(geometry.width, column.left + column.width + 3);
  const tipWidth = Math.min(geometry.width, requestedTipWidth);
  const right = column.left + column.width + 8;
  const left = column.left - 8 - tipWidth;
  const preferred = right + tipWidth <= geometry.width ? right : left >= 0 ? left : right;
  const tipLeft = Math.max(0, Math.min(geometry.width - tipWidth, preferred));
  return { ringLeft, ringWidth: ringRight - ringLeft, tipLeft, tipWidth };
}

export function getStackLayout(values: readonly (readonly number[])[], height: number, gap: number) {
  const totals = values.map((vals) => vals.reduce((sum, value) => sum + Math.max(0, value), 0));
  const maxTotal = Math.max(1, ...totals);
  const maxSegments = Math.max(0, ...values.map((vals) => vals.filter((value) => value > 0).length));
  const scale = Math.max(0, height - gap * Math.max(0, maxSegments - 1)) / maxTotal;
  const layout = values.map((vals) => {
    const heights = vals.map((value) => value > 0 ? Math.max(2, value * scale) : 0);
    const count = heights.filter((h) => h > 0).length;
    const available = Math.max(0, height - gap * Math.max(0, count - 1));
    const sum = heights.reduce((total, h) => total + h, 0);
    const shrink = sum > 0 ? Math.min(1, available / sum) : 1;
    let y = 0;
    let segments = 0;
    const segs = heights.map((height) => {
      const h = height * shrink;
      if (h > 0 && segments++ > 0) y += gap;
      const segment = { bottom: y, h };
      y += h;
      return segment;
    });
    return { segs, top: y };
  });
  return { totals, layout };
}

export function observePlotWidth(plot: Element, onWidth: (width: number) => void) {
  let active = true;
  const measure = () => {
    if (!active) return;
    const width = plot.getBoundingClientRect().width;
    onWidth(Number.isFinite(width) ? Math.max(0, width) : 0);
  };
  // Read at attachment, before the first observer delivery (including async data mounts).
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(plot);
  return () => { active = false; observer.disconnect(); };
}

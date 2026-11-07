/**
 * The chart renderer.
 *
 * One element type, many chart variants. The model supplies categories, values
 * and points; this module owns axes, scales, marks and labels. That is the whole
 * point: a model that can name the data cannot accidentally mis-place a bar, and
 * a stored deck does not contain pixel coordinates that go stale.
 */
import type { ChartElement, ChartSeries, FigureShape } from '../figure';
import {
  arrow,
  circle,
  clamp,
  extent,
  formatNumber,
  innerFrame,
  line,
  paletteColor,
  path,
  polylinePath,
  rect,
  round,
  scale,
  text,
  ticks,
  type Frame,
  type RenderContext,
} from './shared';

const AXIS = 'var(--ink-3)';
const GRID = 'var(--rule)';

function frameOf(element: ChartElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

function allValues(element: ChartElement): number[] {
  const values: number[] = [];
  for (const series of element.series ?? []) {
    if (series.values) values.push(...series.values);
    if (series.summary) values.push(...series.summary);
    for (const point of series.points ?? []) values.push(point.y);
  }
  return values;
}

function domainFor(element: ChartElement, includeZero = false): [number, number] {
  if (element.min !== undefined && element.max !== undefined && element.min < element.max) {
    return [element.min, element.max];
  }
  let values = allValues(element);
  if (includeZero) values = [...values, 0];
  if (element.min !== undefined) values.push(element.min);
  if (element.max !== undefined) values.push(element.max);
  let [min, max] = extent(values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  if (includeZero) {
    min = Math.min(0, min);
    max = Math.max(0, max);
  }
  return [min, max];
}

interface XAxis {
  kind: 'category';
  labels: string[];
  /** Centre of each band, in data units 0..n. */
}

interface LinearXAxis {
  kind: 'linear';
  min: number;
  max: number;
}

function drawAxes(
  shapes: FigureShape[],
  area: Frame,
  yMin: number,
  yMax: number,
  x: XAxis | LinearXAxis,
  xLabel?: string,
  yLabel?: string,
): void {
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  const yTicks = ticks(yMin, yMax, 5);
  for (const tick of yTicks) {
    const y = yMap(tick);
    shapes.push(line(area.left, y, area.left + area.width, y, GRID, 1));
    shapes.push(line(area.left - 4, y, area.left, y, AXIS, 1));
    shapes.push(text(area.left - 7, y + 3, formatNumber(tick), { size: 9, anchor: 'end', color: AXIS }));
  }
  shapes.push(line(area.left, area.top, area.left, area.top + area.height, AXIS, 1.2));
  shapes.push(line(area.left, area.top + area.height, area.left + area.width, area.top + area.height, AXIS, 1.2));

  if (x.kind === 'category') {
    const band = area.width / Math.max(1, x.labels.length);
    x.labels.forEach((label, index) => {
      const centre = area.left + band * (index + 0.5);
      shapes.push(text(centre, area.top + area.height + 14, label.slice(0, 14), { size: 9, color: AXIS }));
    });
  } else {
    const xTicks = ticks(x.min, x.max, 5);
    const xMap = scale(x.min, x.max, area.left, area.left + area.width);
    for (const tick of xTicks) {
      const px = xMap(tick);
      shapes.push(line(px, area.top + area.height, px, area.top + area.height + 4, AXIS, 1));
      shapes.push(text(px, area.top + area.height + 14, formatNumber(tick), { size: 9, color: AXIS }));
    }
  }
  if (xLabel) {
    shapes.push(text(area.left + area.width / 2, area.top + area.height + 28, xLabel, { size: 9, color: AXIS }));
  }
  if (yLabel) {
    shapes.push(text(area.left - 6, area.top - 7, yLabel, { size: 9, anchor: 'end', color: AXIS }));
  }
}

function categoryLabels(element: ChartElement): string[] {
  if (element.categories && element.categories.length > 0) return element.categories;
  const count = Math.max(
    0,
    ...(element.series ?? []).map((series) => series.values?.length ?? series.points?.length ?? 0),
  );
  return Array.from({ length: count }, (_, index) => String(index + 1));
}

function seriesPoints(series: ChartSeries): Array<{ x: number; y: number; r?: number; label?: string }> {
  if (series.points && series.points.length > 0) return series.points;
  return (series.values ?? []).map((y, index) => ({ x: index, y }));
}

function computeSummary(series: ChartSeries): [number, number, number, number, number] {
  if (series.summary) return series.summary;
  const values = [...(series.values ?? []), ...(series.points ?? []).map((point) => point.y)].sort(
    (a, b) => a - b,
  );
  if (values.length === 0) return [0, 0, 0, 0, 0];
  const at = (fraction: number): number => {
    const index = clamp(Math.round((values.length - 1) * fraction), 0, values.length - 1);
    return values[index] ?? 0;
  };
  return [values[0] ?? 0, at(0.25), at(0.5), at(0.75), values[values.length - 1] ?? 0];
}

function drawCategoryBand(
  area: Frame,
  labels: string[],
): { band: number; centre: (index: number) => number } {
  const band = area.width / Math.max(1, labels.length);
  return { band, centre: (index) => area.left + band * (index + 0.5) };
}

function bars(
  element: ChartElement,
  area: Frame,
  ctx: RenderContext,
  shapes: FigureShape[],
  stacked = false,
): void {
  const labels = categoryLabels(element);
  const [yMin, yMax] = domainFor(element, true);
  drawAxes(shapes, area, yMin, yMax, { kind: 'category', labels }, element.xLabel, element.yLabel);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  const zero = yMap(clamp(0, yMin, yMax));
  const series = element.series ?? [];
  const { band } = drawCategoryBand(area, labels);
  const barWidth = stacked ? band * 0.58 : (band * 0.72) / Math.max(1, series.length);
  series.forEach((item, seriesIndex) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, seriesIndex);
    const values = item.values ?? [];
    if (stacked) {
      values.forEach((value, index) => {
        const previous = series
          .slice(0, seriesIndex)
          .reduce((sum, earlier) => sum + (earlier.values?.[index] ?? 0), 0);
        const x = area.left + band * index + band * 0.21;
        const y1 = yMap(previous);
        const y2 = yMap(previous + value);
        shapes.push(rect(x, Math.min(y1, y2), barWidth, Math.abs(y2 - y1), color, color, 0.3));
      });
      return;
    }
    values.forEach((value, index) => {
      const x = area.left + band * index + band * 0.14 + barWidth * seriesIndex;
      const y = yMap(value);
      shapes.push(rect(x, Math.min(y, zero), barWidth, Math.abs(zero - y), color, color, 0.3));
      if (value !== 0) {
        shapes.push(
          text(x + barWidth / 2, Math.min(y, zero) - 3, formatNumber(value), {
            size: 8,
            color: AXIS,
          }),
        );
      }
    });
  });
}

function xyPlot(
  element: ChartElement,
  area: Frame,
  ctx: RenderContext,
  shapes: FigureShape[],
  mode: 'line' | 'scatter' | 'phase' | 'area' | 'bubble' | 'dual',
): void {
  const series = element.series ?? [];
  const points = series.flatMap((item) => seriesPoints(item));
  const [xMin, xMax] = extent(points.map((point) => point.x));
  const [yMin, yMax] = domainFor(element, mode === 'area');
  drawAxes(
    shapes,
    area,
    yMin,
    yMax,
    { kind: 'linear', min: xMin, max: xMax },
    element.xLabel,
    element.yLabel,
  );
  const xMap = scale(xMin, xMax, area.left, area.left + area.width);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  series.forEach((item, seriesIndex) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, seriesIndex);
    const data = seriesPoints(item).map((point) => ({ ...point, px: xMap(point.x), py: yMap(point.y) }));
    if (mode === 'line' || mode === 'area' || mode === 'phase' || mode === 'dual') {
      if (data.length >= 2) {
        if (mode === 'area') {
          const base = yMap(clamp(0, yMin, yMax));
          const polygon = [
            [data[0]!.px, base] as [number, number],
            ...data.map((point) => [point.px, point.py] as [number, number]),
            [data[data.length - 1]!.px, base] as [number, number],
          ];
          shapes.push(path(polylinePath(polygon, true), color, 1, color, 0.18));
        }
        shapes.push(path(polylinePath(data.map((point) => [point.px, point.py] as [number, number])), color, 2));
      }
      if (mode !== 'dual') {
        for (const point of data) shapes.push(circle(point.px, point.py, 2.4, color, color, 1));
      }
    }
    if (mode === 'scatter' || mode === 'phase' || mode === 'bubble' || mode === 'dual') {
      for (const point of data) {
        const radius = mode === 'bubble' ? clamp(Math.sqrt(Math.abs(point.r ?? 1)) * 3, 3, 18) : 3;
        shapes.push(circle(point.px, point.py, radius, color, color, mode === 'bubble' ? 0.45 : 1));
      }
    }
  });
}

function errorBars(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const series = element.series ?? [];
  const labels = categoryLabels(element);
  const [yMin, yMax] = domainFor(element, false);
  drawAxes(shapes, area, yMin, yMax, { kind: 'category', labels }, element.xLabel, element.yLabel);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  const band = area.width / Math.max(1, labels.length);
  series.forEach((item, index) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, index);
    (item.values ?? []).forEach((value, position) => {
      const x = area.left + band * (position + 0.5);
      const y = yMap(value);
      shapes.push(circle(x, y, 2.6, color, color, 1));
      const error = item.errors?.[position];
      if (error) {
        const low = yMap(error[0]);
        const high = yMap(error[1]);
        shapes.push(line(x, low, x, high, color, 1.4));
        shapes.push(line(x - 4, low, x + 4, low, color, 1.2));
        shapes.push(line(x - 4, high, x + 4, high, color, 1.2));
      }
    });
  });
}

function boxPlots(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[], violin: boolean): void {
  const series = element.series ?? [];
  const labels = series.map((item, index) => item.name ?? categoryLabels(element)[index] ?? String(index + 1));
  const [yMin, yMax] = domainFor(element, false);
  drawAxes(shapes, area, yMin, yMax, { kind: 'category', labels }, element.xLabel, element.yLabel);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  const band = area.width / Math.max(1, series.length);
  series.forEach((item, index) => {
    const [min, q1, median, q3, max] = computeSummary(item);
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, index);
    const centre = area.left + band * (index + 0.5);
    if (violin) {
      const width = band * 0.32;
      const body = [
        [centre, yMap(max)] as [number, number],
        [centre + width, yMap((max + q3) / 2)] as [number, number],
        [centre + width * 0.7, yMap(median)] as [number, number],
        [centre + width, yMap((q1 + min) / 2)] as [number, number],
        [centre, yMap(min)] as [number, number],
        [centre - width, yMap((q1 + min) / 2)] as [number, number],
        [centre - width * 0.7, yMap(median)] as [number, number],
        [centre - width, yMap((max + q3) / 2)] as [number, number],
      ];
      shapes.push(path(polylinePath(body, true), color, 1.4, color, 0.2));
    } else {
      const width = band * 0.34;
      shapes.push(rect(centre - width / 2, yMap(q3), width, yMap(q1) - yMap(q3), color, color, 0.18));
      shapes.push(line(centre, yMap(max), centre, yMap(q3), color, 1.2));
      shapes.push(line(centre, yMap(q1), centre, yMap(min), color, 1.2));
      shapes.push(line(centre - width / 2, yMap(max), centre + width / 2, yMap(max), color, 1.2));
      shapes.push(line(centre - width / 2, yMap(min), centre + width / 2, yMap(min), color, 1.2));
      shapes.push(line(centre - width / 2, yMap(median), centre + width / 2, yMap(median), color, 2));
    }
  });
}

function radar(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element).slice(0, 12);
  if (labels.length < 3) return;
  const area = innerFrame(frame, { left: 40, top: 26, width: 40, height: 42 });
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const radius = Math.max(24, Math.min(area.width, area.height) / 2 - 12);
  const [min, max] = domainFor(element, false);
  const maxAbs = Math.max(Math.abs(min), Math.abs(max), 1);
  for (let ring = 1; ring <= 4; ring += 1) {
    const r = (radius * ring) / 4;
    const points = labels.map((_, index) => {
      const angle = -Math.PI / 2 + (index / labels.length) * Math.PI * 2;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number];
    });
    shapes.push(path(polylinePath(points, true), GRID, 1));
  }
  labels.forEach((label, index) => {
    const angle = -Math.PI / 2 + (index / labels.length) * Math.PI * 2;
    const x = cx + Math.cos(angle) * (radius + 10);
    const y = cy + Math.sin(angle) * (radius + 10);
    shapes.push(text(x, y + 3, label.slice(0, 10), { size: 8, color: AXIS }));
  });
  (element.series ?? []).forEach((item, seriesIndex) => {
    const values = item.values ?? [];
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, seriesIndex);
    const points = labels.map((_, index) => {
      const angle = -Math.PI / 2 + (index / labels.length) * Math.PI * 2;
      const ratio = clamp(Math.abs(values[index] ?? 0) / maxAbs, 0, 1);
      return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio] as [number, number];
    });
    shapes.push(path(polylinePath(points, true), color, 1.8, color, 0.16));
  });
}

function gauge(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const area = innerFrame(frame, { left: 20, top: 10, width: 20, height: 20 });
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height * 0.9;
  const radius = Math.max(24, Math.min(area.width, area.height * 1.8) / 2);
  const value = element.series?.[0]?.values?.[0] ?? 0;
  const [min, max] = domainFor(element, false);
  const ratio = clamp((value - min) / (max - min || 1), 0, 1);
  const start = Math.PI;
  const end = 0;
  const arc = (from: number, to: number): string => {
    const x1 = cx + Math.cos(Math.PI - from) * radius;
    const y1 = cy - Math.sin(Math.PI - from) * radius;
    const x2 = cx + Math.cos(Math.PI - to) * radius;
    const y2 = cy - Math.sin(Math.PI - to) * radius;
    return `M ${round(x1)} ${round(y1)} A ${round(radius)} ${round(radius)} 0 0 1 ${round(x2)} ${round(y2)}`;
  };
  shapes.push(path(arc(start, end), GRID, 10));
  shapes.push(path(arc(start, start + (end - start) * ratio), paletteColor(ctx, 0), 10));
  const angle = Math.PI - Math.PI * ratio;
  shapes.push(line(cx, cy, cx + Math.cos(angle) * radius * 0.86, cy - Math.sin(angle) * radius * 0.86, 'var(--ink)', 2));
  shapes.push(circle(cx, cy, 3, 'var(--ink)', 'var(--ink)', 1));
  shapes.push(text(cx, cy - 8, formatNumber(value), { size: 14, color: 'var(--ink)', weight: 600 }));
  shapes.push(text(cx, cy + 14, `${formatNumber(min)}–${formatNumber(max)}`, { size: 9, color: AXIS }));
}

function funnel(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element);
  const values = element.series?.[0]?.values ?? [];
  if (values.length === 0) return;
  const max = Math.max(...values, 1);
  const rowHeight = area.height / values.length;
  values.forEach((value, index) => {
    const width = (value / max) * area.width;
    const x = area.left + (area.width - width) / 2;
    const y = area.top + rowHeight * index;
    const nextValue = values[index + 1] ?? value * 0.7;
    const nextWidth = (nextValue / max) * area.width;
    const nextX = area.left + (area.width - nextWidth) / 2;
    const color = paletteColor(ctx, index);
    shapes.push(
      path(
        `M ${round(x)} ${round(y)} L ${round(x + width)} ${round(y)} L ${round(nextX + nextWidth)} ${round(y + rowHeight)} L ${round(nextX)} ${round(y + rowHeight)} Z`,
        color,
        1,
        color,
        0.24,
      ),
    );
    shapes.push(text(area.left + area.width / 2, y + rowHeight / 2 + 4, `${labels[index] ?? ''} ${formatNumber(value)}`, { size: 9 }));
  });
}

function heatmap(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element);
  const series = element.series ?? [];
  if (series.length === 0 || labels.length === 0) return;
  const area = innerFrame(frame, { left: 46, top: 12, width: 14, height: 34 });
  const values = series.flatMap((item) => item.values ?? []);
  const [min, max] = extent(values);
  const cellWidth = area.width / labels.length;
  const cellHeight = area.height / series.length;
  series.forEach((item, row) => {
    labels.forEach((_label, column) => {
      const value = item.values?.[column] ?? min;
      const ratio = (value - min) / (max - min || 1);
      const color = ctx.color('accent');
      shapes.push(rect(area.left + column * cellWidth, area.top + row * cellHeight, cellWidth, cellHeight, 'var(--rule)', color, 0.1 + ratio * 0.75));
      shapes.push(text(area.left + column * cellWidth + cellWidth / 2, area.top + row * cellHeight + cellHeight / 2 + 3, formatNumber(value), { size: 8 }));
    });
  });
  labels.forEach((label, index) => {
    shapes.push(text(area.left + cellWidth * (index + 0.5), area.top + area.height + 12, label.slice(0, 10), { size: 8, color: AXIS }));
  });
  series.forEach((item, index) => {
    shapes.push(text(area.left - 6, area.top + cellHeight * (index + 0.5) + 3, (item.name ?? String(index + 1)).slice(0, 10), { size: 8, anchor: 'end', color: AXIS }));
  });
}

function polar(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const area = innerFrame(frame, { left: 30, top: 18, width: 30, height: 30 });
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const radius = Math.max(20, Math.min(area.width, area.height) / 2 - 6);
  for (let ring = 1; ring <= 4; ring += 1) {
    shapes.push(circle(cx, cy, (radius * ring) / 4, GRID));
  }
  for (let spoke = 0; spoke < 8; spoke += 1) {
    const angle = (spoke / 8) * Math.PI * 2;
    shapes.push(line(cx, cy, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, GRID, 1));
  }
  const series = element.series ?? [];
  const maxRadius = Math.max(1, ...series.flatMap((item) => (item.points ?? []).map((point) => point.y)));
  series.forEach((item, seriesIndex) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, seriesIndex);
    const points = (item.points ?? []).map((point) => {
      const angle = (point.x * Math.PI) / 180;
      const r = (point.y / maxRadius) * radius;
      return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as [number, number];
    });
    if (points.length >= 2) shapes.push(path(polylinePath(points), color, 1.8));
    for (const [x, y] of points) shapes.push(circle(x, y, 2.4, color, color, 1));
  });
}

function vectorField(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const series = element.series ?? [];
  const vectors = series.flatMap((item) => item.vectors ?? []);
  if (vectors.length === 0) return;
  const xs = vectors.flatMap((vector) => [vector.x, vector.x + vector.dx]);
  const ys = vectors.flatMap((vector) => [vector.y, vector.y + vector.dy]);
  const [xMin, xMax] = extent(xs);
  const [yMin, yMax] = extent(ys);
  drawAxes(shapes, area, yMin, yMax, { kind: 'linear', min: xMin, max: xMax }, element.xLabel, element.yLabel);
  const xMap = scale(xMin, xMax, area.left, area.left + area.width);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  series.forEach((item, index) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, index);
    for (const vector of item.vectors ?? []) {
      shapes.push(...arrow(xMap(vector.x), yMap(vector.y), xMap(vector.x + vector.dx), yMap(vector.y + vector.dy), color, 1.4));
    }
  });
}

function waterfall(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element);
  const values = element.series?.[0]?.values ?? [];
  if (values.length === 0) return;
  let running = 0;
  const cumulative: Array<[number, number]> = values.map((value) => {
    const start = running;
    running += value;
    return [start, running];
  });
  const all = cumulative.flat();
  const [yMin, yMax] = extent([...all, 0]);
  drawAxes(shapes, area, yMin, yMax, { kind: 'category', labels }, element.xLabel, element.yLabel);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  const band = area.width / Math.max(1, values.length);
  values.forEach((value, index) => {
    const [start, end] = cumulative[index]!;
    const color = value >= 0 ? ctx.color('ok') : ctx.color('bad');
    const x = area.left + band * index + band * 0.2;
    const y1 = yMap(start);
    const y2 = yMap(end);
    shapes.push(rect(x, Math.min(y1, y2), band * 0.6, Math.abs(y2 - y1), color, color, 0.3));
    shapes.push(text(x + band * 0.3, Math.min(y1, y2) - 3, formatNumber(value), { size: 8, color: AXIS }));
  });
}

function population(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element);
  const series = element.series ?? [];
  if (series.length < 2) return;
  const max = Math.max(...series.flatMap((item) => item.values ?? []), 1);
  const rowHeight = area.height / Math.max(1, labels.length);
  const half = area.width / 2;
  labels.forEach((label, index) => {
    const y = area.top + rowHeight * index + rowHeight / 2;
    const leftValue = series[0]?.values?.[index] ?? 0;
    const rightValue = series[1]?.values?.[index] ?? 0;
    const lx = area.left + half - (leftValue / max) * (half - 8);
    const rx = area.left + half + 4;
    shapes.push(rect(lx, y - rowHeight * 0.32, (leftValue / max) * (half - 8), rowHeight * 0.64, ctx.color(series[0]?.color), ctx.color(series[0]?.color), 0.3));
    shapes.push(rect(rx, y - rowHeight * 0.32, (rightValue / max) * (half - 8), rowHeight * 0.64, ctx.color(series[1]?.color), ctx.color(series[1]?.color), 0.3));
    shapes.push(text(area.left + half, y + 3, label.slice(0, 12), { size: 8, color: AXIS }));
  });
  shapes.push(text(area.left + half / 2, area.top - 4, series[0]?.name ?? '', { size: 9, color: AXIS }));
  shapes.push(text(area.left + half + half / 2, area.top - 4, series[1]?.name ?? '', { size: 9, color: AXIS }));
}

function wordCloud(frame: Frame, ctx: RenderContext, element: ChartElement, shapes: FigureShape[]): void {
  const words = element.words ?? [];
  const max = Math.max(...words.map((word) => word.weight), 1);
  const minSize = 9;
  const maxSize = 26;
  const area = innerFrame(frame, { left: 8, top: 8, width: 8, height: 8 });
  let x = area.left;
  let y = area.top + maxSize;
  for (const word of words) {
    const size = minSize + (word.weight / max) * (maxSize - minSize);
    const width = word.text.length * size * 0.62;
    if (x + width > area.left + area.width) {
      x = area.left;
      y += maxSize + 6;
    }
    if (y > area.top + area.height) break;
    shapes.push(text(x + width / 2, y, word.text, { size, color: paletteColor(ctx, Math.round(word.weight)) }));
    x += width + 10;
  }
}

function treemap(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const labels = categoryLabels(element);
  const values = element.series?.[0]?.values ?? [];
  if (values.length === 0) return;
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  // A simple slice-and-dice layout: deterministic and legible for a dozen cells.
  let x = area.left;
  let y = area.top;
  let width = area.width;
  let height = area.height;
  let remaining = total;
  values.forEach((value, index) => {
    const share = Math.max(0, value) / remaining;
    const horizontal = width >= height;
    if (horizontal) {
      const cellWidth = width * share;
      shapes.push(rect(x, y, cellWidth, height, ctx.color('accent'), paletteColor(ctx, index), 0.28));
      shapes.push(text(x + cellWidth / 2, y + height / 2 + 3, `${labels[index] ?? ''} ${formatNumber(value)}`, { size: 9 }));
      x += cellWidth;
      width -= cellWidth;
    } else {
      const cellHeight = height * share;
      shapes.push(rect(x, y, width, cellHeight, ctx.color('accent'), paletteColor(ctx, index), 0.28));
      shapes.push(text(x + width / 2, y + cellHeight / 2 + 3, `${labels[index] ?? ''} ${formatNumber(value)}`, { size: 9 }));
      y += cellHeight;
      height -= cellHeight;
    }
    remaining -= Math.max(0, value);
  });
  shapes.push(rect(area.left, area.top, area.width, area.height, 'var(--rule)', undefined, undefined));
}

function sunburst(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const area = innerFrame(frame, { left: 20, top: 14, width: 20, height: 20 });
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const radius = Math.max(20, Math.min(area.width, area.height) / 2 - 4);
  const series = element.series ?? [];
  const rings = Math.max(1, series.length);
  const values = series.map((item) => item.values?.reduce((sum, value) => sum + Math.max(0, value), 0) ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0) || 1;
  let angle = -Math.PI / 2;
  values.forEach((value, index) => {
    const sweep = (value / total) * Math.PI * 2;
    const inner = (radius * index) / rings;
    const outer = (radius * (index + 1)) / rings;
    const start = angle;
    const end = angle + sweep;
    const color = paletteColor(ctx, index);
    const x1 = cx + Math.cos(start) * outer;
    const y1 = cy + Math.sin(start) * outer;
    const x2 = cx + Math.cos(end) * outer;
    const y2 = cy + Math.sin(end) * outer;
    const x3 = cx + Math.cos(end) * inner;
    const y3 = cy + Math.sin(end) * inner;
    const x4 = cx + Math.cos(start) * inner;
    const y4 = cy + Math.sin(start) * inner;
    const large = sweep > Math.PI ? 1 : 0;
    shapes.push(path(`M ${round(x1)} ${round(y1)} A ${round(outer)} ${round(outer)} 0 ${large} 1 ${round(x2)} ${round(y2)} L ${round(x3)} ${round(y3)} A ${round(inner)} ${round(inner)} 0 ${large} 0 ${round(x4)} ${round(y4)} Z`, color, 1, color, 0.24));
    angle = end;
  });
  shapes.push(text(cx, cy + 3, element.categories?.[0] ?? '', { size: 9 }));
}

function sankey(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const nodes = element.nodes ?? [];
  const links = element.links ?? [];
  if (nodes.length === 0 || links.length === 0) return;
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const link of links) {
    outgoing.set(link.from, [...(outgoing.get(link.from) ?? []), link.to]);
    incoming.set(link.to, [...(incoming.get(link.to) ?? []), link.from]);
  }
  const layer = new Map<string, number>();
  const visit = (id: string, depth: number, stack: Set<string>): void => {
    if (stack.has(id)) return;
    layer.set(id, Math.max(layer.get(id) ?? 0, depth));
    for (const next of outgoing.get(id) ?? []) visit(next, depth + 1, new Set([...stack, id]));
  };
  for (const node of nodes) if ((incoming.get(node.id) ?? []).length === 0) visit(node.id, 0, new Set());
  const maxLayer = Math.max(0, ...layer.values());
  const columnWidth = area.width / Math.max(1, maxLayer + 1);
  const byLayer = new Map<number, string[]>();
  for (const node of nodes) {
    const depth = layer.get(node.id) ?? 0;
    byLayer.set(depth, [...(byLayer.get(depth) ?? []), node.id]);
  }
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>();
  let totalValue = 0;
  for (const link of links) totalValue += link.value;
  const scaleValue = (area.height - 8) / Math.max(1, totalValue);
  for (const [depth, ids] of byLayer) {
    const gap = 6;
    const available = area.height - gap * Math.max(0, ids.length - 1);
    const sum = ids.reduce((total, id) => {
      const value = links.filter((link) => link.from === id || link.to === id).reduce((part, link) => part + link.value, 0);
      return total + Math.max(2, value * scaleValue);
    }, 0);
    let y = area.top + (area.height - Math.min(area.height, sum)) / 2;
    for (const id of ids) {
      const value = links.filter((link) => link.from === id || link.to === id).reduce((part, link) => part + link.value, 0);
      const height = Math.max(2, (value * scaleValue * available) / Math.max(1, sum) * (ids.length > 0 ? 1 : 1));
      const x = area.left + columnWidth * depth + columnWidth * 0.32;
      positions.set(id, { x, y, w: Math.max(4, columnWidth * 0.22), h: height });
      shapes.push(rect(x, y, Math.max(4, columnWidth * 0.22), height, ctx.color('ink'), ctx.color('accent'), 0.3));
      shapes.push(text(x - 3, y + height / 2 + 3, id.slice(0, 10), { size: 8, anchor: 'end', color: AXIS }));
      y += height + gap;
    }
  }
  for (const link of links) {
    const from = positions.get(link.from);
    const to = positions.get(link.to);
    if (!from || !to) continue;
    const thickness = Math.max(1.5, link.value * scaleValue * 0.5);
    const x1 = from.x + from.w;
    const y1 = from.y + from.h / 2;
    const x2 = to.x;
    const y2 = to.y + to.h / 2;
    shapes.push(
      path(
        `M ${round(x1)} ${round(y1 - thickness / 2)} C ${round((x1 + x2) / 2)} ${round(y1 - thickness / 2)}, ${round((x1 + x2) / 2)} ${round(y2 - thickness / 2)}, ${round(x2)} ${round(y2 - thickness / 2)} L ${round(x2)} ${round(y2 + thickness / 2)} C ${round((x1 + x2) / 2)} ${round(y2 + thickness / 2)}, ${round((x1 + x2) / 2)} ${round(y1 + thickness / 2)}, ${round(x1)} ${round(y1 + thickness / 2)} Z`,
        ctx.color('muted'),
        1,
        ctx.color('accent'),
        0.18,
      ),
    );
  }
}

function chord(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const nodes = element.nodes ?? [];
  const links = element.links ?? [];
  if (nodes.length < 2 || links.length === 0) return;
  const area = innerFrame(frame, { left: 20, top: 14, width: 20, height: 20 });
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height / 2;
  const radius = Math.max(20, Math.min(area.width, area.height) / 2 - 4);
  const totals = nodes.map((node) =>
    links.filter((link) => link.from === node.id || link.to === node.id).reduce((sum, link) => sum + link.value, 0),
  );
  const total = Math.max(1, totals.reduce((sum, value) => sum + value, 0));
  const angles = new Map<string, { start: number; end: number }>();
  let angle = -Math.PI / 2;
  nodes.forEach((node, index) => {
    const sweep = (totals[index]! / total) * Math.PI * 2;
    angles.set(node.id, { start: angle, end: angle + sweep });
    const color = paletteColor(ctx, index);
    const steps = Math.max(2, Math.round((sweep / (Math.PI * 2)) * 64));
    for (let step = 0; step < steps; step += 1) {
      const a1 = angle + (sweep * step) / steps;
      const a2 = angle + (sweep * (step + 1)) / steps;
      shapes.push(
        line(cx + Math.cos(a1) * radius, cy + Math.sin(a1) * radius, cx + Math.cos(a2) * radius, cy + Math.sin(a2) * radius, color, 6),
      );
    }
    shapes.push(text(cx + Math.cos(angle + sweep / 2) * (radius + 12), cy + Math.sin(angle + sweep / 2) * (radius + 12), node.label ?? node.id, { size: 8, color: AXIS }));
    angle += sweep;
  });
  for (const link of links) {
    const from = angles.get(link.from);
    const to = angles.get(link.to);
    if (!from || !to) continue;
    const a1 = (from.start + from.end) / 2;
    const a2 = (to.start + to.end) / 2;
    const x1 = cx + Math.cos(a1) * radius * 0.92;
    const y1 = cy + Math.sin(a1) * radius * 0.92;
    const x2 = cx + Math.cos(a2) * radius * 0.92;
    const y2 = cy + Math.sin(a2) * radius * 0.92;
    shapes.push(
      path(
        `M ${round(x1)} ${round(y1)} Q ${round(cx)} ${round(cy)} ${round(x2)} ${round(y2)}`,
        ctx.color('muted'),
        1.4,
        ctx.color('accent'),
        0.12,
      ),
    );
  }
}

function gantt(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const tasks = element.tasks ?? [];
  if (tasks.length === 0) return;
  const min = element.min ?? Math.min(...tasks.map((task) => task.start));
  const max = element.max ?? Math.max(...tasks.map((task) => task.end));
  const xMap = scale(min, max, area.left, area.left + area.width);
  const rowHeight = area.height / Math.max(1, tasks.length);
  tasks.forEach((task, index) => {
    const y = area.top + rowHeight * index + rowHeight * 0.2;
    const color = task.color ? ctx.color(task.color) : paletteColor(ctx, index);
    shapes.push(rect(xMap(task.start), y, Math.max(1, xMap(task.end) - xMap(task.start)), rowHeight * 0.6, color, color, 0.32));
    shapes.push(text(area.left - 4, y + rowHeight * 0.3 + 3, task.label.slice(0, 14), { size: 8, anchor: 'end', color: AXIS }));
  });
  const xTicks = ticks(min, max, 5);
  for (const tick of xTicks) {
    shapes.push(text(xMap(tick), area.top + area.height + 12, formatNumber(tick), { size: 8, color: AXIS }));
    shapes.push(line(xMap(tick), area.top, xMap(tick), area.top + area.height, GRID, 1));
  }
}

function scatterMatrix(element: ChartElement, frame: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const series = (element.series ?? []).slice(0, 4);
  if (series.length === 0) return;
  const columns = series.length > 1 ? 2 : 1;
  const rows = series.length > 1 ? 2 : 1;
  const cellWidth = frame.width / columns;
  const cellHeight = frame.height / rows;
  series.forEach((item, index) => {
    const x = frame.left + (index % columns) * cellWidth;
    const y = frame.top + Math.floor(index / columns) * cellHeight;
    const area = innerFrame({ left: x, top: y, width: cellWidth, height: cellHeight }, { left: 18, top: 12, width: 8, height: 14 });
    const points = seriesPoints(item);
    if (points.length === 0) return;
    const [xMin, xMax] = extent(points.map((point) => point.x));
    const [yMin, yMax] = extent(points.map((point) => point.y));
    const xMap = scale(xMin, xMax, area.left, area.left + area.width);
    const yMap = scale(yMin, yMax, area.top + area.height, area.top);
    const color = paletteColor(ctx, index);
    for (const point of points) shapes.push(circle(xMap(point.x), yMap(point.y), 2, color, color, 0.8));
    shapes.push(rect(area.left, area.top, area.width, area.height, GRID));
  });
}

function contour(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const series = element.series ?? [];
  const lines = series.flatMap((item) => item.lines ?? []);
  if (lines.length === 0) return;
  const all = lines.flat();
  const [xMin, xMax] = extent(all.map(([x]) => x));
  const [yMin, yMax] = extent(all.map(([, y]) => y));
  drawAxes(shapes, area, yMin, yMax, { kind: 'linear', min: xMin, max: xMax }, element.xLabel, element.yLabel);
  const xMap = scale(xMin, xMax, area.left, area.left + area.width);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  lines.forEach((points, index) => {
    shapes.push(path(polylinePath(points.map(([x, y]) => [xMap(x), yMap(y)] as [number, number])), paletteColor(ctx, index), 1.6));
  });
}

function dual(element: ChartElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const series = element.series ?? [];
  if (series.length === 0) return;
  const all = series.flatMap((item) => seriesPoints(item));
  const [xMin, xMax] = extent(all.map((point) => point.x));
  const [yMin, yMax] = domainFor(element, false);
  drawAxes(shapes, area, yMin, yMax, { kind: 'linear', min: xMin, max: xMax }, element.xLabel, element.yLabel);
  const xMap = scale(xMin, xMax, area.left, area.left + area.width);
  const yMap = scale(yMin, yMax, area.top + area.height, area.top);
  series.forEach((item, index) => {
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, index);
    const points = seriesPoints(item);
    shapes.push(path(polylinePath(points.map((point) => [xMap(point.x), yMap(point.y)] as [number, number])), color, 2));
    for (const point of points) shapes.push(circle(xMap(point.x), yMap(point.y), 2.5, color, color, 1));
  });
}

export function renderChart(element: ChartElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const frame = frameOf(element, ctx);
  const area = innerFrame(frame, {
    left: element.variant === 'population' ? 34 : 42,
    top: 18,
    width: 16,
    height: 34,
  });
  switch (element.variant) {
    case 'bar':
      bars(element, area, ctx, shapes);
      break;
    case 'line':
      xyPlot(element, area, ctx, shapes, 'line');
      break;
    case 'area':
      xyPlot(element, area, ctx, shapes, 'area');
      break;
    case 'scatter':
      xyPlot(element, area, ctx, shapes, 'scatter');
      break;
    case 'bubble':
      xyPlot(element, area, ctx, shapes, 'bubble');
      break;
    case 'phase':
      xyPlot(element, area, ctx, shapes, 'phase');
      break;
    case 'dual':
      dual(element, area, ctx, shapes);
      break;
    case 'errorbar':
      errorBars(element, area, ctx, shapes);
      break;
    case 'box':
      boxPlots(element, area, ctx, shapes, false);
      break;
    case 'violin':
      boxPlots(element, area, ctx, shapes, true);
      break;
    case 'radar':
      radar(element, frame, ctx, shapes);
      break;
    case 'gauge':
      gauge(element, frame, ctx, shapes);
      break;
    case 'funnel':
      funnel(element, area, ctx, shapes);
      break;
    case 'heatmap':
      heatmap(element, frame, ctx, shapes);
      break;
    case 'polar':
      polar(element, frame, ctx, shapes);
      break;
    case 'vector':
      vectorField(element, area, ctx, shapes);
      break;
    case 'waterfall':
      waterfall(element, area, ctx, shapes);
      break;
    case 'population':
      population(element, area, ctx, shapes);
      break;
    case 'wordcloud':
      wordCloud(frame, ctx, element, shapes);
      break;
    case 'treemap':
      treemap(element, area, ctx, shapes);
      break;
    case 'sunburst':
      sunburst(element, frame, ctx, shapes);
      break;
    case 'sankey':
      sankey(element, area, ctx, shapes);
      break;
    case 'chord':
      chord(element, frame, ctx, shapes);
      break;
    case 'gantt':
      gantt(element, area, ctx, shapes);
      break;
    case 'scatter-matrix':
      scatterMatrix(element, frame, ctx, shapes);
      break;
    case 'contour':
      contour(element, area, ctx, shapes);
      break;
    default:
      break;
  }
  return shapes;
}

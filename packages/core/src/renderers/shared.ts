/**
 * Small geometry helpers shared by the compound renderers.
 *
 * Renderers receive a `RenderContext` rather than importing `figure.ts` at
 * runtime, which keeps the element parser and the drawing code acyclic.
 */
import type { FigureShape } from '../figure';
import type { RenderContext } from './types';

export { type RenderContext };

export function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function text(
  x: number,
  y: number,
  value: string,
  options: {
    size?: number;
    anchor?: 'start' | 'middle' | 'end';
    color?: string;
    weight?: number;
    mono?: boolean;
  } = {},
): FigureShape {
  return {
    kind: 'text',
    x: round(x),
    y: round(y),
    text: value,
    color: options.color ?? 'var(--ink)',
    size: options.size ?? 10,
    anchor: options.anchor ?? 'middle',
    ...(options.weight ? { weight: options.weight } : {}),
    ...(options.mono ? { mono: true } : {}),
  };
}

export function line(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = 'var(--ink-3)',
  width = 1,
  dash?: string,
): FigureShape {
  return {
    kind: 'line',
    x1: round(x1),
    y1: round(y1),
    x2: round(x2),
    y2: round(y2),
    color,
    width,
    ...(dash ? { dash } : {}),
  };
}

export function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  color = 'var(--ink)',
  fill?: string,
  fillOpacity?: number,
  rx?: number,
): FigureShape {
  return {
    kind: 'rect',
    x: round(x),
    y: round(y),
    width: round(Math.max(0, width)),
    height: round(Math.max(0, height)),
    color,
    ...(fill ? { fill } : {}),
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
    ...(rx !== undefined ? { rx } : {}),
  };
}

export function circle(
  cx: number,
  cy: number,
  r: number,
  color = 'var(--ink)',
  fill?: string,
  fillOpacity?: number,
): FigureShape {
  return {
    kind: 'circle',
    cx: round(cx),
    cy: round(cy),
    r: round(Math.max(0, r)),
    color,
    width: 1.4,
    ...(fill ? { fill } : {}),
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
  };
}

export function path(
  d: string,
  color = 'var(--ink)',
  width = 1.6,
  fill?: string,
  fillOpacity?: number,
  dash?: string,
): FigureShape {
  return {
    kind: 'path',
    d,
    color,
    width,
    ...(fill ? { fill } : {}),
    ...(fillOpacity !== undefined ? { fillOpacity } : {}),
    ...(dash ? { dash } : {}),
  };
}

export function polylinePath(points: ReadonlyArray<[number, number]>, close = false): string {
  if (points.length === 0) return '';
  const body = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`)
    .join(' ');
  return close ? `${body} Z` : body;
}

export function arrowHead(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  length = 7,
): FigureShape {
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.PI / 7;
  const leftX = x2 - length * Math.cos(angle - spread);
  const leftY = y2 - length * Math.sin(angle - spread);
  const rightX = x2 - length * Math.cos(angle + spread);
  const rightY = y2 - length * Math.sin(angle + spread);
  return path(
    `M ${round(leftX)} ${round(leftY)} L ${round(x2)} ${round(y2)} L ${round(rightX)} ${round(rightY)}`,
    color,
    1.6,
  );
}

export function arrow(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color = 'var(--ink-2)',
  width = 1.4,
  dashed = false,
): FigureShape[] {
  const shapes: FigureShape[] = [
    {
      kind: 'line',
      x1: round(x1),
      y1: round(y1),
      x2: round(x2),
      y2: round(y2),
      color,
      width,
      ...(dashed ? { dash: '5 4' } : {}),
    },
  ];
  shapes.push(arrowHead(x1, y1, x2, y2, color));
  return shapes;
}

export function paletteColor(ctx: RenderContext, index: number): string {
  const names = ['accent', 'ok', 'warn', 'bad', 'muted'] as const;
  return ctx.color(names[index % names.length] ?? 'accent');
}

/** Split a frame into an inner plot rectangle. */
export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function innerFrame(frame: Frame, pad: Partial<Frame> = {}): Frame {
  const left = pad.left ?? 40;
  const right = pad.width ?? 14;
  const top = pad.top ?? 14;
  const bottom = pad.height ?? 30;
  return {
    left: frame.left + left,
    top: frame.top + top,
    width: Math.max(1, frame.width - left - right),
    height: Math.max(1, frame.height - top - bottom),
  };
}

export function scale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (value: number) => number {
  const span = domainMax - domainMin || 1;
  return (value: number) => rangeMin + ((value - domainMin) / span) * (rangeMax - rangeMin);
}

export function extent(values: readonly number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  return [min, max];
}

export function ticks(min: number, max: number, count = 5): number[] {
  const span = max - min || 1;
  const rough = span / Math.max(2, count);
  const power = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / power;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * power;
  const start = Math.ceil(min / step) * step;
  const values: number[] = [];
  for (let value = start; value <= max + step * 1e-6 && values.length < 40; value += step) {
    values.push(Number(value.toFixed(10)));
  }
  return values.length > 0 ? values : [min, max];
}

export function formatNumber(value: number): string {
  const rounded = Number(value.toFixed(6));
  if (Math.abs(rounded) >= 10_000 || (Math.abs(rounded) < 0.01 && rounded !== 0)) {
    return rounded.toExponential(1).replace('e+', 'e');
  }
  return String(rounded);
}

/** A short label broken into at most two lines, for a narrow axis band. */
export function shortLabel(value: string, max = 12): string[] {
  if (value.length <= max) return [value];
  return [value.slice(0, max - 1) + '…'];
}

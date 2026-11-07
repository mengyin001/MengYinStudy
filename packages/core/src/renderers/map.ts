/**
 * The schematic map renderer.
 *
 * It draws regions, routes, points, contours and cross-section layers. This is
 * deliberately labelled "schematic" in the grammar: it is not a survey map and
 * does not pretend to be one. A question that needs real coordinates should use
 * a web photo or a supplied GeoJSON-style outline, not an invented coastline.
 */
import type { FigureShape, MapElement, MapLine } from '../figure';
import {
  arrow,
  circle,
  line,
  paletteColor,
  path,
  polylinePath,
  rect,
  text,
  type Frame,
  type RenderContext,
} from './shared';

function frameOf(element: MapElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

function project(area: Frame, point: [number, number]): [number, number] {
  return [area.left + (point[0] / 100) * area.width, area.top + (point[1] / 100) * area.height];
}

function centroid(points: ReadonlyArray<[number, number]>): [number, number] {
  if (points.length === 0) return [0, 0];
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

function drawRegions(element: MapElement, area: Frame, ctx: RenderContext, shapes: FigureShape[], mode: string): void {
  (element.regions ?? []).forEach((region, index) => {
    const points = region.points.map((point) => project(area, point));
    if (points.length < 3) return;
    const color = region.color ? ctx.color(region.color) : paletteColor(ctx, index);
    shapes.push(path(polylinePath(points, true), color, 1.4, color, mode === 'urban' ? 0.34 : 0.16));
    if (region.label) {
      const [cx, cy] = centroid(points);
      shapes.push(text(cx, cy + 3, region.label.slice(0, 16), { size: 9, color: 'var(--ink)' }));
    }
  });
}

function drawLines(lines: ReadonlyArray<MapLine>, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  lines.forEach((item, index) => {
    const points = item.points.map((point) => project(area, point));
    if (points.length < 2) return;
    const color = item.color ? ctx.color(item.color) : paletteColor(ctx, index);
    if (item.arrow) {
      const start = points[0]!;
      const end = points[points.length - 1]!;
      shapes.push(...arrow(start[0], start[1], end[0], end[1], color, 1.5, item.dashed === true));
    } else {
      shapes.push(path(polylinePath(points), color, 1.6, undefined, undefined, item.dashed ? '5 4' : undefined));
    }
    if (item.label) {
      const middle = points[Math.floor(points.length / 2)]!;
      shapes.push(text(middle[0], middle[1] - 5, item.label.slice(0, 16), { size: 9, color: 'var(--ink-2)' }));
    }
  });
}

function drawPoints(element: MapElement, area: Frame, shapes: FigureShape[]): void {
  (element.points ?? []).forEach((point) => {
    const [x, y] = project(area, [point.x, point.y]);
    if (point.kind === 'capital') {
      shapes.push(circle(x, y, 4, 'var(--bad)', 'var(--bad)', 1));
      shapes.push(circle(x, y, 1.6, 'var(--surface, #fff)', 'var(--surface, #fff)', 1));
    } else if (point.kind === 'battle') {
      shapes.push(line(x - 4, y - 4, x + 4, y + 4, 'var(--bad)', 1.6));
      shapes.push(line(x - 4, y + 4, x + 4, y - 4, 'var(--bad)', 1.6));
    } else if (point.kind === 'site') {
      shapes.push(rect(x - 3, y - 3, 6, 6, 'var(--ink)', 'var(--warn)', 0.4));
    } else {
      shapes.push(circle(x, y, 3, 'var(--ink)', 'var(--ink)', 1));
    }
    if (point.label) {
      shapes.push(text(x + 5, y - 4, point.label.slice(0, 18), { size: 9, anchor: 'start', color: 'var(--ink)' }));
    }
  });
}

function drawArrows(element: MapElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  (element.arrows ?? []).forEach((item) => {
    const [x1, y1] = project(area, [item.x1, item.y1]);
    const [x2, y2] = project(area, [item.x2, item.y2]);
    const color = item.color ? ctx.color(item.color) : ctx.color('bad');
    shapes.push(...arrow(x1, y1, x2, y2, color, 2));
    if (item.label) {
      shapes.push(text((x1 + x2) / 2, (y1 + y2) / 2 - 5, item.label.slice(0, 18), { size: 9, color: 'var(--ink-2)' }));
    }
  });
}

function crossSection(element: MapElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const layers = element.layers ?? element.regions ?? [];
  const colours = ['warn', 'accent', 'muted', 'ok', 'bad'];
  layers.forEach((layer, index) => {
    const points = layer.points.map((point) => project(area, point));
    if (points.length < 3) return;
    const color = layer.color ? ctx.color(layer.color) : ctx.color(colours[index % colours.length] ?? 'muted');
    shapes.push(path(polylinePath(points, true), color, 1.3, color, 0.22));
    if (layer.label) {
      const [cx, cy] = centroid(points);
      shapes.push(text(cx, cy + 3, layer.label.slice(0, 18), { size: 9 }));
    }
  });
  shapes.push(line(area.left, area.top + area.height, area.left + area.width, area.top + area.height, 'var(--ink-3)', 1.2));
}

function tactics(element: MapElement, area: Frame, ctx: RenderContext, shapes: FigureShape[]): void {
  const inset = 4;
  shapes.push(rect(area.left + inset, area.top + inset, area.width - inset * 2, area.height - inset * 2, 'var(--ok)', 'var(--ok)', 0.08));
  shapes.push(line(area.left + area.width / 2, area.top + inset, area.left + area.width / 2, area.top + area.height - inset, 'var(--ok)', 1.2));
  shapes.push(circle(area.left + area.width / 2, area.top + area.height / 2, Math.min(area.width, area.height) * 0.14, 'var(--ok)', undefined));
  shapes.push(rect(area.left + area.width / 2 - area.width * 0.12, area.top + inset, area.width * 0.24, area.height * 0.14, 'var(--ok)'));
  shapes.push(rect(area.left + area.width / 2 - area.width * 0.12, area.top + area.height - inset - area.height * 0.14, area.width * 0.24, area.height * 0.14, 'var(--ok)'));
  drawArrows(element, area, ctx, shapes);
  drawPoints(element, area, shapes);
}

export function renderMap(element: MapElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const mode = element.mode ?? 'map';

  if (mode === 'tactics') {
    tactics(element, area, ctx, shapes);
  } else if (mode === 'cross-section') {
    crossSection(element, area, ctx, shapes);
  } else {
    drawRegions(element, area, ctx, shapes, mode);
    if (mode === 'contour') {
      drawLines(element.contours ?? [], area, ctx, shapes);
      // Thin contour lines for topography; labels are optional.
    } else if (mode === 'route') {
      drawLines(element.routes ?? [], area, ctx, shapes);
      drawPoints(element, area, shapes);
    } else {
      drawLines(element.routes ?? [], area, ctx, shapes);
      drawLines(element.contours ?? [], area, ctx, shapes);
      drawPoints(element, area, shapes);
      drawArrows(element, area, ctx, shapes);
    }
  }

  if (element.scale) {
    shapes.push(line(area.left + 6, area.top + area.height - 6, area.left + 46, area.top + area.height - 6, 'var(--ink)', 1.6));
    shapes.push(text(area.left + 26, area.top + area.height - 10, element.scale.slice(0, 18), { size: 8, color: 'var(--ink-3)' }));
  }
  return shapes;
}

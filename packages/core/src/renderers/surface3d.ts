/**
 * The 3-D surface renderer.
 *
 * A small isometric projection for a z-grid or a point cloud. It is not a
 * general 3-D engine: it draws axes, a wireframe surface and labelled points,
 * which is enough for a calculus or data question and cheap to store.
 */
import type { FigureShape, Surface3DElement } from '../figure';
import { circle, line, path, polylinePath, rect, text, type Frame, type RenderContext } from './shared';

function frameOf(element: Surface3DElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

export function renderSurface3D(element: Surface3DElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const grid = element.z;
  const points = element.points ?? [];
  if (!grid && points.length === 0) return shapes;

  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  if (grid) {
    grid.forEach((row, y) => {
      row.forEach((value, x) => {
        xs.push(x);
        ys.push(y);
        zs.push(value);
      });
    });
  }
  for (const point of points) {
    xs.push(point.x);
    ys.push(point.y);
    zs.push(point.z);
  }
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const zSpan = zMax - zMin || 1;
  const scaleX = area.width / Math.max(1, xMax - xMin);
  const scaleY = area.height / Math.max(1, yMax - yMin);
  const scaleZ = (area.height * 0.5) / zSpan;
  const cx = area.left + area.width / 2;
  const cy = area.top + area.height * 0.55;

  const project = (x: number, y: number, z: number): [number, number] => {
    const nx = (x - xMin) / Math.max(1e-6, xMax - xMin) - 0.5;
    const ny = (y - yMin) / Math.max(1e-6, yMax - yMin) - 0.5;
    const nz = (z - zMin) / zSpan;
    return [
      cx + (nx - ny) * scaleX * 0.72,
      cy + (nx + ny) * scaleY * 0.32 - nz * scaleZ,
    ];
  };

  // Axes.
  const origin = project(xMin, yMin, zMin);
  const xEnd = project(xMax, yMin, zMin);
  const yEnd = project(xMin, yMax, zMin);
  const zEnd = project(xMin, yMin, zMax);
  shapes.push(line(origin[0], origin[1], xEnd[0], xEnd[1], 'var(--ink-3)', 1.2));
  shapes.push(line(origin[0], origin[1], yEnd[0], yEnd[1], 'var(--ink-3)', 1.2));
  shapes.push(line(origin[0], origin[1], zEnd[0], zEnd[1], 'var(--ink-3)', 1.2));
  if (element.xLabel) shapes.push(text(xEnd[0], xEnd[1] + 12, element.xLabel.slice(0, 14), { size: 8, color: 'var(--ink-3)' }));
  if (element.yLabel) shapes.push(text(yEnd[0], yEnd[1] + 12, element.yLabel.slice(0, 14), { size: 8, color: 'var(--ink-3)' }));
  if (element.zLabel) shapes.push(text(zEnd[0] - 8, zEnd[1] - 4, element.zLabel.slice(0, 14), { size: 8, anchor: 'end', color: 'var(--ink-3)' }));

  if (grid) {
    const rows = grid.length;
    const columns = Math.max(...grid.map((row) => row.length));
    // Wireframe in both directions.
    for (let row = 0; row < rows; row += 1) {
      const pointsRow: Array<[number, number]> = [];
      for (let column = 0; column < columns; column += 1) {
        const value = grid[row]?.[column];
        if (value === undefined) continue;
        pointsRow.push(project(column, row, value));
      }
      if (pointsRow.length >= 2) shapes.push(path(polylinePath(pointsRow), ctx.color('accent'), 1.2));
    }
    for (let column = 0; column < columns; column += 1) {
      const pointsColumn: Array<[number, number]> = [];
      for (let row = 0; row < rows; row += 1) {
        const value = grid[row]?.[column];
        if (value === undefined) continue;
        pointsColumn.push(project(column, row, value));
      }
      if (pointsColumn.length >= 2) shapes.push(path(polylinePath(pointsColumn), ctx.color('accent'), 1.2));
    }
  }

  for (const point of points) {
    const [x, y] = project(point.x, point.y, point.z);
    shapes.push(circle(x, y, 3, ctx.color('bad'), ctx.color('bad'), 1));
    if (point.label) shapes.push(text(x + 5, y - 3, point.label.slice(0, 16), { size: 8, anchor: 'start', color: 'var(--ink)' }));
  }

  // A faint base plane so the surface reads as 3-D even with one line.
  shapes.push(rect(area.left + 4, area.top + 4, area.width - 8, area.height - 8, 'var(--rule)', undefined, undefined, 4));
  return shapes;
}

/**
 * The circuit renderer.
 *
 * Standard schematic symbols, drawn from a component list and a wire list. The
 * model names the components and where they sit; the renderer owns the symbol,
 * so a resistor can never become a random zigzag or a battery two short lines.
 */
import type { CircuitElement, CircuitPart, FigureShape } from '../figure';
import { circle, line, path, polylinePath, rect, round, text, type Frame, type RenderContext } from './shared';

const INK = 'var(--ink)';

function frameOf(element: CircuitElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

function project(area: Frame, x: number, y: number): [number, number] {
  return [area.left + (x / 100) * area.width, area.top + (y / 100) * area.height];
}

function rotate(cx: number, cy: number, degrees: number, x: number, y: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + x * cos - y * sin, cy + x * sin + y * cos];
}

function symbol(part: CircuitPart, cx: number, cy: number, rotation: number, shapes: FigureShape[]): void {
  const p = (x: number, y: number): [number, number] => rotate(cx, cy, rotation, x, y);
  const l = (x1: number, y1: number, x2: number, y2: number, width = 1.5): void => {
    const [ax, ay] = p(x1, y1);
    const [bx, by] = p(x2, y2);
    shapes.push(line(ax, ay, bx, by, INK, width));
  };
  const r = (x: number, y: number, width: number, height: number, fill?: string): void => {
    const [ax, ay] = p(x, y);
    const [bx, by] = p(x + width, y + height);
    shapes.push(rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), INK, fill));
  };
  const c = (x: number, y: number, radius: number, fill?: string): void => {
    const [px, py] = p(x, y);
    shapes.push(circle(px, py, radius, INK, fill));
  };
  const t = (value: string, x: number, y: number): void => {
    const [px, py] = p(x, y);
    shapes.push(text(px, py + 3, value, { size: 9, color: INK }));
  };

  switch (part.type) {
    case 'battery':
    case 'cell':
      l(-13, 0, -4, 0);
      l(4, 0, 13, 0);
      l(-4, -9, -4, 9, 2);
      l(4, -5, 4, 5, 2);
      if (part.type === 'cell') l(6, -9, 6, 9, 2);
      break;
    case 'resistor':
      l(-13, 0, -9, 0);
      l(9, 0, 13, 0);
      r(-9, -4, 18, 8);
      break;
    case 'capacitor':
      l(-13, 0, -3, 0);
      l(3, 0, 13, 0);
      l(-3, -8, -3, 8, 2);
      l(3, -8, 3, 8, 2);
      break;
    case 'lamp':
      l(-13, 0, -6, 0);
      l(6, 0, 13, 0);
      c(0, 0, 6.5);
      l(-4.5, -4.5, 4.5, 4.5, 1);
      l(-4.5, 4.5, 4.5, -4.5, 1);
      break;
    case 'switch':
      l(-13, 0, -5, 0);
      l(5, 0, 13, 0);
      l(-5, 0, 5, -6, 1.6);
      c(-5, 0, 1.4, INK);
      c(5, 0, 1.4, INK);
      break;
    case 'ammeter':
    case 'voltmeter':
    case 'motor':
      l(-13, 0, -7, 0);
      l(7, 0, 13, 0);
      c(0, 0, 7);
      t(part.type === 'ammeter' ? 'A' : part.type === 'voltmeter' ? 'V' : 'M', 0, 0);
      break;
    case 'inductor':
      l(-13, 0, -8, 0);
      for (let index = 0; index < 4; index += 1) {
        const start = -8 + index * 4;
        const [x1, y1] = p(start, 0);
        const [x2, y2] = p(start + 4, 0);
        shapes.push(path(`M ${round(x1)} ${round(y1)} A 2 2 0 0 1 ${round(x2)} ${round(y2)}`, INK, 1.5));
      }
      l(8, 0, 13, 0);
      break;
    case 'diode': {
      l(-13, 0, -5, 0);
      l(5, 0, 13, 0);
      const [x1, y1] = p(-5, -6);
      const [x2, y2] = p(-5, 6);
      const [x3, y3] = p(5, 0);
      shapes.push(path(`M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)} L ${round(x3)} ${round(y3)} Z`, INK, 1.4, INK, 0.12));
      l(5, -6, 5, 6, 2);
      break;
    }
    case 'ground':
      l(0, 0, 0, 8);
      l(-8, 8, 8, 8, 2);
      l(-5, 11, 5, 11, 1.6);
      l(-2, 14, 2, 14, 1.4);
      break;
    case 'junction':
      c(0, 0, 2.4, INK);
      break;
    default:
      break;
  }
}

export function renderCircuit(element: CircuitElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  for (const wire of element.wires) {
    const points = wire.points.map(([x, y]) => project(area, x, y));
    if (points.length < 2) continue;
    shapes.push(path(polylinePath(points), INK, 1.5));
  }
  for (const part of element.parts) {
    const [cx, cy] = project(area, part.x, part.y);
    symbol(part, cx, cy, part.rotation ?? 0, shapes);
    if (part.label || part.value) {
      const label = [part.label, part.value].filter(Boolean).join(' ');
      shapes.push(text(cx, cy - 13, label.slice(0, 24), { size: 9, color: 'var(--ink-2)' }));
    }
  }
  return shapes;
}

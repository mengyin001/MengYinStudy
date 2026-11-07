/**
 * The apparatus renderer.
 *
 * Stylised lab glassware, optics, simple machines and engineering blocks. It is
 * a sketch, not a CAD drawing: every part is a named symbol, so a beaker cannot
 * silently turn into a box and a lens cannot lose its curvature.
 */
import type { ApparatusElement, ApparatusPart, FigureShape } from '../figure';
import {
  arrow,
  circle,
  line,
  path,
  rect,
  round,
  text,
  type Frame,
  type RenderContext,
} from './shared';

const INK = 'var(--ink)';

function frameOf(element: ApparatusElement, ctx: RenderContext): Frame {
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

function partSize(part: ApparatusPart, area: Frame): { w: number; h: number } {
  return {
    w: ((part.w ?? 10) / 100) * area.width,
    h: ((part.h ?? 10) / 100) * area.height,
  };
}

function rotated(cx: number, cy: number, degrees: number, x: number, y: number): [number, number] {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [cx + x * cos - y * sin, cy + x * sin + y * cos];
}

function drawPart(part: ApparatusPart, area: Frame, shapes: FigureShape[], ctx: RenderContext): void {
  const [cx, cy] = project(area, part.x, part.y);
  const { w, h } = partSize(part, area);
  const halfW = w / 2;
  const halfH = h / 2;
  const rotation = part.rotation ?? 0;
  const p = (x: number, y: number): [number, number] => rotated(cx, cy, rotation, x, y);
  const l = (x1: number, y1: number, x2: number, y2: number, color = INK, width = 1.4): void => {
    const [ax, ay] = p(x1, y1);
    const [bx, by] = p(x2, y2);
    shapes.push(line(ax, ay, bx, by, color, width));
  };
  const box = (x: number, y: number, width: number, height: number, fill?: string, opacity?: number): void => {
    const [ax, ay] = p(x, y);
    const [bx, by] = p(x + width, y + height);
    shapes.push(rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay), INK, fill, opacity));
  };

  switch (part.type) {
    case 'beaker':
      l(-halfW, -halfH, -halfW, halfH);
      l(halfW, -halfH, halfW, halfH);
      l(-halfW, halfH, halfW, halfH);
      l(-halfW, -halfH, -halfW + 3, -halfH);
      l(halfW, -halfH, halfW - 3, -halfH);
      box(-halfW + 1, halfH * 0.1, w - 2, halfH * 0.85, ctx.color('accent'), 0.22);
      break;
    case 'flask': {
      const [a, b] = p(-halfW, halfH);
      const [c, d] = p(halfW, halfH);
      const [e, f] = p(-halfW * 0.35, -halfH);
      const [g, i] = p(halfW * 0.35, -halfH);
      const [j, k] = p(-halfW * 0.35, -halfH - 6);
      const [m, n] = p(halfW * 0.35, -halfH - 6);
      shapes.push(path(`M ${round(a)} ${round(b)} L ${round(e)} ${round(f)} L ${round(j)} ${round(k)} L ${round(m)} ${round(n)} L ${round(g)} ${round(i)} L ${round(c)} ${round(d)} Z`, INK, 1.4));
      box(-halfW * 0.8, halfH * 0.2, w * 0.8, halfH * 0.75, ctx.color('accent'), 0.22);
      break;
    }
    case 'test-tube':
      l(-halfW * 0.5, -halfH, -halfW * 0.5, halfH * 0.6);
      l(halfW * 0.5, -halfH, halfW * 0.5, halfH * 0.6);
      shapes.push(path(`M ${round(p(-halfW * 0.5, halfH * 0.6)[0])} ${round(p(-halfW * 0.5, halfH * 0.6)[1])} Q ${round(cx)} ${round(cy + halfH)} ${round(p(halfW * 0.5, halfH * 0.6)[0])} ${round(p(halfW * 0.5, halfH * 0.6)[1])}`, INK, 1.4));
      break;
    case 'burner':
      l(-halfW, halfH, halfW, halfH, INK, 1.8);
      l(-halfW * 0.4, halfH, -halfW * 0.25, halfH * 0.2);
      l(halfW * 0.4, halfH, halfW * 0.25, halfH * 0.2);
      l(-halfW * 0.25, halfH * 0.2, halfW * 0.25, halfH * 0.2);
      shapes.push(path(`M ${round(cx - 4)} ${round(cy + halfH * 0.2)} Q ${round(cx)} ${round(cy - halfH * 0.8)} ${round(cx + 4)} ${round(cy + halfH * 0.2)} Z`, ctx.color('warn'), 1.2, ctx.color('warn'), 0.35));
      break;
    case 'lens':
      shapes.push({ kind: 'ellipse', cx: round(cx), cy: round(cy), rx: round(halfW * 0.42), ry: round(halfH), color: INK, width: 1.4, fill: ctx.color('accent'), fillOpacity: 0.12 });
      break;
    case 'prism': {
      const [x1, y1] = p(-halfW, halfH);
      const [x2, y2] = p(halfW, halfH);
      const [x3, y3] = p(0, -halfH);
      shapes.push(path(`M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)} L ${round(x3)} ${round(y3)} Z`, INK, 1.4, ctx.color('accent'), 0.12));
      break;
    }
    case 'mirror':
      l(-halfW, halfH, halfW, -halfH, INK, 2);
      for (let index = -2; index <= 2; index += 1) {
        l(index * 4, halfH * 0.5, index * 4 + 6, halfH * 0.3, INK, 1);
      }
      break;
    case 'spring': {
      let d = `M ${round(p(-halfW, -halfH)[0])} ${round(p(-halfW, -halfH)[1])}`;
      for (let index = 0; index < 6; index += 1) {
        const x = -halfW + (w * (index + 0.5)) / 6;
        const y = index % 2 === 0 ? -halfH + 4 : -halfH - 4;
        d += ` L ${round(p(x, y)[0])} ${round(p(x, y)[1])}`;
      }
      d += ` L ${round(p(halfW, -halfH)[0])} ${round(p(halfW, -halfH)[1])}`;
      shapes.push(path(d, INK, 1.3));
      break;
    }
    case 'pulley':
      shapes.push(circle(cx, cy, Math.min(halfW, halfH), INK, ctx.color('accent'), 0.1));
      shapes.push(circle(cx, cy, 2.4, INK, INK, 1));
      l(0, -halfH, 0, -halfH - 6);
      break;
    case 'incline': {
      const [x1, y1] = p(-halfW, halfH);
      const [x2, y2] = p(halfW, halfH);
      const [x3, y3] = p(halfW, -halfH);
      shapes.push(path(`M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)} L ${round(x3)} ${round(y3)} Z`, INK, 1.4, ctx.color('accent'), 0.1));
      break;
    }
    case 'block':
      box(-halfW, -halfH, w, h, ctx.color('accent'), 0.2);
      break;
    case 'battery':
      l(-halfW, -halfH, -halfW, halfH, INK, 2);
      l(-halfW + 4, -halfH * 0.5, -halfW + 4, halfH * 0.5, INK, 2);
      break;
    case 'meter':
      shapes.push(circle(cx, cy, Math.min(halfW, halfH), INK, 'var(--surface, #fff)', 1));
      l(0, 0, halfW * 0.5, -halfH * 0.5, INK, 1.4);
      break;
    case 'lamp':
      shapes.push(circle(cx, cy, Math.min(halfW, halfH) * 0.6, INK, ctx.color('warn'), 0.25));
      for (let index = 0; index < 8; index += 1) {
        const angle = (index / 8) * Math.PI * 2;
        l(Math.cos(angle) * halfW * 0.75, Math.sin(angle) * halfH * 0.75, Math.cos(angle) * halfW, Math.sin(angle) * halfH, INK, 1);
      }
      break;
    case 'screen':
      box(-halfW, -halfH, w, h, 'var(--surface, #fff)', 1);
      break;
    case 'arrow':
      shapes.push(...arrow(cx - halfW, cy, cx + halfW, cy, INK, 1.6));
      break;
    case 'label':
      break;
    case 'box':
    default:
      box(-halfW, -halfH, w, h, ctx.color('accent'), 0.14);
      break;
  }
  if (part.label || part.type === 'label') {
    shapes.push(text(cx, cy + halfH + 12, (part.label ?? '').slice(0, 24), { size: 9, color: 'var(--ink)' }));
  }
}

export function renderApparatus(element: ApparatusElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  for (const connection of element.connections ?? []) {
    const from = element.parts[connection.from];
    const to = element.parts[connection.to];
    if (!from || !to) continue;
    const [x1, y1] = project(area, from.x, from.y);
    const [x2, y2] = project(area, to.x, to.y);
    if (connection.arrow) {
      shapes.push(...arrow(x1, y1, x2, y2, 'var(--ink-2)', 1.3, connection.dashed === true));
    } else {
      shapes.push(line(x1, y1, x2, y2, 'var(--ink-2)', 1.3, connection.dashed ? '5 4' : undefined));
    }
  }
  for (const part of element.parts) drawPart(part, area, shapes, ctx);
  return shapes;
}

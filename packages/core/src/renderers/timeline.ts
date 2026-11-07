/**
 * The timeline/Gantt renderer.
 *
 * One axis, event markers or task bars. A history timeline and a project Gantt
 * chart are the same geometry, which is why they share one renderer.
 */
import type { FigureShape, TimelineElement } from '../figure';
import {
  circle,
  clamp,
  formatNumber,
  line,
  paletteColor,
  rect,
  scale,
  text,
  ticks,
  type Frame,
  type RenderContext,
} from './shared';

function frameOf(element: TimelineElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

export function renderTimeline(element: TimelineElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const events = element.events ?? [];
  const tasks = element.tasks ?? [];
  const times = [
    ...events.map((event) => event.at),
    ...tasks.flatMap((task) => [task.start, task.end]),
  ];
  const min = element.min ?? Math.min(...times);
  const max = element.max ?? Math.max(...times);
  const xMap = scale(min, max === min ? min + 1 : max, area.left + 66, area.left + area.width - 10);

  const axisTicks = ticks(min, max === min ? min + 1 : max, 5);
  if (element.mode === 'gantt') {
    const rowHeight = area.height / Math.max(1, tasks.length);
    tasks.forEach((task, index) => {
      const y = area.top + rowHeight * index + rowHeight * 0.18;
      const color = task.color ? ctx.color(task.color) : paletteColor(ctx, index);
      shapes.push(rect(xMap(task.start), y, Math.max(1, xMap(task.end) - xMap(task.start)), rowHeight * 0.64, color, color, 0.32));
      shapes.push(text(area.left + 60, y + rowHeight * 0.32 + 3, task.label.slice(0, 18), { size: 9, anchor: 'end', color: 'var(--ink)' }));
    });
  } else {
    const axisY = area.top + area.height * 0.52;
    shapes.push(line(area.left + 60, axisY, area.left + area.width - 10, axisY, 'var(--ink)', 1.6));
    events.forEach((event, index) => {
      const x = xMap(event.at);
      const above = index % 2 === 0;
      const colour = paletteColor(ctx, index);
      shapes.push(circle(x, axisY, 4.2, colour, colour, 1));
      shapes.push(line(x, axisY, x, axisY + (above ? -12 : 12), colour, 1.2));
      const labelY = axisY + (above ? -18 : 24);
      shapes.push(text(clamp(x, area.left + 62, area.left + area.width - 12), labelY, event.label.slice(0, 20), { size: 9, color: 'var(--ink)' }));
      if (event.description) {
        shapes.push(text(clamp(x, area.left + 62, area.left + area.width - 12), labelY + (above ? -11 : 11), event.description.slice(0, 22), { size: 8, color: 'var(--ink-3)' }));
      }
    });
  }

  for (const tick of axisTicks) {
    const x = xMap(tick);
    shapes.push(line(x, area.top + area.height - 8, x, area.top + area.height - 4, 'var(--ink-3)', 1));
    shapes.push(text(x, area.top + area.height + 2, formatNumber(tick), { size: 8, color: 'var(--ink-3)' }));
  }
  if (element.unit) {
    shapes.push(text(area.left + area.width - 8, area.top + area.height + 2, element.unit.slice(0, 12), { size: 8, anchor: 'end', color: 'var(--ink-3)' }));
  }
  return shapes;
}

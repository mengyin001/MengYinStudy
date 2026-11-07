/**
 * The code and formula renderers.
 *
 * Pseudocode is a monospace block; a displayed formula is centred Unicode text.
 * They deliberately do not execute or typeset LaTeX: a model-written string is
 * shown as data, never evaluated.
 */
import type { CodeElement, FigureShape, FormulaElement } from '../figure';
import { line, rect, text, type Frame, type RenderContext } from './shared';

function frameOf(element: CodeElement | FormulaElement, ctx: RenderContext): Frame {
  const left = ctx.mapX(element.x);
  const top = ctx.mapY(element.y);
  return {
    left,
    top,
    width: Math.max(1, ctx.mapX(element.x + element.w) - left),
    height: Math.max(1, ctx.mapY(element.y + element.h) - top),
  };
}

export function renderCode(element: CodeElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  shapes.push(rect(area.left, area.top, area.width, area.height, 'var(--rule)', 'var(--surface-2, var(--surface, #fffdf7))', 1, 6));
  const lines = element.code.split('\n');
  const lineHeight = 13;
  const maxLines = Math.max(1, Math.floor((area.height - 14) / lineHeight));
  lines.slice(0, maxLines).forEach((value, index) => {
    shapes.push(
      text(area.left + 10, area.top + 16 + index * lineHeight, value.slice(0, 90), {
        size: 9,
        anchor: 'start',
        color: 'var(--ink)',
        mono: true,
      }),
    );
  });
  if (element.language) {
    shapes.push(text(area.left + area.width - 8, area.top + 10, element.language.slice(0, 12), { size: 8, anchor: 'end', color: 'var(--ink-3)' }));
  }
  shapes.push(line(area.left + 6, area.top + 6, area.left + 6, area.top + area.height - 6, 'var(--accent)', 1.2));
  return shapes;
}

export function renderFormula(element: FormulaElement, ctx: RenderContext): FigureShape[] {
  const shapes: FigureShape[] = [];
  const area = frameOf(element, ctx);
  const length = element.text.length;
  const size = Math.max(12, Math.min(26, Math.floor(area.width / Math.max(6, length * 0.62))));
  shapes.push(rect(area.left, area.top, area.width, area.height, 'var(--rule)', 'var(--surface-2, var(--surface, #fffdf7))', 0.6, 5));
  shapes.push(
    text(area.left + area.width / 2, area.top + area.height / 2 + size * 0.32, element.text, {
      size,
      color: 'var(--ink)',
      anchor: 'middle',
    }),
  );
  return shapes;
}

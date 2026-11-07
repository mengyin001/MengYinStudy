import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FigureSpec } from '@mengyin/core';
import { FigureView } from './FigureView';

const spec: FigureSpec = {
  v: 1,
  title: 'Parabola',
  width: 420,
  height: 280,
  coords: 'cartesian',
  x: { min: -2, max: 2 },
  y: { min: 0, max: 4 },
  grid: true,
  elements: [
    { kind: 'plot', expr: 'x^2' },
    { kind: 'point', x: 1, y: 1, label: 'A' },
    { kind: 'label', x: 0, y: 3, text: 'A & B <script>alert(1)</script>' },
  ],
};

describe('FigureView', () => {
  it('renders an accessible inline SVG', () => {
    const html = renderToStaticMarkup(createElement(FigureView, { spec, alt: '一條拋物線' }));
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="一條拋物線"');
    expect(html).toContain('<svg');
    expect(html).toContain('viewBox="0 0 420 280"');
    expect(html).toContain('<path');
    expect(html).toContain('figure__title');
    expect(html).toContain('Parabola');
  });

  it('escapes model-written labels instead of injecting markup', () => {
    const html = renderToStaticMarkup(createElement(FigureView, { spec }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B');
  });

  it('falls back to a generated description when alt is missing', () => {
    const html = renderToStaticMarkup(createElement(FigureView, { spec }));
    expect(html).toContain('aria-label="Parabola');
  });

  it('normalises legacy pixel coordinates before drawing', () => {
    // A 0–300 plain spec from an older deck must render as a closed triangle,
    // not clip its bottom leg outside the viewBox.
    const legacy: FigureSpec = {
      v: 1,
      width: 420,
      height: 300,
      coords: 'plain',
      x: { min: 0, max: 100 },
      y: { min: 0, max: 100 },
      grid: false,
      elements: [
        {
          kind: 'polygon',
          points: [
            [80, 240],
            [80, 80],
            [300, 240],
          ],
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(FigureView, { spec: legacy }));
    expect(html).toContain('<path');
    const d = /<path d="([^"]+)"/.exec(html)?.[1] ?? '';
    for (const match of d.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)) {
      expect(Number(match[1])).toBeLessThanOrEqual(420);
      expect(Number(match[2])).toBeLessThanOrEqual(300);
    }
  });
});

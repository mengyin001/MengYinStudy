import { describe, expect, it } from 'vitest';
import {
  compileExpression,
  describeFigure,
  evaluateExpression,
  isFigure,
  layoutFigure,
  parseFigureSpec,
  samplePlot,
  type FigureSpec,
} from './figure';

const base = {
  v: 1,
  coords: 'cartesian' as const,
  x: { min: -2, max: 2 },
  y: { min: -1, max: 4 },
  elements: [{ kind: 'plot', expr: 'x^2' }],
};

describe('parseFigureSpec', () => {
  it('normalises defaults and keeps known elements', () => {
    const spec = parseFigureSpec(base);
    expect(spec).not.toBeNull();
    expect(spec?.width).toBe(420);
    expect(spec?.height).toBe(280);
    expect(spec?.coords).toBe('cartesian');
    expect(spec?.elements).toHaveLength(1);
    expect(spec?.v).toBe(1);
  });

  it('accepts plain coordinates and labels', () => {
    const spec = parseFigureSpec({
      v: 1,
      coords: 'plain',
      elements: [{ kind: 'label', x: 50, y: 50, text: 'Hello' }],
    });
    expect(spec?.coords).toBe('plain');
    expect(spec?.x.max).toBe(100);
  });

  it('drops unknown shapes and returns null when nothing is left', () => {
    expect(parseFigureSpec({ v: 1, elements: [{ kind: 'hologram' }] })).toBeNull();
    expect(parseFigureSpec({ v: 1, elements: [] })).toBeNull();
    expect(parseFigureSpec({ v: 2, elements: base.elements })).toBeNull();
    expect(parseFigureSpec('not json')).toBeNull();
  });

  it('parses a JSON string and bounds an over-long one', () => {
    expect(parseFigureSpec(JSON.stringify(base))?.elements).toHaveLength(1);
    expect(parseFigureSpec(' '.repeat(30_000))).toBeNull();
  });

  it('rejects a plot with an invalid formula', () => {
    expect(
      parseFigureSpec({ v: 1, elements: [{ kind: 'plot', expr: 'alert(1)' }] }),
    ).toBeNull();
    expect(parseFigureSpec({ v: 1, elements: [{ kind: 'plot', expr: 'x +' }] })).toBeNull();
  });

  it('parses a line given as from/to or x1/y1/x2/y2', () => {
    const byPoints = parseFigureSpec({
      v: 1,
      elements: [{ kind: 'line', from: [0, 0], to: [1, 2], arrow: true }],
    });
    expect(byPoints?.elements[0]).toMatchObject({ x1: 0, y1: 0, x2: 1, y2: 2, arrow: true });
    const byCoords = parseFigureSpec({
      v: 1,
      elements: [{ kind: 'line', x1: 1, y1: 1, x2: 2, y2: 2 }],
    });
    expect(byCoords?.elements[0]).toMatchObject({ x1: 1, y1: 1, x2: 2, y2: 2 });
  });

  it('caps element and text sizes', () => {
    const elements = Array.from({ length: 100 }, () => ({ kind: 'point', x: 0, y: 0, label: 'x'.repeat(200) }));
    const spec = parseFigureSpec({ v: 1, elements });
    expect(spec?.elements.length).toBe(60);
    const first = spec?.elements[0];
    if (first?.kind === 'point') expect(first.label?.length).toBe(40);
  });

  it('recognises a figure media item', () => {
    expect(isFigure({ type: 'figure', figure: base })).toBe(true);
    expect(isFigure({ type: 'image', src: 'data:image/png;base64,AA' })).toBe(false);
  });
});

describe('expression sandbox', () => {
  it('evaluates arithmetic with normal precedence', () => {
    expect(evaluateExpression('1 + 2 * 3', 0)).toBe(7);
    expect(evaluateExpression('(1 + 2) * 3', 0)).toBe(9);
    expect(evaluateExpression('2 ^ 3 ^ 2', 0)).toBe(512);
    expect(evaluateExpression('-2^2', 0)).toBe(-4);
  });

  it('supports implicit multiplication and constants', () => {
    expect(evaluateExpression('2x', 3)).toBe(6);
    expect(evaluateExpression('2 sin(pi / 2)', 0)).toBeCloseTo(2);
    expect(evaluateExpression('x(x + 1)', 2)).toBe(6);
  });

  it('supports the documented functions', () => {
    expect(evaluateExpression('sqrt(9)', 0)).toBe(3);
    expect(evaluateExpression('abs(-4)', 0)).toBe(4);
    expect(evaluateExpression('max(2, 5)', 0)).toBe(5);
    expect(evaluateExpression('log(1000)', 0)).toBe(3);
    expect(evaluateExpression('ln(e)', 0)).toBeCloseTo(1);
    expect(evaluateExpression('round(2.6)', 0)).toBe(3);
  });

  it('refuses anything that is not arithmetic', () => {
    for (const source of [
      'alert(1)',
      'window.location',
      'x = 2',
      'x++',
      'this.constructor',
      'import("x")',
      'Math.sin(x)',
      'x => x',
      '[1,2]',
      '__proto__',
      'constructor(1)',
      'x'.repeat(200),
      '',
    ]) {
      expect(compileExpression(source), source).toBeNull();
    }
  });

  it('returns NaN for undefined values instead of throwing', () => {
    expect(Number.isNaN(evaluateExpression('1 / 0', 0))).toBe(true);
    expect(Number.isNaN(evaluateExpression('sqrt(-1)', 0))).toBe(true);
    expect(Number.isNaN(evaluateExpression('unknown(x)', 0))).toBe(true);
  });

  it('caps the size of the tree', () => {
    const long = Array.from({ length: 60 }, () => 'x').join('+');
    expect(compileExpression(long)).not.toBeNull();
    const huge = Array.from({ length: 140 }, () => 'x').join('+');
    expect(compileExpression(huge)).toBeNull();
  });

  it('samples a curve and breaks it at a discontinuity', () => {
    const sample = samplePlot('1/x', -1, 1, 101);
    expect(sample).not.toBeNull();
    expect(sample!.segments.length).toBe(2);
    expect(sample!.segments[0]!.every((point) => point.x < 0)).toBe(true);
  });
});

describe('layoutFigure', () => {
  it('maps cartesian data into the padded plot area', () => {
    const spec = parseFigureSpec(base) as FigureSpec;
    const drawing = layoutFigure(spec);
    expect(drawing.width).toBe(420);
    expect(drawing.height).toBe(280);
    expect(drawing.shapes.length).toBeGreaterThan(4);
    const paths = drawing.shapes.filter((shape) => shape.kind === 'path');
    expect(paths.length).toBeGreaterThan(0);
    if (paths[0]?.kind === 'path') {
      for (const pair of paths[0].d.matchAll(/([ML]) ([\d.-]+) ([\d.-]+)/g)) {
        expect(Number(pair[2])).toBeGreaterThanOrEqual(0);
        expect(Number(pair[2])).toBeLessThanOrEqual(420);
        expect(Number(pair[3])).toBeGreaterThanOrEqual(0);
        expect(Number(pair[3])).toBeLessThanOrEqual(280);
      }
    }
  });

  it('draws axes and tick labels; the title is left to the HTML caption', () => {
    const spec = parseFigureSpec({ ...base, title: 'Parabola', grid: true }) as FigureSpec;
    const drawing = layoutFigure(spec);
    const texts = drawing.shapes.filter((shape) => shape.kind === 'text');
    expect(texts.some((shape) => shape.text === 'Parabola')).toBe(false);
    expect(texts.some((shape) => shape.text === '0')).toBe(true);
    expect(drawing.shapes.some((shape) => shape.color === 'var(--rule)')).toBe(true);
  });

  it('draws plain coordinates without axes', () => {
    const spec = parseFigureSpec({
      v: 1,
      coords: 'plain',
      width: 300,
      height: 200,
      elements: [
        { kind: 'label', x: 10, y: 20, text: 'A' },
        { kind: 'circle', x: 50, y: 50, r: 10 },
        { kind: 'polygon', points: [[0, 0], [50, 0], [50, 50]], fill: true },
      ],
    }) as FigureSpec;
    const drawing = layoutFigure(spec);
    const text = drawing.shapes.find((shape) => shape.kind === 'text' && shape.text === 'A');
    expect(text).toMatchObject({ x: 30, y: 40 });
    expect(drawing.shapes.some((shape) => shape.kind === 'circle')).toBe(true);
    // No axis tick text: "0" would only come from an axis label.
    expect(drawing.shapes.some((shape) => shape.kind === 'text' && shape.text === '0')).toBe(false);
  });

  it('draws an arrow head as a path', () => {
    const spec = parseFigureSpec({
      v: 1,
      elements: [{ kind: 'line', x1: 0, y1: 0, x2: 5, y2: 5, arrow: true }],
    }) as FigureSpec;
    const paths = layoutFigure(spec).shapes.filter((shape) => shape.kind === 'path');
    expect(paths.length).toBeGreaterThan(0);
  });

  it('resolves named colours to theme variables', () => {
    const spec = parseFigureSpec({
      v: 1,
      elements: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1, color: 'warn' }],
    }) as FigureSpec;
    const line = layoutFigure(spec).shapes.find((shape) => shape.kind === 'line' && shape.color !== 'var(--ink-3)');
    // The literal fallback keeps an exported SVG visible without the app theme.
    expect(line?.color).toBe('var(--warn, #86621a)');
  });

  it('rejects a colour name from the prototype chain', () => {
    const spec = parseFigureSpec({
      v: 1,
      elements: [{ kind: 'line', x1: 0, y1: 0, x2: 1, y2: 1, color: '__proto__' }],
    }) as FigureSpec;
    expect(layoutFigure(spec).shapes.every((shape) => typeof shape.color === 'string')).toBe(true);
  });
});

describe('describeFigure', () => {
  it('prefers the alt text and otherwise names the formula', () => {
    const spec = parseFigureSpec(base) as FigureSpec;
    expect(describeFigure(spec, '一條拋物線')).toBe('一條拋物線');
    expect(describeFigure(spec)).toContain('y = x^2');
  });
});

describe('plain coordinate units', () => {
  // Reproduced from a real model reply: the canvas is 420×300 but the model
  // wrote pixel coordinates (80, 240, 300). Treated as percentages, the bottom
  // leg fell outside the viewBox and the triangle looked broken.
  const pixelSpec = {
    v: 1,
    title: '等腰直角三角形',
    width: 420,
    height: 300,
    coords: 'plain',
    elements: [
      {
        kind: 'polygon',
        points: [
          [80, 240],
          [80, 80],
          [300, 240],
        ],
      },
      { kind: 'label', x: 70, y: 160, text: '6' },
      { kind: 'label', x: 190, y: 265, text: '6' },
      { kind: 'label', x: 95, y: 225, text: '直角' },
    ],
  };

  it('detects pixel coordinates and converts them to percentages', () => {
    const spec = parseFigureSpec(pixelSpec) as FigureSpec;
    const polygon = spec.elements[0];
    expect(polygon?.kind).toBe('polygon');
    if (polygon?.kind === 'polygon') {
      expect(polygon.points[0]?.[0]).toBeCloseTo((80 / 420) * 100);
      expect(polygon.points[0]?.[1]).toBeCloseTo(80);
      expect(polygon.points[2]?.[0]).toBeCloseTo((300 / 420) * 100);
    }
    const label = spec.elements[1];
    if (label?.kind === 'label') {
      expect(label.x).toBeCloseTo((70 / 420) * 100);
      expect(label.y).toBeCloseTo((160 / 300) * 100);
    }
  });

  it('keeps a genuine 0–100 spec unchanged', () => {
    const spec = parseFigureSpec({
      v: 1,
      coords: 'plain',
      elements: [
        { kind: 'line', x1: 20, y1: 80, x2: 80, y2: 80 },
        { kind: 'label', x: 50, y: 50, text: 'A' },
      ],
    }) as FigureSpec;
    expect(spec.elements[0]).toMatchObject({ x1: 20, y1: 80, x2: 80, y2: 80 });
    expect(spec.elements[1]).toMatchObject({ x: 50, y: 50 });
  });

  it('normalises each axis independently', () => {
    const spec = parseFigureSpec({
      v: 1,
      coords: 'plain',
      width: 400,
      height: 200,
      elements: [{ kind: 'line', x1: 0, y1: 0, x2: 200, y2: 50 }],
    }) as FigureSpec;
    const line = spec.elements[0];
    if (line?.kind === 'line') {
      expect(line.x2).toBe(50);
      expect(line.y2).toBe(50);
    }
  });

  it('draws the converted triangle inside the viewBox', () => {
    const spec = parseFigureSpec(pixelSpec) as FigureSpec;
    const drawing = layoutFigure(spec);
    const path = drawing.shapes.find((shape) => shape.kind === 'path');
    expect(path?.kind).toBe('path');
    if (path?.kind === 'path') {
      for (const match of path.d.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(0);
        expect(Number(match[1])).toBeLessThanOrEqual(420);
        expect(Number(match[2])).toBeGreaterThanOrEqual(0);
        expect(Number(match[2])).toBeLessThanOrEqual(300);
      }
    }
  });
});

describe('flow shapes', () => {
  const baseFlow = {
    v: 1,
    coords: 'plain',
    width: 480,
    height: 220,
    elements: [
      { kind: 'shape', shape: 'rounded', x: 40, y: 5, w: 20, h: 10, text: '開始' },
      { kind: 'shape', shape: 'rect', x: 40, y: 25, w: 20, h: 10, text: '處理', fill: true },
      { kind: 'shape', shape: 'diamond', x: 35, y: 45, w: 30, h: 18, text: '判斷' },
      { kind: 'shape', shape: 'ellipse', x: 10, y: 10, w: 12, h: 8, text: 'A' },
      { kind: 'shape', shape: 'parallelogram', x: 70, y: 25, w: 22, h: 10, text: '輸入' },
    ],
  };

  it('draws each node kind and centres its text', () => {
    const spec = parseFigureSpec(baseFlow) as FigureSpec;
    const drawing = layoutFigure(spec);
    const rects = drawing.shapes.filter((shape) => shape.kind === 'rect');
    const ellipses = drawing.shapes.filter((shape) => shape.kind === 'ellipse');
    const paths = drawing.shapes.filter((shape) => shape.kind === 'path');
    expect(rects.length).toBe(2);
    expect(ellipses).toHaveLength(1);
    expect(paths.length).toBe(2);
    expect(rects.some((rect) => rect.kind === 'rect' && (rect.rx ?? 0) > 0)).toBe(true);
    const label = drawing.shapes.find((shape) => shape.kind === 'text' && shape.text === '判斷');
    expect(label?.kind).toBe('text');
    if (label?.kind === 'text') {
      expect(label.x).toBeCloseTo((35 + 15) / 100 * 480);
      expect(label.anchor).toBe('middle');
    }
  });

  it('rejects an unknown or cartesian shape', () => {
    expect(
      parseFigureSpec({ v: 1, coords: 'plain', elements: [{ kind: 'shape', shape: 'hexagon', x: 1, y: 1, w: 2, h: 2 }] }),
    ).toBeNull();
    expect(
      parseFigureSpec({
        v: 1,
        coords: 'cartesian',
        elements: [{ kind: 'shape', shape: 'rect', x: 1, y: 1, w: 2, h: 2 }],
      }),
    ).toBeNull();
  });

  it('normalises pixel-sized nodes', () => {
    const spec = parseFigureSpec({
      v: 1,
      coords: 'plain',
      width: 400,
      height: 200,
      elements: [{ kind: 'shape', shape: 'rect', x: 80, y: 40, w: 200, h: 80, text: 'A' }],
    }) as FigureSpec;
    expect(spec.elements[0]).toMatchObject({ x: 20, y: 20, w: 50, h: 40 });
  });
});

describe('real model output', () => {
  // Taken verbatim from a GLM generation (0.8.0 smoke test), including its
  // title, point labels and dashed axis line.
  const generated = {
    v: 1,
    title: '二次函數對稱軸',
    width: 420,
    height: 280,
    coords: 'cartesian',
    x: { min: -6, max: 0, step: 1 },
    y: { min: -5, max: 5, step: 1 },
    grid: true,
    elements: [
      { kind: 'plot', expr: '0.5 * x^2 + 3 * x + 2', from: -6, to: 0 },
      { kind: 'line', x1: -3, y1: -5, x2: -3, y2: 5, dashed: true, arrow: true },
      { kind: 'label', x: -3, y: 5.2, text: '對稱軸 x = -3', anchor: 'middle' },
    ],
  };

  it('accepts and lays out the spec an actual model wrote', () => {
    const spec = parseFigureSpec(generated);
    expect(spec).not.toBeNull();
    const drawing = layoutFigure(spec as FigureSpec);
    expect(drawing.shapes.some((shape) => shape.kind === 'path')).toBe(true);
    expect(drawing.shapes.some((shape) => shape.kind === 'text' && shape.text === '對稱軸 x = -3')).toBe(
      true,
    );
    // The label sits above y.max; it must still be clamped inside the drawing.
    const label = drawing.shapes.find(
      (shape) => shape.kind === 'text' && shape.text === '對稱軸 x = -3',
    );
    if (label?.kind === 'text') expect(label.y).toBeGreaterThanOrEqual(16);
  });
});

describe('pie element', () => {
  const pie = {
    v: 1 as const,
    coords: 'plain' as const,
    width: 480,
    height: 320,
    elements: [
      {
        kind: 'pie' as const,
        x: 50,
        y: 50,
        r: 30,
        slices: [
          { value: 40, label: 'A' },
          { value: 60, label: 'B' },
        ],
      },
    ],
  };

  it('parses a pie and draws one wedge per slice', () => {
    const spec = parseFigureSpec(pie);
    expect(spec).not.toBeNull();
    const first = spec?.elements[0];
    expect(first?.kind).toBe('pie');
    if (first?.kind === 'pie') expect(first.slices).toHaveLength(2);
    const drawing = layoutFigure(spec as FigureSpec);
    expect(drawing.shapes.filter((shape) => shape.kind === 'path')).toHaveLength(2);
    expect(drawing.shapes.filter((shape) => shape.kind === 'text')).toHaveLength(2);
  });

  it('rejects a pie on a cartesian canvas', () => {
    expect(parseFigureSpec({ ...pie, coords: 'cartesian' })).toBeNull();
  });

  it('describes a pie by its labels', () => {
    expect(describeFigure(parseFigureSpec(pie) as FigureSpec)).toContain('A, B');
  });
});

describe('table element', () => {
  const table = {
    v: 1 as const,
    coords: 'plain' as const,
    width: 480,
    height: 320,
    elements: [
      {
        kind: 'table' as const,
        x: 10,
        y: 20,
        w: 80,
        h: 40,
        columns: ['P', 'Q', 'P ∧ Q'],
        rows: [
          ['T', 'T', 'T'],
          ['T', 'F', 'F'],
          ['F', 'T', 'F'],
        ],
      },
    ],
  };

  it('parses a truth table and draws a grid with one cell per value', () => {
    const spec = parseFigureSpec(table);
    expect(spec).not.toBeNull();
    const first = spec?.elements[0];
    expect(first?.kind).toBe('table');
    if (first?.kind === 'table') {
      expect(first.columns).toEqual(['P', 'Q', 'P ∧ Q']);
      expect(first.rows).toHaveLength(3);
    }
    const drawing = layoutFigure(spec as FigureSpec);
    // 4 rows (header + 3) × 3 columns = 12 cells, each with a border rect.
    expect(drawing.shapes.filter((shape) => shape.kind === 'rect').length).toBe(12);
    expect(drawing.shapes.filter((shape) => shape.kind === 'text').length).toBe(12);
  });

  it('rejects a table on a cartesian canvas', () => {
    expect(
      parseFigureSpec({
        ...table,
        coords: 'cartesian',
      }),
    ).toBeNull();
  });

  it('describes a table by its cells', () => {
    const spec = parseFigureSpec(table) as FigureSpec;
    expect(describeFigure(spec)).toContain('P ∧ Q');
    expect(describeFigure(spec)).toContain('T, F, F');
  });
});

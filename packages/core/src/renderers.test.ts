import { describe, expect, it } from 'vitest';
import { figureElementTexts, layoutFigure, parseFigureSpec, type FigureElement, type FigureSpec } from './figure';

function spec(element: unknown, extra: Record<string, unknown> = {}): FigureSpec | null {
  return parseFigureSpec({
    v: 1,
    coords: 'plain',
    width: 480,
    height: 320,
    elements: [element],
    ...extra,
  });
}

function draw(element: unknown): number {
  const parsed = spec(element);
  expect(parsed).not.toBeNull();
  return layoutFigure(parsed as FigureSpec).shapes.length;
}

describe('compound renderers', () => {
  it('draws a chart with axes and marks', () => {
    const count = draw({
      kind: 'chart',
      variant: 'bar',
      x: 8,
      y: 10,
      w: 84,
      h: 72,
      categories: ['A', 'B'],
      series: [{ name: '2024', values: [3, 5] }],
      xLabel: 'group',
      yLabel: 'count',
    });
    expect(count).toBeGreaterThan(12);
  });

  it('draws a graph with nodes and connectors', () => {
    const parsed = spec({
      kind: 'graph',
      layout: 'layered',
      nodes: [
        { id: 'a', text: '開始', shape: 'rounded' },
        { id: 'b', text: '處理', shape: 'rect' },
      ],
      edges: [{ from: 'a', to: 'b', label: '下一步' }],
    });
    expect(parsed).not.toBeNull();
    const drawing = layoutFigure(parsed as FigureSpec);
    expect(drawing.shapes.length).toBeGreaterThan(5);
    expect(drawing.shapes.some((shape) => shape.kind === 'line')).toBe(true);
  });

  it('draws a schematic map with regions, routes and points', () => {
    const count = draw({
      kind: 'map',
      mode: 'map',
      x: 5,
      y: 5,
      w: 90,
      h: 85,
      regions: [{ points: [[10, 20], [40, 10], [50, 40]], label: 'A' }],
      points: [{ x: 30, y: 30, label: '首都', kind: 'capital' }],
      routes: [{ points: [[10, 80], [80, 20]], arrow: true }],
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws a circuit with standard symbols and wires', () => {
    const count = draw({
      kind: 'circuit',
      x: 5,
      y: 5,
      w: 90,
      h: 80,
      parts: [
        { type: 'battery', x: 12, y: 55 },
        { type: 'resistor', x: 50, y: 20, label: 'R1' },
      ],
      wires: [{ points: [[12, 55], [12, 20], [42, 20]] }],
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws a molecule and its reaction arrow', () => {
    const count = draw({
      kind: 'molecule',
      mode: 'reaction',
      x: 5,
      y: 5,
      w: 90,
      h: 80,
      groups: [
        { atoms: [{ element: 'C', x: 30, y: 50 }, { element: 'O', x: 60, y: 50 }], bonds: [{ from: 0, to: 1, order: 2 }] },
        { atoms: [{ element: 'C', x: 30, y: 50 }, { element: 'O', x: 60, y: 50 }], bonds: [{ from: 0, to: 1 }] },
      ],
      arrowLabel: '燃燒',
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws an orbital diagram', () => {
    const count = draw({
      kind: 'molecule',
      mode: 'orbital',
      x: 5,
      y: 5,
      w: 90,
      h: 80,
      levels: [
        { energy: 1, label: '2p', electrons: 4 },
        { energy: 0, label: '2s', electrons: 2 },
      ],
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws a music staff and notes', () => {
    const count = draw({
      kind: 'music',
      x: 5,
      y: 20,
      w: 90,
      h: 50,
      clef: 'treble',
      time: '4/4',
      notes: [
        { pitch: 'C4', duration: 1 },
        { pitch: 'E4', duration: 0.5 },
        { rest: true, duration: 1 },
      ],
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws a timeline and a Gantt chart', () => {
    expect(
      draw({
        kind: 'timeline',
        mode: 'timeline',
        x: 5,
        y: 10,
        w: 90,
        h: 75,
        unit: '年',
        events: [{ at: 1914, label: '事件' }],
      }),
    ).toBeGreaterThan(3);
    expect(
      draw({
        kind: 'timeline',
        mode: 'gantt',
        x: 5,
        y: 10,
        w: 90,
        h: 75,
        tasks: [
          { label: '設計', start: 1, end: 3 },
          { label: '實作', start: 3, end: 6 },
        ],
      }),
    ).toBeGreaterThan(3);
  });

  it('draws apparatus parts', () => {
    const count = draw({
      kind: 'apparatus',
      x: 5,
      y: 5,
      w: 90,
      h: 85,
      parts: [
        { type: 'beaker', x: 30, y: 50, label: '燒杯' },
        { type: 'lens', x: 60, y: 40 },
      ],
      connections: [{ from: 0, to: 1, arrow: true }],
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws a 3-D surface', () => {
    const count = draw({
      kind: 'surface3d',
      x: 10,
      y: 5,
      w: 80,
      h: 90,
      z: [
        [0, 1],
        [1, 2],
      ],
      xLabel: 'x',
      yLabel: 'y',
    });
    expect(count).toBeGreaterThan(5);
  });

  it('draws code and formula blocks', () => {
    expect(
      draw({
        kind: 'code',
        x: 5,
        y: 5,
        w: 90,
        h: 90,
        language: 'python',
        code: 'for i in range(3):\n    print(i)',
      }),
    ).toBeGreaterThan(3);
    expect(
      draw({
        kind: 'formula',
        x: 10,
        y: 30,
        w: 80,
        h: 30,
        text: 'E = mc²',
      }),
    ).toBeGreaterThanOrEqual(2);
  });

  it('rejects a compound element on a cartesian canvas', () => {
    expect(
      parseFigureSpec({
        v: 1,
        coords: 'cartesian',
        elements: [{ kind: 'chart', variant: 'bar', x: 0, y: 0, w: 100, h: 100, series: [{ values: [1] }] }],
      }),
    ).toBeNull();
  });

  it('collects text from every compound element for the answer filter', () => {
    const parsed = spec({
      kind: 'graph',
      nodes: [
        { id: 'a', text: '第一個節點' },
        { id: 'b', text: '第二個節點' },
      ],
      edges: [{ from: 'a', to: 'b', label: '連線' }],
    });
    expect(parsed).not.toBeNull();
    const texts = parsed!.elements.flatMap((element: FigureElement) => figureElementTexts(element));
    expect(texts).toContain('第一個節點');
    expect(texts).toContain('連線');
  });
});

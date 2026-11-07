import { describe, expect, it } from 'vitest';
import { parseFigureSpec, type Question } from '@mengyin/core';
import { assertDiagram, assertPhoto } from './figure-assert';
import { figureKind } from './figure-registry';

function question(prompt = 'Which chart is shown?'): Question {
  return {
    id: 'q1',
    type: 'single',
    prompt,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: { kind: 'single', optionId: 'a' },
    tags: ['test'],
    difficulty: 2,
  };
}

function spec(elements: unknown[], coords: 'plain' | 'cartesian' = 'plain') {
  return parseFigureSpec({ v: 1, coords, elements });
}

describe('figure assertions', () => {
  it('accepts a table as a complete structure', () => {
    const table = spec([
      {
        kind: 'table',
        x: 10,
        y: 10,
        w: 80,
        h: 40,
        columns: ['P', 'Q'],
        rows: [['T', 'T']],
      },
    ]);
    expect(table).not.toBeNull();
    const result = assertDiagram(table!, question(), figureKind('table.grid') ?? null);
    expect(result.ok).toBe(true);
  });

  it('rejects a chart with no data marks', () => {
    const chart = spec([
      { kind: 'label', x: 50, y: 10, text: 'Sales' },
      { kind: 'label', x: 50, y: 20, text: '2024' },
    ]);
    expect(chart).not.toBeNull();
    const result = assertDiagram(chart!, question(), figureKind('chart.bar') ?? null);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toContain('data marks');
  });

  it('rejects a flow with nodes but no arrows', () => {
    const flow = spec([
      { kind: 'shape', shape: 'rect', x: 10, y: 10, w: 30, h: 10, text: '開始' },
      { kind: 'shape', shape: 'rect', x: 50, y: 10, w: 30, h: 10, text: '結束' },
    ]);
    expect(flow).not.toBeNull();
    const result = assertDiagram(flow!, question(), figureKind('cs.flow') ?? null);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toContain('connections');
  });

  it('drops a table whose cell embeds the answer', () => {
    const withAnswer: Question = {
      ...question('Which curve?'),
      options: [
        { id: 'a', text: 'A parabola' },
        { id: 'b', text: 'A line' },
      ],
      answer: { kind: 'single', optionId: 'a' },
    };
    const table = spec([
      {
        kind: 'table',
        x: 10,
        y: 10,
        w: 80,
        h: 40,
        columns: ['Answer'],
        rows: [['A parabola (the correct one)']],
      },
    ]);
    expect(table).not.toBeNull();
    const result = assertDiagram(table!, withAnswer, figureKind('table.grid') ?? null);
    expect(result).toMatchObject({ ok: false });
    expect(result.reason).toContain('answer');
  });

  it('rejects an empty photo brief', () => {
    const result = assertPhoto(
      { kind: 'photo', prompt: '   ' },
      figureKind('scene.landmark') ?? null,
    );
    expect(result).toMatchObject({ ok: false });
  });
});

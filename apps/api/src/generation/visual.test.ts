import { describe, expect, it } from 'vitest';
import type { FigureSpec, Question } from '@mengyin/core';
import {
  fallbackPhoto,
  fallbackScene,
  figureIsInformative,
  figureRevealsAnswerShape,
  questionIsVisualClue,
  questionReferencesVisual,
  readVisual,
  sanitizeAlt,
  sanitizeFigure,
  visualInstruction,
  visualWorthiness,
} from './visual';

const spec = {
  v: 1,
  coords: 'cartesian',
  x: { min: -2, max: 2 },
  y: { min: -2, max: 2 },
  elements: [{ kind: 'plot', expr: 'x^2' }, { kind: 'point', x: 0, y: 0, label: 'O' }],
};

function question(id = 'q1'): Question {
  return {
    id,
    type: 'single',
    prompt: 'Which curve is shown?',
    options: [
      { id: 'a', text: 'A line' },
      { id: 'b', text: 'A parabola' },
    ],
    answer: { kind: 'single', optionId: 'b' },
    tags: ['math'],
    difficulty: 2,
  };
}

describe('readVisual', () => {
  it('reads a diagram spec and keeps its alt text', () => {
    const plan = readVisual({ visual: { kind: 'diagram', spec, alt: '  a parabola ' } });
    expect(plan?.kind).toBe('diagram');
    if (plan?.kind !== 'diagram') throw new Error('expected a diagram');
    expect(plan.figure.coords).toBe('cartesian');
    expect(plan.figure.elements).toHaveLength(2);
    expect(plan.alt).toBe('a parabola');
  });

  it('reads a photo brief', () => {
    expect(
      readVisual({ visual: { kind: 'photo', prompt: '  Two pots, one in shadow. ', alt: '盆栽' } }),
    ).toEqual({ kind: 'photo', prompt: 'Two pots, one in shadow.', alt: '盆栽' });
  });

  it('reads an internal search query for a real reference photo', () => {
    expect(
      readVisual({
        visual: {
          kind: 'photo',
          prompt: 'A landmark beside a river.',
          search: '  Eiffel Tower Paris ',
          alt: 'A landmark',
        },
      }),
    ).toEqual({
      kind: 'photo',
      prompt: 'A landmark beside a river.',
      search: 'Eiffel Tower Paris',
      alt: 'A landmark',
    });
  });

  it('reads an explicit none', () => {
    expect(readVisual({ visual: { kind: 'none' } })).toEqual({ kind: 'none' });
    expect(readVisual({ visual: { skip: true } })).toEqual({ kind: 'none' });
    expect(readVisual({ visual: 'none' })).toEqual({ kind: 'none' });
  });

  it('falls back to a photo when a diagram is unusable but a prompt exists', () => {
    expect(
      readVisual({
        visual: { kind: 'diagram', spec: { v: 1, elements: [{ kind: 'plot', expr: 'syntax error(' }] }, prompt: 'A sketch.' },
      }),
    ).toEqual({ kind: 'photo', prompt: 'A sketch.' });
  });

  it('ignores unknown shapes instead of inventing a picture', () => {
    expect(readVisual({ visual: { kind: 'hologram' } })).toBeNull();
    expect(readVisual({ visual: 42 })).toBeNull();
    expect(readVisual({})).toBeNull();
    expect(readVisual(null)).toBeNull();
  });

  it('accepts the 1.x image field as a photo hint', () => {
    expect(readVisual({ image: { prompt: 'A leaf.', alt: '葉' } })).toEqual({
      kind: 'photo',
      prompt: 'A leaf.',
      alt: '葉',
    });
  });

  it('infers the kind when the model omits it', () => {
    expect(readVisual({ visual: { spec } })?.kind).toBe('diagram');
    expect(readVisual({ visual: { prompt: 'A river.' } })?.kind).toBe('photo');
  });
});

describe('visualInstruction', () => {
  it('states whether images are off, optional or required', () => {
    expect(visualInstruction('off', true)).toContain('disabled');
    expect(visualInstruction('auto', true)).toContain('optional');
    expect(visualInstruction('on', true)).toContain('required');
  });

  it('tells the model that photos are unavailable', () => {
    expect(visualInstruction('auto', false)).toContain('Photo generation is unavailable');
    expect(visualInstruction('on', false)).toContain('use "diagram" for every visual');
  });
});

describe('fallbackPhoto', () => {
  it('produces a bounded, answer-free brief', () => {
    const plan = fallbackPhoto(question());
    if (plan.kind !== 'photo') throw new Error('expected a photo');
    expect(plan.prompt.length).toBeLessThanOrEqual(600);
    expect(plan.prompt).toContain('Which curve is shown?');
    expect(plan.prompt).not.toContain('parabola');
    expect(plan.alt).toBe('Which curve is shown?');
  });
});

describe('fallbackScene', () => {
  const country: Question = {
    ...question(),
    prompt: '這是哪個國家？',
    options: [
      { id: 'a', text: '法國' },
      { id: 'b', text: '西班牙' },
    ],
    answer: { kind: 'single', optionId: 'a' },
  };

  it('uses the answer as an internal search query but not in the alt text', () => {
    const plan = fallbackScene(country);
    if (plan.kind !== 'photo') throw new Error('expected a photo');
    expect(plan.search).toContain('法國');
    expect(plan.prompt).toContain('法國');
    expect(plan.alt).not.toContain('法國');
  });

  it('detects a scene clue without treating every country fact as one', () => {
    expect(questionIsVisualClue(country)).toBe(true);
    expect(questionIsVisualClue(question())).toBe(true);
    expect(
      questionIsVisualClue({ ...question(), prompt: 'Which country has the largest population?' }),
    ).toBe(false);
  });

  it('keeps the answer out of the photo alt text', () => {
    expect(sanitizeAlt('艾菲爾鐵塔在法國', country)).not.toContain('法國');
    expect(sanitizeAlt('A tower beside a river', country)).toBe('A tower beside a river');
  });
});

describe('sanitizeFigure', () => {
  const withLabel = (text: string) => ({
    v: 1 as const,
    width: 420,
    height: 280,
    coords: 'cartesian' as const,
    x: { min: -2, max: 2 },
    y: { min: -2, max: 2 },
    grid: false,
    elements: [
      { kind: 'plot' as const, expr: 'x^2' },
      { kind: 'label' as const, x: 0, y: 1, text },
    ],
  });

  it('removes a label that repeats the correct option text', () => {
    const cleaned = sanitizeFigure(withLabel('A parabola'), question());
    expect(cleaned).not.toBeNull();
    expect(cleaned?.elements.some((element) => element.kind === 'label')).toBe(false);
    expect(cleaned?.elements).toHaveLength(1);
  });

  it('matches punctuation and spacing variants', () => {
    const q: Question = {
      ...question(),
      prompt: 'What is the vertex?',
      options: [
        { id: 'a', text: '(h, k)' },
        { id: 'b', text: '(k, h)' },
      ],
      answer: { kind: 'single', optionId: 'a' },
    };
    const cleaned = sanitizeFigure(withLabel('(h,k)'), q);
    expect(cleaned?.elements.some((element) => element.kind === 'label')).toBe(false);
  });

  it('strips a point label that reveals a fill answer', () => {
    const q: Question = {
      ...question(),
      type: 'fill',
      prompt: 'The answer is ______.',
      options: undefined,
      answer: { kind: 'fill', accept: ['4'] },
    };
    const cleaned = sanitizeFigure(
      {
        v: 1,
        width: 420,
        height: 280,
        coords: 'cartesian',
        x: { min: -2, max: 2 },
        y: { min: -2, max: 2 },
        grid: false,
        elements: [
          { kind: 'point', x: 1, y: 2, label: '4' },
          { kind: 'plot', expr: 'x^2' },
        ],
      },
      q,
    );
    const point = cleaned?.elements[0];
    expect(point?.kind).toBe('point');
    if (point?.kind === 'point') expect(point.label).toBeUndefined();
  });

  it('drops a figure whose only content was the answer', () => {
    const onlyAnswer = {
      ...withLabel('A parabola'),
      elements: [{ kind: 'label' as const, x: 0, y: 1, text: 'A parabola' }],
    };
    expect(sanitizeFigure(onlyAnswer, question())).toBeNull();
  });

  it('drops a whole compound element when one label leaks the answer', () => {
    const cleaned = sanitizeFigure(
      {
        v: 1,
        width: 480,
        height: 320,
        coords: 'plain',
        x: { min: 0, max: 100 },
        y: { min: 0, max: 100 },
        grid: false,
        elements: [
          {
            kind: 'chart',
            variant: 'bar',
            x: 8,
            y: 10,
            w: 84,
            h: 72,
            categories: ['A parabola', 'Spain'],
            series: [{ values: [3, 5] }],
          },
        ],
      },
      question(),
    );
    expect(cleaned).toBeNull();
  });

  it('reads a Mermaid flowchart and compiles it to a figure', () => {
    const plan = readVisual({
      visual: {
        kind: 'diagram',
        mermaid: 'flowchart TD\n  A([開始]) --> B[處理]\n  B --> C([結束])',
        alt: '開始、處理、結束',
      },
    });
    expect(plan?.kind).toBe('diagram');
    if (plan?.kind !== 'diagram') throw new Error('expected a diagram');
    expect(plan.figure.coords).toBe('plain');
    expect(plan.figure.elements.filter((element) => element.kind === 'shape')).toHaveLength(3);
    expect(plan.figure.elements.some((element) => element.kind === 'line' && element.arrow)).toBe(true);
  });

  it('drops a pie whose slice label repeats the answer', () => {
    const cleaned = sanitizeFigure(
      plainFlow([
        {
          kind: 'pie',
          x: 50,
          y: 50,
          r: 30,
          slices: [
            { value: 40, label: 'A parabola' },
            { value: 60, label: 'B' },
          ],
        },
      ]),
      question(),
    );
    expect(cleaned).toBeNull();
  });

  it('drops a table that repeats the answer in a cell', () => {
    const cleaned = sanitizeFigure(
      plainFlow([
        {
          kind: 'table',
          x: 10,
          y: 10,
          w: 80,
          h: 40,
          columns: ['Answer', 'Value'],
          rows: [['A parabola', '2']],
        },
      ]),
      question(),
    );
    expect(cleaned).toBeNull();
  });

  it('strips answer text from a flowchart node', () => {
    const cleaned = sanitizeFigure(
      {
        v: 1,
        width: 420,
        height: 280,
        coords: 'plain',
        x: { min: 0, max: 100 },
        y: { min: 0, max: 100 },
        grid: false,
        elements: [
          { kind: 'shape', shape: 'rect', x: 10, y: 10, w: 30, h: 10, text: 'A parabola' },
          { kind: 'shape', shape: 'diamond', x: 10, y: 30, w: 30, h: 12, text: '判斷' },
        ],
      },
      question(),
    );
    const nodes = cleaned?.elements.filter((element) => element.kind === 'shape') ?? [];
    expect(nodes).toHaveLength(2);
    const texts = cleaned?.elements.flatMap((element) => (element.kind === 'shape' ? [element.text] : [])) ?? [];
    expect(texts).toEqual([undefined, '判斷']);
  });
});

function symbolFill(): Question {
  return {
    id: 'q4',
    type: 'fill',
    prompt: '在流程圖中，______形狀用來表示一個過程或行動。',
    answer: { kind: 'fill', accept: ['矩形'], ignoreCase: true },
    tags: ['flowchart'],
    difficulty: 1,
  };
}

function symbolChoice(): Question {
  return {
    id: 'q5',
    type: 'single',
    prompt: '哪個符號代表流程圖中的一個過程或動作？',
    options: [
      { id: 'a', text: '圓角矩形' },
      { id: 'b', text: '矩形' },
      { id: 'c', text: '菱形' },
      { id: 'd', text: '平行四邊形' },
    ],
    answer: { kind: 'single', optionId: 'b' },
    tags: ['flowchart'],
    difficulty: 1,
  };
}

const plainFlow = (elements: FigureSpec['elements']): FigureSpec => ({
  v: 1,
  width: 480,
  height: 320,
  coords: 'plain',
  x: { min: 0, max: 100 },
  y: { min: 0, max: 100 },
  grid: false,
  elements,
});

describe('visualWorthiness', () => {
  it('rejects questions that only ask the learner to name a flowchart shape', () => {
    expect(visualWorthiness(symbolFill())).toEqual({ worth: false, reason: 'symbol-definition' });
    expect(visualWorthiness(symbolChoice())).toEqual({ worth: false, reason: 'symbol-definition' });
  });

  it('keeps a question that refers to its figure', () => {
    expect(questionReferencesVisual(symbolChoice())).toBe(false);
    const shown: Question = {
      ...symbolChoice(),
      prompt: '圖中哪個形狀是流程圖的判斷節點？',
    };
    expect(questionReferencesVisual(shown)).toBe(true);
    expect(visualWorthiness(shown).worth).toBe(true);
  });

  it('does not treat the word 流程圖中 as a reference to a displayed figure', () => {
    expect(questionReferencesVisual(symbolChoice())).toBe(false);
  });

  it('keeps ordinary scene questions for the planner', () => {
    expect(visualWorthiness(question()).worth).toBe(true);
    expect(visualWorthiness({ ...question(), type: 'code' })).toEqual({ worth: false, reason: 'code' });
  });
});

describe('figure gate', () => {
  const oneSymbol = plainFlow([
    { kind: 'shape', shape: 'rect', x: 30, y: 40, w: 40, h: 16, text: '流程' },
  ]);

  const processFlow = plainFlow([
    { kind: 'shape', shape: 'rounded', x: 35, y: 8, w: 30, h: 12, text: '開始' },
    { kind: 'shape', shape: 'rect', x: 35, y: 40, w: 30, h: 12, text: '處理' },
    { kind: 'line', x1: 50, y1: 20, x2: 50, y2: 40, arrow: true },
  ]);

  it('drops a single-symbol figure as decoration', () => {
    expect(figureIsInformative(oneSymbol, symbolFill())).toBe(false);
  });

  it('keeps a connected flow and a figure the question refers to', () => {
    expect(figureIsInformative(processFlow, symbolFill())).toBe(true);
    expect(
      figureIsInformative(oneSymbol, { ...symbolFill(), prompt: '圖中這個形狀代表什麼？' }),
    ).toBe(true);
  });

  it('drops a diagram whose shape is the answer', () => {
    expect(figureRevealsAnswerShape(processFlow, symbolChoice())).toBe(true);
    expect(
      figureRevealsAnswerShape(processFlow, { ...symbolChoice(), prompt: '圖中哪個形狀是過程？' }),
    ).toBe(false);
  });

  it('keeps cartesian diagrams', () => {
    expect(figureIsInformative({ ...plainFlow([]), coords: 'cartesian', elements: [{ kind: 'plot', expr: 'x^2' }] }, question())).toBe(
      true,
    );
  });
});

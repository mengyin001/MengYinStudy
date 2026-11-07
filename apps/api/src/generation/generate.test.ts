import { describe, expect, it } from 'vitest';
import type { Question } from '@mengyin/core';
import type { ChatModel } from '../providers/chat';
import { AiError } from '../providers/chat';
import type { GenerationRequest } from './types';
import { buildBatchMessages, dedupeQuestions, generateQuestions } from './generate';

function question(id: string, prompt: string): Question {
  return {
    id,
    type: 'single',
    prompt,
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
    answer: { kind: 'single', optionId: 'a' },
    tags: ['t'],
    difficulty: 2,
  };
}

const diagramSpec = {
  v: 1,
  coords: 'cartesian',
  x: { min: -2, max: 2 },
  y: { min: -2, max: 4 },
  elements: [
    { kind: 'plot', expr: 'x^2' },
    { kind: 'point', x: 0, y: 0, label: 'O' },
  ],
};

describe('dedupeQuestions', () => {
  it('drops exact duplicates but keeps materially different prompts', () => {
    const result = dedupeQuestions([
      question('q1', 'What is a stack?'),
      question('q2', 'What is a stack?'),
      question('q3', 'Which data structure is last in, first out?'),
      question('q4', 'Which data structure is first in, first out?'),
    ]);
    expect(result.removed).toBe(1);
    expect(result.kept.map((item) => item.id)).toEqual(['q1', 'q3', 'q4']);
  });

  it('keeps Chinese questions that share a formulaic stem', () => {
    const prompts = [
      '下列關於細胞呼吸的敘述，何者正確？',
      '下列關於光合作用的敘述，何者正確？',
      '下列關於DNA複製的敘述，何者正確？',
      '下列關於蛋白質合成的敘述，何者正確？',
      '下列關於細胞分裂的敘述，何者正確？',
    ];
    const result = dedupeQuestions(prompts.map((prompt, index) => question(`q${index + 1}`, prompt)));
    expect(result.removed).toBe(0);
    expect(result.kept).toHaveLength(5);
  });
});

describe('batch prompt', () => {
  const base = {
    topic: 'Stacks',
    count: 2,
    difficulty: 'mixed' as const,
    language: 'en' as const,
    types: ['single'] as const,
    chunks: [{ id: 'c1', materialId: 'm1', materialName: 'notes', index: 0, text: 'A stack is LIFO.' }],
    batch: 0,
    batches: 1,
    sourceMode: 'material' as const,
  };

  it('enables visuals when asked', () => {
    const messages = buildBatchMessages({ ...base, visualMode: 'auto' });
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('Visuals: optional');
    expect(user).toContain('<material name="notes"');
  });

  it('requires a visual in on mode', () => {
    const messages = buildBatchMessages({ ...base, visualMode: 'on' });
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('Visuals: required');
  });

  it('disables visuals when asked', () => {
    const messages = buildBatchMessages({ ...base, visualMode: 'off' });
    const user = messages.find((message) => message.role === 'user')?.content ?? '';
    expect(user).toContain('Visuals: disabled');
  });
});

function rawSingle(prompt: string): Record<string, unknown> {
  return {
    type: 'single',
    prompt,
    options: [{ text: 'A' }, { text: 'B' }],
    answer: { kind: 'single', optionId: 'a' },
    explanation: 'Because A is correct.',
    estimatedSeconds: 20,
  };
}

function testModel(complete: ChatModel['complete']): ChatModel {
  return { provider: 'glm', providerLabel: 'GLM', model: 'test', complete };
}

const request: GenerationRequest = {
  topic: 'Stacks',
  count: 8,
  difficulty: 'mixed',
  language: 'en',
  types: ['single'],
  imageMode: 'off',
};

describe('partial generation', () => {
  it('keeps earlier batches when a later batch fails', async () => {
    let calls = 0;
    const model = testModel(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: JSON.stringify({
            questions: [rawSingle('What is a stack?'), rawSingle('What is LIFO?'), rawSingle('What is a push?'), rawSingle('What is a pop?')],
          }),
          finishReason: 'stop',
        };
      }
      throw new AiError('rate', 'The provider is busy');
    });

    const result = await generateQuestions(model, { ...request, count: 8 }, []);
    expect(result.deck.questions).toHaveLength(4);
    expect(result.deck.description).toMatch(/^Generated from /);
    expect(result.warnings.some((warning) => warning.code === 'partial')).toBe(true);
  });

  it('tops up a short batch so the requested count is reached', async () => {
    let calls = 0;
    const model = testModel(async (messages) => {
      calls += 1;
      const prompt = messages.map((message) => message.content).join('\n');
      if (calls === 1) {
        return {
          text: JSON.stringify({ questions: [rawSingle('What is a stack?')] }),
          finishReason: 'stop',
        };
      }
      expect(prompt).toContain('Write exactly 3 questions');
      return {
        text: JSON.stringify({
          questions: [rawSingle('What is a queue?'), rawSingle('What is a tree?'), rawSingle('What is a graph?')],
        }),
        finishReason: 'stop',
      };
    });

    const result = await generateQuestions(model, { ...request, count: 4 }, []);
    expect(result.deck.questions).toHaveLength(4);
    expect(result.deck.questions.map((item) => item.prompt)).toEqual([
      'What is a stack?',
      'What is a queue?',
      'What is a tree?',
      'What is a graph?',
    ]);
    expect(calls).toBe(2);
  });

  it('keeps complete questions from a truncated reply and asks only for the missing ones', async () => {
    let calls = 0;
    const prompts: string[] = [];
    const model = testModel(async (messages) => {
      calls += 1;
      const prompt = messages.map((message) => message.content).join('\n');
      prompts.push(prompt);
      if (calls === 1) {
        return {
          text:
            '{"questions":[' +
            JSON.stringify(rawSingle('What is a stack?')) +
            ',' +
            JSON.stringify(rawSingle('What is LIFO?')) +
            ',{"type":"single","prompt":"unfinished',
          finishReason: 'length',
        };
      }
      expect(prompt).toContain('Write exactly 2 questions');
      expect(prompt).toContain('What is a stack?');
      expect(prompt).toContain('Do not repeat');
      return {
        text: JSON.stringify({
          questions: [rawSingle('What is a queue?'), rawSingle('What is a tree?')],
        }),
        finishReason: 'stop',
      };
    });

    const result = await generateQuestions(model, { ...request, count: 4 }, []);
    expect(result.deck.questions).toHaveLength(4);
    expect(calls).toBe(2);
  });

  it('does not ask again when a truncated reply already contains every question', async () => {
    let calls = 0;
    const model = testModel(async () => {
      calls += 1;
      return {
        text:
          '{"questions":[' +
          JSON.stringify(rawSingle('What is a stack?')) +
          ',' +
          JSON.stringify(rawSingle('What is LIFO?')),
        finishReason: 'length',
      };
    });

    const result = await generateQuestions(model, { ...request, count: 2 }, []);
    expect(result.deck.questions).toHaveLength(2);
    expect(calls).toBe(1);
  });

  it('keeps complete questions from malformed JSON and asks only for the missing ones', async () => {
    let calls = 0;
    const model = testModel(async (messages) => {
      calls += 1;
      const prompt = messages.map((message) => message.content).join('\n');
      if (calls === 1) {
        return {
          text:
            '{"questions":[' +
            JSON.stringify(rawSingle('What is a stack?')) +
            ',' +
            JSON.stringify(rawSingle('What is LIFO?')) +
            '],"warnings":[}',
          finishReason: 'stop',
        };
      }
      expect(prompt).toContain('Write exactly 2 questions');
      expect(prompt).toContain('Do not repeat');
      return {
        text: JSON.stringify({
          questions: [rawSingle('What is a queue?'), rawSingle('What is a tree?')],
        }),
        finishReason: 'stop',
      };
    });

    const result = await generateQuestions(model, { ...request, count: 4 }, []);
    expect(result.deck.questions).toHaveLength(4);
    expect(calls).toBe(2);
  });

  it('splits a malformed batch that has no complete question', async () => {
    let calls = 0;
    const model = testModel(async () => {
      calls += 1;
      if (calls <= 2) return { text: 'not json', finishReason: 'stop' };
      return {
        text: JSON.stringify({ questions: [rawSingle(`What is question ${calls}?`)] }),
        finishReason: 'stop',
      };
    });

    const result = await generateQuestions(model, { ...request, count: 2 }, []);
    expect(result.deck.questions).toHaveLength(2);
    expect(calls).toBe(4);
  });

  it('keeps the successful half when a split sub-batch fails', async () => {
    let calls = 0;
    const model = testModel(async () => {
      calls += 1;
      if (calls === 1) return { text: '{"questions":[]}', finishReason: 'length' };
      if (calls === 2) {
        return {
          text: JSON.stringify({ questions: [rawSingle('What is a stack?')] }),
          finishReason: 'stop',
        };
      }
      throw new AiError('rate', 'The provider is busy');
    });

    const result = await generateQuestions(model, { ...request, count: 2 }, []);
    expect(result.deck.questions).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.code === 'partial')).toBe(true);
    expect(calls).toBe(3);
  });
});

describe('visual routing', () => {
  const withPhoto = (prompt: string): Record<string, unknown> => ({
    ...rawSingle(prompt),
    visual: { kind: 'photo', prompt: 'a generic drawing of the topic', alt: '圖' },
  });
  const withDiagram = (prompt: string): Record<string, unknown> => ({
    ...rawSingle(prompt),
    visual: { kind: 'diagram', spec: diagramSpec, alt: '拋物線' },
  });

  function questionOrPlan(onPlan: () => string, onQuestions: () => string): ChatModel['complete'] {
    return async (messages) => {
      const text = messages.map((message) => message.content).join('\n');
      return { text: text.includes('<questions>') ? onPlan() : onQuestions(), finishReason: 'stop' };
    };
  }

  it('rewrites an author photo hint from the finished question', async () => {
    const model = testModel(
      questionOrPlan(
        () =>
          JSON.stringify({
            images: [{ id: 'q1', kind: 'photo', prompt: 'One lamp shining on a closed book beside an open book.' }],
          }),
        () => JSON.stringify({ questions: [withPhoto('Which book is closed?')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'on' }, []);
    expect(result.deck.questions[0]?.prompt).toBe('Which book is closed?');
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.prompt).toBe(
      'One lamp shining on a closed book beside an open book.',
    );
  });

  it('drops an author photo when the planner says no picture helps', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', skip: true }] }),
        () => JSON.stringify({ questions: [withPhoto('Define osmosis.')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, []);
    expect(result.imageRequests).toEqual([]);
  });

  it('falls back to the author hint when planning fails', async () => {
    const model = testModel(
      questionOrPlan(
        () => {
          throw new AiError('rate', 'The provider is busy');
        },
        () => JSON.stringify({ questions: [withPhoto('Which book is closed?')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, []);
    expect(result.imageRequests[0]?.prompt).toBe('a generic drawing of the topic');
    expect(result.warnings.some((warning) => warning.code === 'images')).toBe(true);
  });

  it('attaches an author diagram without any planning call', async () => {
    let planned = false;
    const model = testModel(async (messages) => {
      const text = messages.map((message) => message.content).join('\n');
      if (text.includes('<questions>')) planned = true;
      return { text: JSON.stringify({ questions: [withDiagram('Which curve is shown?')] }), finishReason: 'stop' };
    });

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, [], {
      imagesAvailable: false,
    });
    expect(planned).toBe(false);
    expect(result.imageRequests).toEqual([]);
    expect(result.diagramCount).toBe(1);
    const media = result.deck.questions[0]?.media?.[0];
    expect(media?.type).toBe('figure');
    if (media?.type === 'figure') expect(media.figure.elements).toHaveLength(2);
    expect(media?.alt).toBe('拋物線');
  });

  it('asks the planner for a visual in on mode when the author omitted one', async () => {
    const model = testModel(
      questionOrPlan(
        () =>
          JSON.stringify({
            images: [{ id: 'q1', kind: 'diagram', spec: diagramSpec, alt: '拋物線' }],
          }),
        () => JSON.stringify({ questions: [rawSingle('Which curve is shown?')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'on' }, []);
    expect(result.diagramCount).toBe(1);
    expect(result.deck.questions[0]?.media?.[0]?.type).toBe('figure');
  });

  it('asks the planner to decide in auto mode when the author omitted a visual', async () => {
    const model = testModel(
      questionOrPlan(
        () =>
          JSON.stringify({
            images: [{ id: 'q1', kind: 'diagram', spec: diagramSpec, alt: '拋物線' }],
          }),
        () => JSON.stringify({ questions: [rawSingle('Which curve is shown?')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, []);
    expect(result.diagramCount).toBe(1);
    expect(result.deck.questions[0]?.media?.[0]?.type).toBe('figure');
  });

  it('explains when auto decided that no question needs a picture', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', skip: true }] }),
        () => JSON.stringify({ questions: [rawSingle('Define a stack.')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, []);
    expect(result.imageRequests).toEqual([]);
    expect(result.diagramCount).toBe(0);
    expect(
      result.warnings.some(
        (warning) => warning.code === 'images' && warning.message.includes('Auto mode judged'),
      ),
    ).toBe(true);
  });

  it('drops a one-symbol diagram for a flowchart-symbol definition', async () => {
    let planned = false;
    const raw = {
      type: 'fill',
      prompt: '在流程圖中，______形狀用來表示一個過程或行動。',
      answer: { kind: 'fill', accept: ['矩形'], ignoreCase: true },
      explanation: '矩形代表流程或行動。',
      estimatedSeconds: 20,
      visual: {
        kind: 'diagram',
        spec: {
          v: 1,
          coords: 'plain',
          width: 480,
          height: 320,
          elements: [{ kind: 'shape', shape: 'rect', x: 30, y: 40, w: 40, h: 16, text: '流程' }],
        },
        alt: '一個矩形',
      },
    };
    const model = testModel(async (messages) => {
      const text = messages.map((message) => message.content).join('\n');
      if (text.includes('<questions>')) planned = true;
      return { text: JSON.stringify({ questions: [raw] }), finishReason: 'stop' };
    });

    const result = await generateQuestions(
      model,
      { ...request, count: 1, types: ['fill'], imageMode: 'auto' },
      [],
    );
    expect(planned).toBe(false);
    expect(result.diagramCount).toBe(0);
    expect(result.deck.questions[0]?.media).toBeUndefined();
  });

  it('attaches a Mermaid process diagram and lays it out', async () => {
    const raw = {
      ...rawSingle('Which step comes after 開始 in the process?'),
      visual: {
        kind: 'diagram',
        mermaid: 'flowchart TD\n  A([開始]) --> B[處理]\n  B --> C([結束])',
        alt: '開始、處理、結束',
      },
    };
    const model = testModel(async () => ({
      text: JSON.stringify({ questions: [raw] }),
      finishReason: 'stop',
    }));

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'auto' },
      [],
      { imagesAvailable: false },
    );
    expect(result.diagramCount).toBe(1);
    const media = result.deck.questions[0]?.media?.[0];
    expect(media?.type).toBe('figure');
    if (media?.type === 'figure') {
      expect(media.figure.elements.filter((element) => element.kind === 'shape')).toHaveLength(3);
      expect(media.figure.elements.some((element) => element.kind === 'line' && element.arrow)).toBe(true);
    }
  });

  it('never attaches a visual to a code question', async () => {
    const code = {
      ...rawSingle('Fill in the blank'),
      type: 'code',
      options: undefined,
      answer: { kind: 'custom', value: {} },
      visual: { kind: 'diagram', spec: diagramSpec },
      meta: {
        code: {
          language: 'javascript',
          template: 'console.log({{blank}});',
          blankLabel: 'value',
          solution: '1 + 1',
          tests: [{ expect: '2' }],
        },
      },
    };
    const model = testModel(async () => ({
      text: JSON.stringify({ questions: [code] }),
      finishReason: 'stop',
    }));
    const result = await generateQuestions(
      model,
      { ...request, count: 1, types: ['code'], imageMode: 'on' },
      [],
    );
    expect(result.deck.questions[0]?.media).toBeUndefined();
    expect(result.diagramCount).toBe(0);
  });

  it('does not plan when visuals are off', async () => {
    let planned = false;
    const model = testModel(async (messages) => {
      const text = messages.map((message) => message.content).join('\n');
      if (text.includes('<questions>')) planned = true;
      return { text: JSON.stringify({ questions: [withPhoto('What is a stack?')] }), finishReason: 'stop' };
    });

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'off' }, []);
    expect(planned).toBe(false);
    expect(result.imageRequests).toEqual([]);
  });

  it('skips planning for the demo provider and keeps the author photo', async () => {
    const model: ChatModel = {
      ...testModel(async (messages) => {
        const text = messages.map((message) => message.content).join('\n');
        if (text.includes('<questions>')) throw new Error('demo must not plan visuals');
        return { text: JSON.stringify({ questions: [withPhoto('Demo question')] }), finishReason: 'stop' };
      }),
      provider: 'demo',
    };

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'on' }, []);
    expect(result.imageRequests).toHaveLength(1);
  });

  it('drops a chosen photo when the server has no image provider', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', kind: 'photo', prompt: 'A scene.' }] }),
        () => JSON.stringify({ questions: [rawSingle('Which scene is it?')] }),
      ),
    );

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'on' }, [], {
      imagesAvailable: false,
    });
    expect(result.imageRequests).toEqual([]);
    expect(result.warnings.some((warning) => warning.code === 'images')).toBe(true);
  });

  it('turns a diagram for a guess-the-country clue into a photo request', async () => {
    const raw = {
      ...rawSingle('這是哪個國家？'),
      options: [
        { id: 'a', text: '法國' },
        { id: 'b', text: '西班牙' },
      ],
      answer: { kind: 'single', optionId: 'a' },
      visual: { kind: 'diagram', spec: diagramSpec, alt: '一條曲線' },
    };
    const model = testModel(
      questionOrPlan(
        () =>
          JSON.stringify({
            images: [{ id: 'q1', kind: 'diagram', spec: diagramSpec, alt: '一條曲線' }],
          }),
        () => JSON.stringify({ questions: [raw] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'on', language: 'zh-Hant' },
      [],
      { imagesAvailable: true, webImagesAvailable: true },
    );
    expect(result.diagramCount).toBe(0);
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.search).toContain('法國');
    expect(result.deck.questions[0]?.media).toBeUndefined();
  });

  it('does not let the planner skip a scene clue', async () => {
    const raw = {
      ...rawSingle('Guess the country shown in this photo.'),
      options: [
        { id: 'a', text: 'France' },
        { id: 'b', text: 'Spain' },
      ],
      answer: { kind: 'single', optionId: 'a' },
    };
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', skip: true }] }),
        () => JSON.stringify({ questions: [raw] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'auto' },
      [],
      { imagesAvailable: true, webImagesAvailable: true },
    );
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.search).toContain('France');
  });

  it('does not force a photo for a cell definition in auto mode', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', skip: true }] }),
        () => JSON.stringify({ questions: [rawSingle('What is a cell?')] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'auto' },
      [],
      { imagesAvailable: true, webImagesAvailable: true },
    );
    expect(result.imageRequests).toEqual([]);
  });

  it('honours on mode for a vocabulary question with no exact figure', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', skip: true }] }),
        () => JSON.stringify({ questions: [rawSingle('Which word means conserve?')] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'on' },
      [],
      { imagesAvailable: true, webImagesAvailable: false },
    );
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.prompt).toContain('Which word means conserve?');
  });

  it('keeps a real scene photo when only web image search is available', async () => {
    const raw = {
      ...rawSingle('Guess the country shown in this photo.'),
      visual: {
        kind: 'photo',
        prompt: 'A landmark beside a river.',
        search: 'France landmark',
        alt: 'A photo',
      },
    };
    const model = testModel(async () => ({
      text: JSON.stringify({ questions: [raw] }),
      finishReason: 'stop',
    }));

    const result = await generateQuestions(model, { ...request, count: 1, imageMode: 'auto' }, [], {
      imagesAvailable: false,
      webImagesAvailable: true,
    });
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.search).toBe('France landmark');
  });

  it('does not web-search an ordinary scene illustration', async () => {
    const model = testModel(
      questionOrPlan(
        () =>
          JSON.stringify({
            images: [
              {
                id: 'q1',
                kind: 'photo',
                prompt: 'A busy market with fruit stalls.',
                search: 'busy market',
              },
            ],
          }),
        () => JSON.stringify({ questions: [rawSingle('Add a scene illustration of a busy market.')] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'on' },
      [],
      { imagesAvailable: true, webImagesAvailable: true },
    );
    expect(result.imageRequests).toHaveLength(1);
    expect(result.imageRequests[0]?.search).toBeUndefined();
    expect(result.imageRequests[0]?.searchOnly).toBeUndefined();
    expect(result.imageRequests[0]?.prompt).toContain('busy market');
  });

  it('drops a photo chosen for an exact figure', async () => {
    const model = testModel(
      questionOrPlan(
        () => JSON.stringify({ images: [{ id: 'q1', kind: 'photo', prompt: 'A bar chart.' }] }),
        () => JSON.stringify({ questions: [rawSingle('Draw a bar chart of the results.')] }),
      ),
    );

    const result = await generateQuestions(
      model,
      { ...request, count: 1, imageMode: 'on' },
      [],
      { imagesAvailable: true },
    );
    expect(result.imageRequests).toEqual([]);
    expect(
      result.warnings.some(
        (warning) => warning.code === 'images' && warning.message.includes('exact figure'),
      ),
    ).toBe(true);
  });
});

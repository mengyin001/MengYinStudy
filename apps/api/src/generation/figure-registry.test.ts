import { describe, expect, it } from 'vitest';
import type { Question } from '@mengyin/core';
import {
  FIGURE_REGISTRY,
  classifyFigure,
  figureKind,
  figureRenderer,
  figureRendering,
  routeFigure,
} from './figure-registry';

function question(prompt: string): Question {
  return {
    id: 'q1',
    type: 'single',
    prompt,
    options: [
      { id: 'a', text: 'France' },
      { id: 'b', text: 'Spain' },
    ],
    answer: { kind: 'single', optionId: 'a' },
    tags: ['test'],
    difficulty: 2,
  };
}

const all = { textToImage: true, webImage: true };
const noWeb = { textToImage: true, webImage: false };
const none = { textToImage: false, webImage: false };

describe('figure registry', () => {
  it('has a unique id and a non-empty pattern list for every kind', () => {
    const ids = FIGURE_REGISTRY.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FIGURE_REGISTRY) {
      expect(entry.patterns.length).toBeGreaterThan(0);
      expect(entry.sources.length).toBeGreaterThan(0);
    }
    expect(figureKind('scene.landmark')).toBeDefined();
    expect(figureKind('not-a-kind')).toBeUndefined();
  });

  it('treats guess-the-country as a scene, not a maths figure', () => {
    const route = routeFigure(question('這是哪個國家？'), all);
    expect(route.kind?.id).toBe('scene.landmark');
    expect(route.kind?.tier).toBe('scene');
    expect(route.source).toBe('web-image');
    expect(route.required).toBe(true);
  });

  it('tries web search, then the image model, and never a diagram for a scene', () => {
    expect(routeFigure(question('Guess the country shown in this photo.'), noWeb).source).toBe(
      'text-to-image',
    );
    expect(routeFigure(question('Guess the country shown in this photo.'), none).source).toBe('none');
    expect(routeFigure(question('Guess the country shown in this photo.'), all).source).toBe('web-image');
  });

  it('draws a non-clue scene instead of searching for a generic photo', () => {
    const route = routeFigure(question('Add a scene illustration of a busy market.'), all);
    expect(route.kind?.tier).toBe('scene');
    expect(route.required).toBe(false);
    expect(route.source).toBe('text-to-image');
  });

  it('routes exact figures to the app renderer', () => {
    expect(routeFigure(question('Draw a bar chart of the results.'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'chart.bar' },
    });
    expect(routeFigure(question('Sketch the free-body diagram.'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'physics.free-body' },
    });
  });

  it('never sends an exact or structural figure to text-to-image', () => {
    for (const prompt of [
      'Draw a bar chart of the results.',
      'Sketch the free-body diagram.',
      'Draw the circuit.',
      'Complete the truth table.',
    ]) {
      const route = routeFigure(question(prompt), all);
      expect(route.source).not.toBe('text-to-image');
      expect(route.source).not.toBe('web-image');
    }
  });

  it('routes a circuit, a map and a music staff to a dedicated renderer', () => {
    expect(routeFigure(question('Draw the circuit.'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'physics.circuit', renderer: 'circuit', support: 'native' },
    });
    expect(routeFigure(question('Show this on a map.'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'geo.map', renderer: 'map', support: 'approx' },
    });
    expect(routeFigure(question('Write the notes on a music staff.'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'human.music', renderer: 'music', support: 'native' },
    });
  });

  it('reports the support mix honestly', () => {
    const counts = { native: 0, approx: 0, external: 0, none: 0 };
    for (const entry of FIGURE_REGISTRY) counts[entry.support] += 1;
    expect(counts).toEqual({ native: 71, approx: 14, external: 9, none: 0 });
  });

  it('assigns every registered kind to exactly one renderer', () => {
    const seen = new Map<string, string>();
    for (const { renderer, kinds } of figureRendering()) {
      for (const id of kinds) {
        expect(seen.has(id), `${id} is in ${seen.get(id)} and ${renderer}`).toBe(false);
        seen.set(id, renderer);
        expect(figureRenderer(id)).toBe(renderer);
      }
    }
    expect(seen.size).toBe(FIGURE_REGISTRY.length);
    for (const entry of FIGURE_REGISTRY) {
      expect(seen.get(entry.id), `${entry.id} has no renderer`).toBeDefined();
      expect(figureRenderer(entry.id)).toBe(entry.renderer);
      if (entry.renderer !== 'scene') expect(entry.support).not.toBe('none');
    }
  });

  it('routes a truth table to the table renderer', () => {
    expect(routeFigure(question('Complete the truth table.'), all)).toMatchObject({
      source: 'table',
      kind: { id: 'table.grid' },
    });
  });

  it('classifies a shown curve as an exact function figure', () => {
    expect(routeFigure(question('Which curve is shown?'), all)).toMatchObject({
      source: 'figure',
      kind: { id: 'math.function' },
    });
  });

  it('does not turn a factual country question into a scene clue', () => {
    const route = routeFigure(question('Which country has the largest population?'), all);
    expect(route.kind?.tier).not.toBe('scene');
    expect(route.required).toBe(false);
  });

  it('classifies a process description as a Mermaid flowchart', () => {
    const route = routeFigure(question('Draw a flowchart of the algorithm.'), all);
    expect(route.kind?.id).toBe('cs.flow');
    expect(route.source).toBe('mermaid');
  });

  it('falls back to the classifier when the prompt is only a topic word', () => {
    expect(classifyFigure(question('bar chart'))?.kind.id).toBe('chart.bar');
  });
});

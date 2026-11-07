import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiQuestionResult } from '@mengyin/ai-contract';
import { clearDraft, loadDraft, saveDraft, stripIllustrations } from './draft';

class FakeStorage {
  readonly values = new Map<string, string>();
  limit = Number.POSITIVE_INFINITY;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (value.length > this.limit) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function result(withImage = false): AiQuestionResult {
  return {
    deck: {
      key: 'plugin::deck',
      id: 'deck',
      pluginId: 'plugin',
      title: 'Draft',
      description: 'Generated',
      tags: ['a'],
      questions: [
        {
          id: 'q1',
          type: 'single',
          prompt: 'What is a stack?',
          options: [
            { id: 'a', text: 'A' },
            { id: 'b', text: 'B' },
          ],
          answer: { kind: 'single', optionId: 'a' },
          tags: ['t'],
          difficulty: 2,
          ...(withImage
            ? {
                media: [
                  {
                    type: 'image' as const,
                    src: `data:image/png;base64,${'A'.repeat(2_000)}`,
                    alt: 'A stack',
                  },
                ],
              }
            : {}),
        },
      ],
      examMinutes: 5,
    },
    warnings: [],
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    engine: { provider: 'glm', providerLabel: 'GLM', model: 'test' },
    images: { requested: withImage ? 1 : 0, generated: withImage ? 1 : 0, failed: 0, diagrams: 0 },
  };
}

beforeEach(() => {
  clearDraft();
});

afterEach(() => {
  clearDraft();
  vi.unstubAllGlobals();
});

describe('generation draft storage', () => {
  it('round-trips the draft and clears it explicitly', () => {
    const store = new FakeStorage();
    vi.stubGlobal('window', { sessionStorage: store });
    expect(saveDraft(result())).toBe('saved');
    expect(loadDraft()?.deck.questions[0]?.prompt).toBe('What is a stack?');
    clearDraft();
    expect(loadDraft()).toBeNull();
  });

  it('keeps illustrations in the live draft when the tab fallback is too large', () => {
    const store = new FakeStorage();
    vi.stubGlobal('window', { sessionStorage: store });
    const full = result(true);
    const strippedPayload = JSON.stringify({
      version: 1,
      savedAt: 0,
      result: stripIllustrations(full),
    });
    store.limit = strippedPayload.length + 100;

    expect(saveDraft(full)).toBe('stripped');
    // The route-change cache keeps the picture; only the 5 MB tab fallback is slim.
    const loaded = loadDraft();
    expect(loaded?.deck.questions[0]?.media).toHaveLength(1);
  });

  it('ignores unreadable or malformed storage', () => {
    const store = new FakeStorage();
    vi.stubGlobal('window', { sessionStorage: store });
    store.setItem('mengyin-generate-draft:v1', '{not json');
    expect(loadDraft()).toBeNull();
    expect(store.getItem('mengyin-generate-draft:v1')).toBeNull();
  });

  it('reports unavailable when storage is blocked', () => {
    vi.stubGlobal('window', undefined);
    expect(saveDraft(result())).toBe('unavailable');
    expect(loadDraft()).toBeNull();
  });
});

describe('stripIllustrations', () => {
  it('keeps questions and records why the pictures were removed', () => {
    const stripped = stripIllustrations(result(true));
    expect(stripped.deck.questions[0]?.media).toBeUndefined();
    expect(stripped.images.generated).toBe(1);
    expect(stripped.warnings.map((warning) => warning.code)).toEqual(['storage']);
  });

  it('returns the same object when there is nothing to strip', () => {
    const original = result();
    expect(stripIllustrations(original)).toBe(original);
  });
});

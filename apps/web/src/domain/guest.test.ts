import { describe, expect, it } from 'vitest';
import { buildGuestPlugin, GUEST_PLUGIN_ID, isGuestDeckKey } from './guest';

describe('guest starter decks', () => {
  it('builds valid, stable bundled decks for visitors', () => {
    const plugin = buildGuestPlugin();
    expect(plugin.manifest.id).toBe(GUEST_PLUGIN_ID);
    expect(plugin.decks.length).toBeGreaterThanOrEqual(2);
    for (const deck of plugin.decks) {
      expect(deck.key.startsWith(`${GUEST_PLUGIN_ID}::`)).toBe(true);
      expect(deck.questions.length).toBeGreaterThan(0);
      expect(deck.examMinutes).toBeGreaterThan(0);
      expect(new Set(deck.questions.map((question) => question.id)).size).toBe(deck.questions.length);
    }
  });

  it('recognises guest keys without catching other decks', () => {
    expect(isGuestDeckKey(`${GUEST_PLUGIN_ID}::everyday`)).toBe(true);
    expect(isGuestDeckKey('official.pack::everyday')).toBe(false);
  });
});

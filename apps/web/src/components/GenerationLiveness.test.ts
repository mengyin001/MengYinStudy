import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Translate } from '@/i18n/messages';
import { GenerationLiveness } from './GenerationLiveness';

const t: Translate = (key, vars) => `${key}|${vars?.seconds ?? ''}`;

describe('GenerationLiveness', () => {
  it('shows a rotating message and the elapsed seconds', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationLiveness, { startedAt: Date.now() - 5_000, t }),
    );
    expect(html).toContain('gen.wait1');
    expect(html).toContain('gen.elapsed|5');
    expect(html).toContain('gen-status__pulse');
  });

  it('never shows a negative elapsed time', () => {
    const html = renderToStaticMarkup(
      createElement(GenerationLiveness, { startedAt: Date.now() + 60_000, t }),
    );
    expect(html).toContain('gen.elapsed|0');
  });
});

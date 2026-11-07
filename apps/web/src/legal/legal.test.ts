import { describe, expect, it } from 'vitest';
import { CONTACT_EMAIL, legalContext } from './config';
import { LEGAL_CHROME, LEGAL_DOCS } from './content';
import { pick, resolveDoc } from './render';
import { renderLegalHtml } from './staticHtml';
import type { DocLocale } from './render';

const LOCALES: DocLocale[] = ['zh-Hant', 'en'];
const configured = legalContext({ origin: 'https://study.example.com' });
const noMailbox = legalContext({ contactEmail: '' });

describe('legal documents', () => {
  for (const doc of Object.values(LEGAL_DOCS)) {
    it(`${doc.id}: resolves in both languages with no unresolved placeholders`, () => {
      for (const locale of LOCALES) {
        const resolved = resolveDoc(doc, locale, configured);
        const serialized = JSON.stringify(resolved);
        expect(serialized).not.toContain('{{');
        expect(resolved.title.length).toBeGreaterThan(0);
        expect(resolved.summary.length).toBeGreaterThan(40);
        expect(resolved.sections.length).toBeGreaterThanOrEqual(13);
        for (const section of resolved.sections) {
          expect(section.heading.trim().length).toBeGreaterThan(0);
          expect(section.blocks.length).toBeGreaterThan(0);
        }
      }
    });

    it(`${doc.id}: Chinese and English have the same section ids and count`, () => {
      const zh = resolveDoc(doc, 'zh-Hant', configured);
      const en = resolveDoc(doc, 'en', configured);
      expect(en.sections.map((section) => section.id)).toEqual(
        zh.sections.map((section) => section.id),
      );
      expect(en.sections.map((section) => section.blocks.length)).toEqual(
        zh.sections.map((section) => section.blocks.length),
      );
    });

    it(`${doc.id}: static page is self-contained, bilingual and canonical`, () => {
      const html = renderLegalHtml(doc, configured);
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).toContain('id="zh"');
      expect(html).toContain('id="en"');
      // One inline script mirrors the app's explicit light/dark choice. It
      // loads nothing and the document remains complete without it.
      expect((html.match(/<script/g) ?? []).length).toBe(1);
      expect(html).not.toContain('<script src');
      expect(html).not.toContain('type="module"');
      expect(html).toContain('mengyin:theme');
      expect(html).toContain('@media (prefers-color-scheme: dark)');
      expect(html).not.toContain('{{');
      expect(html).toContain(`<link rel="canonical" href="https://study.example.com/${doc.slug}/"`);
      // Every heading from both languages survives into the HTML.
      const zh = resolveDoc(doc, 'zh-Hant', configured);
      for (const section of zh.sections) {
        expect(html).toContain(`id="${doc.slug}-${section.id}"`);
      }
    });

    it(`${doc.id}: data table rows carry the column label for phone layouts`, () => {
      const html = renderLegalHtml(doc, configured);
      const labelled = html.match(/data-label="[^"]+"/g) ?? [];
      // Only the privacy policy has the data table; when one is present every
      // cell below the first column must name its column for the stacked
      // mobile layout.
      expect(labelled.length > 0).toBe(doc.id === 'privacy');
    });
  }

  it('publishes the configured mailbox and never a private repository URL', () => {
    for (const doc of Object.values(LEGAL_DOCS)) {
      const html = renderLegalHtml(doc, configured);
      expect(html).toContain(CONTACT_EMAIL);
      expect(html).toContain(`mailto:${CONTACT_EMAIL}`);
      // The source repository is private; publishing its URL in a policy is
      // both useless to a reader and a slow information leak.
      expect(html.toLowerCase()).not.toContain('github.com');
    }

    const without = renderLegalHtml(LEGAL_DOCS.privacy, noMailbox);
    expect(without).not.toContain('mailto:');
    expect(without).toContain(LEGAL_DOCS.privacy.title.zh);
  });

  it('points account deletion at the in-app flow, with email as the fallback', () => {
    const zh = resolveDoc(LEGAL_DOCS.privacy, 'zh-Hant', configured);
    const zhText = JSON.stringify(zh);
    expect(zhText).toContain('刪除帳號');
    expect(zhText).toContain('立即');

    const en = resolveDoc(LEGAL_DOCS.privacy, 'en', configured);
    expect(JSON.stringify(en)).toContain('Delete account');
  });

  it('keeps the required store disclosures in both languages', () => {
    const privacy = resolveDoc(LEGAL_DOCS.privacy, 'zh-Hant', configured);
    const text = JSON.stringify(privacy);
    // A reviewer looks for these specific promises; losing one silently is the
    // regression this test exists to catch.
    for (const phrase of ['Supabase', 'Cloudflare', 'Row Level Security', '30 天', '13 歲']) {
      expect(text).toContain(phrase);
    }

    const terms = resolveDoc(LEGAL_DOCS.terms, 'en', configured);
    const enText = JSON.stringify(terms);
    for (const phrase of ['Taipei District Court', 'AI-generated', 'acceptable' /* case-insensitive */]) {
      expect(enText.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });

  it('names the operator and the effective date in the visible chrome', () => {
    expect(pick(LEGAL_CHROME.updated, 'zh-Hant')).toBe('最後更新');
    expect(pick(LEGAL_CHROME.back, 'en')).toBe('Back to the app');
    expect(configured.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(configured.version).toMatch(/^\d+\.\d+$/);
  });

  it('labels AI-generated content and tells learners to verify it', () => {
    const terms = JSON.stringify(resolveDoc(LEGAL_DOCS.terms, 'en', configured));
    for (const phrase of [
      'AI-generated content and labelling',
      'not individually reviewed',
      'Keep any',
      'Verify facts',
      'AI-detection tools',
    ]) {
      expect(terms).toContain(phrase);
    }

    const privacy = JSON.stringify(resolveDoc(LEGAL_DOCS.privacy, 'en', configured));
    expect(privacy).toContain('AI-generated results are labelled in the generation interface');
    expect(privacy).toContain('A saved deck may still contain AI-generated content');
  });

  it('publishes the unused-point refund formula and the access consequence', () => {
    const terms = JSON.stringify(resolveDoc(LEGAL_DOCS.terms, 'en', configured));
    for (const phrase of [
      'unused plan points',
      '11 + unused plan points',
      'amount paid × unused plan points',
      'ends immediately',
      'Each subscription can be refunded once',
      'bonus points',
    ]) {
      expect(terms).toContain(phrase);
    }
    // The old wording promised a full 7-day refund regardless of usage.
    expect(terms).not.toContain('no plan points used: you may write to us to request a full refund');
  });

  it('describes the paid plans that replaced the free-only service', () => {
    const terms = JSON.stringify(resolveDoc(LEGAL_DOCS.terms, 'en', configured));
    for (const phrase of [
      'renew automatically',
      'Unused plan points expire',
      'subscription anniversary',
      'Stripe',
    ]) {
      expect(terms).toContain(phrase);
    }
    expect(terms).not.toContain('currently free to use');
    expect(terms).not.toContain('You pay the API costs');

    const privacy = JSON.stringify(resolveDoc(LEGAL_DOCS.privacy, 'en', configured));
    expect(privacy).toContain('Stripe');
    expect(privacy).toContain('Billing and subscriptions');
    expect(privacy).not.toContain('payment details or identity documents');
  });
});

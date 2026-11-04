import type { LegalContext } from './config';
import { LEGAL_CHROME } from './content';
import type { Bi, LegalDoc } from './content';

export type DocLocale = 'zh-Hant' | 'en';

export type ResolvedBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'note'; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'links'; items: { label: string; href: string }[] };

export interface ResolvedSection {
  id: string;
  heading: string;
  blocks: ResolvedBlock[];
}

export interface ResolvedDoc {
  id: LegalDoc['id'];
  slug: string;
  title: string;
  summary: string;
  version: string;
  updated: string;
  sections: ResolvedSection[];
  footerNote: string;
}

export function pick(bi: Bi, locale: DocLocale): string {
  return locale === 'zh-Hant' ? bi.zh : bi.en;
}

/**
 * Replaces `{{token}}` placeholders. Unknown tokens are left intact so a typo
 * shows up in review instead of silently disappearing from the document.
 */
export function fillText(text: string, ctx: LegalContext): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    switch (key) {
      case 'operator':
        return ctx.operator;
      case 'origin':
        return ctx.origin;
      case 'email':
        return ctx.contactEmail;
      case 'version':
        return ctx.version;
      case 'updated':
        return ctx.updated;
      default:
        return whole;
    }
  });
}

function contactBlocks(locale: DocLocale, ctx: LegalContext): ResolvedBlock[] {
  // The address is shown as text as well as linked, so the document still
  // works when it is printed or read as a PDF.
  const blocks: ResolvedBlock[] = [{ kind: 'p', text: pick(LEGAL_CHROME.contactLead, locale) }];
  if (ctx.contactEmail) {
    blocks.push({
      kind: 'links',
      items: [
        {
          label: `${pick(LEGAL_CHROME.contactEmailLabel, locale)}：${ctx.contactEmail}`,
          href: `mailto:${ctx.contactEmail}`,
        },
      ],
    });
  }
  return blocks;
}

export function resolveDoc(doc: LegalDoc, locale: DocLocale, ctx: LegalContext): ResolvedDoc {
  const sections: ResolvedSection[] = doc.sections.map((section) => ({
    id: section.id,
    heading: pick(section.heading, locale),
    blocks: section.blocks.flatMap((block): ResolvedBlock[] => {
      switch (block.kind) {
        case 'p':
          return [{ kind: 'p', text: fillText(pick(block.text, locale), ctx) }];
        case 'note':
          return [{ kind: 'note', text: fillText(pick(block.text, locale), ctx) }];
        case 'ul':
        case 'ol':
          return [
            {
              kind: block.kind,
              items: block.items.map((item) => fillText(pick(item, locale), ctx)),
            },
          ];
        case 'table':
          return [
            {
              kind: 'table',
              head: block.head.map((cell) => pick(cell, locale)),
              rows: block.rows.map((row) => row.map((cell) => pick(cell, locale))),
            },
          ];
        case 'links':
          return [
            {
              kind: 'links',
              items: block.items.map((item) => ({
                label: fillText(pick(item.label, locale), ctx),
                href: item.href,
              })),
            },
          ];
        case 'contact':
          return contactBlocks(locale, ctx);
      }
    }),
  }));

  return {
    id: doc.id,
    slug: doc.slug,
    title: pick(doc.title, locale),
    summary: fillText(pick(doc.summary, locale), ctx),
    version: ctx.version,
    updated: ctx.updated,
    sections,
    footerNote: pick(LEGAL_CHROME.footer, locale),
  };
}

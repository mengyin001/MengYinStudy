/**
 * Turns the backend catalogue into the same `Deck` objects the rest of the app
 * already understands. Every question goes through the plugin zod schema, so
 * malformed official content is dropped and reported instead of reaching a
 * study session.
 */
import type { Deck } from '@mengyin/core';
import {
  adaptDeck,
  formatIssues,
  parseDeckFile,
  parseManifest,
} from '@mengyin/plugin-sdk';
import type { CachedOfficialPack } from './officialCache';
import type { OfficialCatalog, OfficialPackPayload } from './types';

export interface OfficialIssue {
  path: string;
  message: string;
  pluginId: string;
  pluginName: string;
}

export interface OfficialBuildResult {
  packs: CachedOfficialPack[];
  issues: OfficialIssue[];
}

function issue(pack: OfficialPackPayload, path: string, message: string): OfficialIssue {
  return { path, message, pluginId: pack.id, pluginName: pack.name };
}

export function buildOfficialPacks(catalog: OfficialCatalog): OfficialBuildResult {
  const packs: CachedOfficialPack[] = [];
  const issues: OfficialIssue[] = [];

  for (const pack of catalog.packs) {
    const manifest = parseManifest({
      schemaVersion: 1,
      id: pack.id,
      name: pack.name,
      version: pack.version || '1.0.0',
      ...(pack.description ? { description: pack.description } : {}),
      ...(pack.author ? { author: pack.author } : {}),
      tags: pack.tags,
      content: [],
    });
    if (!manifest.ok) {
      issues.push(issue(pack, `${pack.id}/manifest`, formatIssues(manifest.issues)));
      continue;
    }

    const decks: Deck[] = [];
    const seen = new Set<string>();
    for (const candidate of pack.decks) {
      if (seen.has(candidate.id)) {
        issues.push(issue(pack, `${pack.id}/${candidate.id}`, 'Duplicate deck id in the pack.'));
        continue;
      }
      const parsed = parseDeckFile({
        id: candidate.id,
        title: candidate.title,
        ...(candidate.titleI18n ? { titleI18n: candidate.titleI18n } : {}),
        ...(candidate.description ? { description: candidate.description } : {}),
        ...(candidate.descriptionI18n ? { descriptionI18n: candidate.descriptionI18n } : {}),
        tags: candidate.tags,
        questions: candidate.questions,
        ...(candidate.examMinutes === undefined ? {} : { examMinutes: candidate.examMinutes }),
      });
      if (!parsed.ok) {
        issues.push(
          issue(pack, `${pack.id}/${candidate.id}`, `Deck failed validation — ${formatIssues(parsed.issues)}`),
        );
        continue;
      }
      decks.push(adaptDeck(pack.id, parsed.value, candidate.mediaBaseUrl ?? undefined));
      seen.add(candidate.id);
    }

    if (decks.length === 0) {
      issues.push(issue(pack, pack.id, 'Pack has no valid published decks.'));
      continue;
    }
    packs.push({ manifest: manifest.value, decks, updatedAt: pack.updatedAt });
  }

  return { packs, issues };
}

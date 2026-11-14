import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDeckFile, parseManifest } from '@mengyin/plugin-sdk';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const pluginsDir = path.join(root, 'plugins');

async function walk(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

function patternToRegExp(pattern: string): RegExp {
  const clean = pattern.replace(/^\.\//, '');
  let source = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  source = source.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

interface DeckFileOnDisk {
  pluginId: string;
  file: string;
  raw: unknown;
}

async function loadPlugins(): Promise<DeckFileOnDisk[]> {
  const decks: DeckFileOnDisk[] = [];
  const pluginDirs = (await readdir(pluginsDir, { withFileTypes: true })).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'),
  );
  for (const dir of pluginDirs) {
    const dirPath = path.join(pluginsDir, dir.name);
    const manifestRaw = JSON.parse(await readFile(path.join(dirPath, 'manifest.json'), 'utf8'));
    const manifest = parseManifest(manifestRaw);
    expect(manifest.ok, `${dir.name}/manifest.json`).toBe(true);
    if (!manifest.ok) continue;
    const files = await walk(dirPath);
    const patterns = manifest.value.content.map(patternToRegExp);
    for (const file of files) {
      if (!patterns.some((pattern) => pattern.test(file))) continue;
      decks.push({
        pluginId: manifest.value.id,
        file: `${dir.name}/${file}`,
        raw: JSON.parse(await readFile(path.join(dirPath, file), 'utf8')),
      });
    }
  }
  return decks;
}

describe('bundled official decks', () => {
  it('parse and meet the authoring floor', async () => {
    const decks = await loadPlugins();
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      const parsed = parseDeckFile(deck.raw);
      expect(parsed.ok, `${deck.file}: ${parsed.ok ? '' : JSON.stringify(parsed.issues)}`).toBe(true);
      if (!parsed.ok) continue;

      if (deck.pluginId === 'cpp.runoob') {
        expect(parsed.value.questions.length, `${deck.file} question count`).toBeGreaterThanOrEqual(
          10,
        );
      }
      const ids = parsed.value.questions.map((question) => question.id);
      expect(new Set(ids).size, `${deck.file} duplicate question ids`).toBe(ids.length);
    }
  });

  it('every Runoob C++ question carries both languages', async () => {
    const decks = (await loadPlugins()).filter((deck) => deck.pluginId === 'cpp.runoob');
    expect(decks.length).toBeGreaterThan(0);

    for (const deck of decks) {
      const parsed = parseDeckFile(deck.raw);
      if (!parsed.ok) continue; // the previous test reports the schema error
      const value = parsed.value;

      expect(value.titleI18n?.['zh-Hant'], `${deck.file} title zh-Hant`).toBeTruthy();
      expect(value.descriptionI18n?.['zh-Hant'], `${deck.file} description zh-Hant`).toBeTruthy();

      for (const question of value.questions) {
        const label = `${deck.file}#${question.id}`;
        expect(question.i18n?.prompt?.['zh-Hant'], `${label} prompt zh-Hant`).toBeTruthy();
        expect(question.explanation, `${label} explanation`).toBeTruthy();
        expect(question.i18n?.explanation?.['zh-Hant'], `${label} explanation zh-Hant`).toBeTruthy();

        for (const option of question.options ?? []) {
          expect(
            question.i18n?.options?.[option.id]?.['zh-Hant'],
            `${label} option ${option.id} zh-Hant`,
          ).toBeTruthy();
        }

        if (question.answer.kind === 'short') {
          expect(question.i18n?.model?.['zh-Hant'], `${label} model zh-Hant`).toBeTruthy();
        }
      }
    }
  });
});

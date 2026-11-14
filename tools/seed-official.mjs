#!/usr/bin/env node
/**
 * Seed the official Supabase catalogue from plugins/.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SECRET_KEY=sb_secret_... \
 *   npm run seed:official
 *
 * The secret key bypasses RLS. Keep it in .env.local or the shell, never in a
 * VITE_ variable. The app validates every deck again with the plugin zod
 * schema before showing it, so this script only does structural checks.
 *
 * Flags:
 *   --draft          write packs/decks with published = false
 *   --prune          delete official packs that are not in plugins/ (destructive)
 *   --pack=<id>      seed only the given pack (repeatable)
 *   --dry-run        print what would happen without writing
 *   --source=<dir>   plugin source directory (default plugins)
 */
import { createClient } from '@supabase/supabase-js';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFiles, root } from './load-env.mjs';

loadEnvFiles();

const args = process.argv.slice(2);
const hasFlag = (name) => args.includes(name);
const valueOf = (name) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const draft = hasFlag('--draft');
const prune = hasFlag('--prune');
const dryRun = hasFlag('--dry-run');
const sourceDir = path.resolve(root, valueOf('--source') ?? 'plugins');
const bucket = process.env.OFFICIAL_MEDIA_BUCKET?.trim() || 'official-media';
const selected = new Set(
  args
    .filter((arg) => arg.startsWith('--pack='))
    .map((arg) => arg.slice('--pack='.length))
    .filter(Boolean),
);

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
if (!url) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) in .env.local / the environment.');
  process.exit(1);
}
const publishableKey =
  process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const serviceKey = (
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''
).trim();
if (!serviceKey) {
  console.error(
    'Missing SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY). ' +
      'Find it in Supabase → Project Settings → API Keys and put it in .env.local.',
  );
  process.exit(1);
}
if (serviceKey.startsWith('sb_publishable_') || serviceKey === publishableKey) {
  console.error('That is a publishable key. Use the secret key; it must never reach the browser.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Keep this in step with `packages/core/src/exam.ts`. The seed stores the
 * official paper length so every device sees the same countdown; the client
 * falls back to the same estimate only when a row has no value.
 */
const EXAM_BASE_SECONDS = {
  single: 60,
  multi: 90,
  boolean: 30,
  fill: 45,
  short: 150,
  code: 300,
};
const DEFAULT_QUESTION_SECONDS = 90;
const MIN_QUESTION_SECONDS = 15;
const MAX_QUESTION_SECONDS = 900;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function estimateQuestionSeconds(question) {
  const claimed = question?.meta?.estimatedSeconds;
  if (typeof claimed === 'number' && Number.isFinite(claimed) && claimed > 0) {
    return clamp(Math.round(claimed), MIN_QUESTION_SECONDS, MAX_QUESTION_SECONDS);
  }
  const mapped = EXAM_BASE_SECONDS[question?.type];
  const base =
    typeof mapped === 'number' && Number.isFinite(mapped) ? mapped : DEFAULT_QUESTION_SECONDS;
  const difficulty = Number.isFinite(question?.difficulty) ? clamp(question.difficulty, 1, 5) : 2;
  return clamp(
    Math.round(base * (0.85 + difficulty * 0.15)),
    MIN_QUESTION_SECONDS,
    MAX_QUESTION_SECONDS,
  );
}

function examMinutesFor(raw) {
  const declared = raw?.examMinutes;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    return clamp(Math.round(declared), 1, 600);
  }
  const questions = Array.isArray(raw?.questions) ? raw.questions : [];
  if (questions.length === 0) return 1;
  const seconds = questions.reduce((total, question) => total + estimateQuestionSeconds(question), 0);
  return clamp(Math.ceil(seconds / 60), 1, 600);
}

const CONTENT_TYPES = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]);

function log(...parts) {
  console.log('[seed]', ...parts);
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else if (entry.isFile()) files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

function patternToRegExp(pattern) {
  const clean = pattern.replace(/^\.\//, '');
  let source = clean.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  source = source.replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${source}$`);
}

function resolveContent(files, patterns) {
  const matched = new Set();
  for (const pattern of patterns) {
    const regex = patternToRegExp(pattern);
    for (const file of files) if (regex.test(file)) matched.add(file);
  }
  return [...matched].sort();
}

async function loadPacks() {
  const entries = (await readdir(sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));

  const packs = [];
  for (const entry of entries) {
    const dir = path.join(sourceDir, entry.name);
    const manifestPath = path.join(dir, 'manifest.json');
    if (!(await exists(manifestPath))) {
      log(`skip ${entry.name}: no manifest.json`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      log(`skip ${entry.name}: invalid manifest.json (${error.message})`);
      continue;
    }
    if (!manifest || typeof manifest.id !== 'string' || typeof manifest.name !== 'string') {
      log(`skip ${entry.name}: manifest needs id and name`);
      continue;
    }
    if (selected.size > 0 && !selected.has(manifest.id)) continue;

    const files = await walk(dir);
    const content = resolveContent(files, Array.isArray(manifest.content) ? manifest.content : []);
    const decks = [];
    for (const file of content) {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
        if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') {
          log(`skip ${manifest.id}/${file}: deck needs id and title`);
          continue;
        }
        if (!Array.isArray(raw.questions) || raw.questions.length === 0) {
          log(`skip ${manifest.id}/${file}: deck has no questions`);
          continue;
        }
        decks.push({ file, raw });
      } catch (error) {
        log(`skip ${manifest.id}/${file}: ${error.message}`);
      }
    }
    if (decks.length === 0) {
      log(`skip ${manifest.id}: no readable decks`);
      continue;
    }
    packs.push({ dir, manifest, decks });
  }
  return packs;
}

function mediaSources(questions) {
  const sources = [];
  for (const question of questions) {
    if (!question || typeof question !== 'object') continue;
    if (Array.isArray(question.media)) {
      for (const media of question.media) if (media?.src) sources.push(media.src);
    }
    if (Array.isArray(question.options)) {
      for (const option of question.options) {
        if (!Array.isArray(option?.media)) continue;
        for (const media of option.media) if (media?.src) sources.push(media.src);
      }
    }
  }
  return sources;
}

function relativeMedia(src) {
  if (typeof src !== 'string' || !src.trim()) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src)) return null;
  if (/^(?:data|blob|file):/i.test(src)) return null;
  if (src.startsWith('/')) return null;
  const clean = src.replace(/^\.\//, '');
  if (!clean || clean.includes('..')) return null;
  return clean;
}

async function ensureBucket() {
  const { data, error } = await supabase.storage.getBucket(bucket);
  if (data) return;
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new Error(`Cannot read storage bucket "${bucket}": ${error.message}`);
  }
  const created = await supabase.storage.createBucket(bucket, { public: true });
  if (created.error) throw new Error(`Cannot create bucket "${bucket}": ${created.error.message}`);
  log(`created public storage bucket ${bucket}`);
}

const uploaded = new Set();

async function uploadMedia(packId, deckId, pluginDir, sources) {
  let count = 0;
  for (const src of sources) {
    const relative = relativeMedia(src);
    if (!relative) continue;
    const file = path.resolve(pluginDir, relative);
    if (!file.startsWith(`${path.resolve(pluginDir)}${path.sep}`)) continue;
    if (!(await exists(file))) {
      log(`warn ${packId}/${deckId}: media not found: ${relative}`);
      continue;
    }
    const storagePath = `${packId}/${deckId}/${relative}`;
    if (uploaded.has(storagePath)) {
      count += 1;
      continue;
    }
    if (dryRun) {
      uploaded.add(storagePath);
      count += 1;
      continue;
    }
    const body = await readFile(file);
    const contentType = CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
    const { error } = await supabase.storage.from(bucket).upload(storagePath, body, {
      upsert: true,
      contentType,
    });
    if (error) {
      log(`warn ${storagePath}: upload failed: ${error.message}`);
      continue;
    }
    uploaded.add(storagePath);
    count += 1;
  }
  return count;
}

function mediaBase(packId, deckId) {
  return `${url}/storage/v1/object/public/${bucket}/${encodeURIComponent(packId)}/${encodeURIComponent(deckId)}/`;
}

async function preflight() {
  const { error } = await supabase
    .from('official_catalog_meta')
    .select('version')
    .eq('id', true)
    .maybeSingle();
  if (error) {
    throw new Error(
      `The official tables are not ready (${error.message}). Apply supabase/migrations first.`,
    );
  }
}

async function main() {
  log(`source: ${sourceDir}`);
  log(`target: ${url}`);
  if (dryRun) log('dry run: no writes');
  if (draft) log('draft: everything will be unpublished');

  await preflight();
  if (!dryRun) await ensureBucket();

  const packs = await loadPacks();
  if (packs.length === 0) {
    log('nothing to seed');
    return;
  }

  let deckCount = 0;
  let mediaCount = 0;
  for (const [index, pack] of packs.entries()) {
    const published = !draft;
    const packRow = {
      id: pack.manifest.id,
      name: pack.manifest.name,
      version: typeof pack.manifest.version === 'string' ? pack.manifest.version : '1.0.0',
      description: pack.manifest.description ?? null,
      author: pack.manifest.author ?? null,
      homepage: pack.manifest.homepage ?? null,
      license: pack.manifest.license ?? null,
      tags: Array.isArray(pack.manifest.tags) ? pack.manifest.tags : [],
      published,
      sort_order: index,
    };

    if (!dryRun) {
      const { error } = await supabase.from('official_packs').upsert(packRow, { onConflict: 'id' });
      if (error) throw new Error(`${pack.manifest.id}: pack upsert failed: ${error.message}`);
    }

    const deckRows = [];
    for (const [deckIndex, deck] of pack.decks.entries()) {
      const sources = mediaSources(deck.raw.questions);
      const uploadedCount = await uploadMedia(pack.manifest.id, deck.raw.id, pack.dir, sources);
      mediaCount += uploadedCount;
      deckRows.push({
        pack_id: pack.manifest.id,
        id: deck.raw.id,
        title: deck.raw.title,
        title_i18n: deck.raw.titleI18n ?? null,
        description: deck.raw.description ?? null,
        description_i18n: deck.raw.descriptionI18n ?? null,
        tags: Array.isArray(deck.raw.tags) ? deck.raw.tags : [],
        questions: deck.raw.questions,
        exam_minutes: examMinutesFor(deck.raw),
        media_base_url: uploadedCount > 0 ? mediaBase(pack.manifest.id, deck.raw.id) : null,
        version: '1',
        published,
        sort_order: deckIndex,
      });
      deckCount += 1;
    }

    if (!dryRun) {
      const { error } = await supabase
        .from('official_decks')
        .upsert(deckRows, { onConflict: 'pack_id,id' });
      if (error) throw new Error(`${pack.manifest.id}: deck upsert failed: ${error.message}`);

      const { data: existing, error: readError } = await supabase
        .from('official_decks')
        .select('id')
        .eq('pack_id', pack.manifest.id);
      if (readError) throw new Error(`${pack.manifest.id}: cannot list decks: ${readError.message}`);
      const keep = new Set(deckRows.map((row) => row.id));
      for (const row of existing ?? []) {
        if (keep.has(row.id)) continue;
        const { error: deleteError } = await supabase
          .from('official_decks')
          .delete()
          .eq('pack_id', pack.manifest.id)
          .eq('id', row.id);
        if (deleteError) throw new Error(`${pack.manifest.id}/${row.id}: delete failed: ${deleteError.message}`);
      }
    }

    log(`✔ ${pack.manifest.id} — ${deckRows.length} deck(s)${draft ? ' [draft]' : ''}`);
  }

  if (prune) {
    const ids = new Set(packs.map((pack) => pack.manifest.id));
    const { data: existing, error } = await supabase.from('official_packs').select('id');
    if (error) throw new Error(`cannot list packs: ${error.message}`);
    for (const row of existing ?? []) {
      if (ids.has(row.id)) continue;
      if (dryRun) {
        log(`would delete pack ${row.id}`);
        continue;
      }
      const { error: deleteError } = await supabase.from('official_packs').delete().eq('id', row.id);
      if (deleteError) throw new Error(`delete ${row.id} failed: ${deleteError.message}`);
      log(`deleted pack ${row.id}`);
    }
  }

  const { data: meta } = await supabase
    .from('official_catalog_meta')
    .select('version,updated_at')
    .eq('id', true)
    .maybeSingle();
  log(
    `done: ${packs.length} pack(s), ${deckCount} deck(s), ${mediaCount} media file(s)` +
      (meta ? ` · catalogue v${meta.version}` : ''),
  );
}

main().catch((error) => {
  console.error(`[seed] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Official content authoring for MengYin Study.
 *
 * Creates and deletes the two official content types the app reads from
 * Supabase:
 *
 *   collection (合集)  -> public.official_packs
 *   question bank (題庫) -> public.official_decks
 *
 * A question bank is written by the same hosted generation pipeline the
 * Generate page uses, including its schema validation, exact figures and
 * photo pipeline. Photos are moved from in-memory data URLs into the public
 * `official-media` Storage bucket and the deck keeps a relative media path, so
 * the app resolves it through `media_base_url` exactly like seeded content.
 *
 * The DSH Host plugin calls this file with a JSON spec on stdin:
 *
 *   node tools/official-content.mjs create-bank --spec -
 *   node tools/official-content.mjs list --spec -
 *
 * It is also usable by hand:
 *
 *   node tools/official-content.mjs list --spec spec.json
 *
 * Output is one JSON object on stdout; progress and diagnostics go to stderr.
 * A failure exits non-zero after printing { ok: false, error } on stdout.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEnvFiles, loadDevVars } from './load-env.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUCKET = (process.env.OFFICIAL_MEDIA_BUCKET || 'official-media').trim() || 'official-media';
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_QUESTION_COUNT = 50;
const DEFAULT_QUESTION_COUNT = 10;

const QUESTION_TYPES = ['single', 'multi', 'boolean', 'fill', 'short', 'code'];
const CODE_LANGUAGES = ['javascript', 'typescript', 'python', 'sql', 'java', 'cpp'];
const DIFFICULTIES = ['mixed', 'easy', 'hard'];
const LANGUAGES = ['auto', 'en', 'zh-Hant'];
const IMAGE_MODES = ['off', 'auto', 'on'];

const MIME_BY_EXT = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.avif', 'image/avif'],
]);
const EXT_BY_MIME = new Map([
  ['image/svg+xml', 'svg'],
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

class OfficialError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'OfficialError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable === true;
    this.details = options.details;
  }
}

function log(...parts) {
  console.error('[official]', ...parts);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function text(value, max, field, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new OfficialError(`${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new OfficialError(`${field} must be a string.`);
  const clean = value.trim();
  if (!clean) {
    if (required) throw new OfficialError(`${field} cannot be empty.`);
    return undefined;
  }
  if (clean.length > max) throw new OfficialError(`${field} must be at most ${max} characters.`);
  return clean;
}

function integer(value, min, max, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new OfficialError(`${field} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function oneOf(value, allowed, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new OfficialError(`${field} must be one of: ${allowed.join(', ')}.`);
  }
  return value;
}

function tags(value, field = 'tags') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OfficialError(`${field} must be an array of strings.`);
  const clean = [];
  for (const item of value) {
    if (typeof item !== 'string') throw new OfficialError(`${field} must contain only strings.`);
    const tag = item.trim();
    if (!tag) continue;
    if (tag.length > 40) throw new OfficialError(`Each ${field} entry must be at most 40 characters.`);
    if (!clean.includes(tag)) clean.push(tag);
  }
  if (clean.length > 8) throw new OfficialError(`At most 8 ${field} entries are allowed.`);
  return clean;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

function identifier(value, field) {
  const clean = text(value, 64, field);
  if (clean === undefined) return undefined;
  if (!ID_PATTERN.test(clean)) {
    throw new OfficialError(
      `${field} must be 2–64 characters using letters, digits, dots, underscores or hyphens, and start with a letter or digit.`,
    );
  }
  return clean;
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function firstLine(value) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  ).slice(0, 80);
}

function safeName(value, fallback = 'image') {
  const clean = String(value ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return clean || fallback;
}

function asRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

async function readSpec() {
  const specArg = argValue('--spec');
  let raw;
  if (!specArg || specArg === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    raw = Buffer.concat(chunks).toString('utf8');
  } else {
    raw = await readFile(path.resolve(root, specArg), 'utf8');
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new OfficialError(`The spec is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new OfficialError('The spec must be a JSON object.');
  }
  return parsed;
}

function loadEnvironment() {
  loadEnvFiles();
  loadDevVars();
  // This process is a private, in-memory caller of the Worker. It is never a
  // server, so auth and billing are switched off for exactly this process.
  process.env.AUTH_REQUIRED = 'false';
  process.env.BILLING_ENFORCE = 'false';
  process.env.NODE_NO_WARNINGS = '1';
  // Official content must never be placeholder demo output, even if a local
  // .dev.vars still has the demo flag from an offline session.
  delete process.env.AI_MOCK;
  if ((process.env.IMAGE_PROVIDER || '').trim().toLowerCase() === 'demo') {
    process.env.IMAGE_PROVIDER = 'none';
    log('IMAGE_PROVIDER=demo is ignored for official content; diagrams only.');
  }
}

function database() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = (
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    ''
  ).trim();
  const publishable =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
  if (!url) {
    throw new OfficialError(
      'Missing SUPABASE_URL (or VITE_SUPABASE_URL) in .env.local / .env.',
    );
  }
  if (!key) {
    throw new OfficialError(
      'Missing SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY). Official writes need the secret key.',
    );
  }
  if (key.startsWith('sb_publishable_') || key === publishable) {
    throw new OfficialError('That is a publishable key. Use the Supabase secret key for official writes.');
  }
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { url, db };
}

let workerPromise;

/**
 * Load the deployed Worker's own generation pipeline in this Node process.
 *
 * Node 24 strips types from .ts files, but it does not add the .ts extension
 * to the API's extensionless imports, so a resolve hook fills that gap. This
 * keeps official authoring byte-for-byte identical to the Generate page
 * instead of maintaining a second prompt or a second validator.
 */
async function loadWorker() {
  if (workerPromise) return workerPromise;
  if (typeof registerHooks !== 'function' || !process.features?.typescript) {
    throw new OfficialError(
      'Official authoring needs Node 22.18+ with TypeScript type stripping (the bundled DSH Node 24 works). ' +
        'Set MENGYIN_NODE to a suitable node executable if the Host picked another one.',
    );
  }
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith('.') || !context.parentURL) throw error;
        const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
        for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
          if (existsSync(candidate)) {
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
        throw error;
      }
    },
  });
  const module = await import(pathToFileURL(path.join(root, 'apps', 'api', 'src', 'index.ts')).href);
  workerPromise = module.default;
  return workerPromise;
}

function workerEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  env.AUTH_REQUIRED = 'false';
  env.BILLING_ENFORCE = 'false';
  return env;
}

async function callWorker(pathname, init) {
  const worker = await loadWorker();
  const request = new Request(`http://official-content.local${pathname}`, init);
  const response = await worker.fetch(request, workerEnv(), { waitUntil() {} });
  const bodyText = await response.text();
  let body;
  try {
    body = bodyText ? JSON.parse(bodyText) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      body && body.error && typeof body.error.message === 'string'
        ? body.error.message
        : `The generation service returned HTTP ${response.status}.`;
    throw new OfficialError(message, {
      status: response.status,
      code: body && body.error ? body.error.code : undefined,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return body;
}

async function engineCatalog() {
  const config = await callWorker('/api/ai/config', { headers: { Accept: 'application/json' } });
  const providers = Array.isArray(config && config.providers) ? config.providers : [];
  const available = providers.filter(
    (provider) => provider && provider.configured === true && provider.demo !== true,
  );
  if (available.length === 0) {
    throw new OfficialError(
      'No text provider is configured. Put GLM_API_KEY or DEEPSEEK_API_KEY in .env / .dev.vars first.',
    );
  }
  return { ...config, providers: available };
}

function modelCandidates(config, requested) {
  const all = [];
  for (const provider of config.providers) {
    for (const model of Array.isArray(provider.models) ? provider.models : []) {
      if (typeof model !== 'string' || !model) continue;
      all.push({ provider: provider.id, providerLabel: provider.label || provider.id, model });
    }
  }
  if (requested) {
    const found = all.find(
      (item) => item.model === requested || `${item.provider}:${item.model}` === requested,
    );
    if (!found) {
      throw new OfficialError(
        `Unknown model "${requested}". Configured models: ${all.map((item) => item.model).join(', ') || 'none'}.`,
      );
    }
    return [found];
  }

  const preferredProvider = (process.env.AI_DEFAULT_PROVIDER || '').trim();
  const preferredModel = (process.env.AI_DEFAULT_MODEL || '').trim();
  const scored = all.map((item) => {
    let score = item.provider === 'glm' ? 10 : 0;
    if (preferredProvider && item.provider === preferredProvider) score += 50;
    if (preferredModel && item.model === preferredModel) score += 100;
    if (/flash/i.test(item.model)) score += 1;
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map((entry) => entry.item);
}

async function generateDeck(input, config) {
  const candidates = modelCandidates(config, input.model);
  const failures = [];
  let lastError;

  for (const candidate of candidates) {
    try {
      log(`writing ${input.count} question(s) with ${candidate.providerLabel} / ${candidate.model}`);
      const result = await callWorker('/api/ai/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          topic: input.title,
          description: input.description,
          count: input.count,
          types: input.types,
          difficulty: input.difficulty,
          language: input.language,
          codeLanguage: input.codeLanguage,
          model: candidate.model,
          imageMode: input.images,
          ...(input.images === 'off' ? {} : { imageMax: input.imageMax }),
        }),
      });
      if (!result || !result.deck || !Array.isArray(result.deck.questions)) {
        throw new OfficialError('The generation service returned no deck.');
      }
      return { ...result, candidate, failures };
    } catch (error) {
      lastError = error;
      if (!(error instanceof OfficialError) || !error.retryable || candidates.length === 1) {
        throw error;
      }
      failures.push(`${candidate.providerLabel} / ${candidate.model}: ${error.message}`);
      log(`provider unavailable, trying the next model: ${error.message}`);
    }
  }
  throw lastError;
}

async function ensureBucket(db) {
  const { data, error } = await db.storage.getBucket(BUCKET);
  if (data) return;
  if (error && !/not found|does not exist/i.test(error.message)) {
    throw new OfficialError(`Cannot read storage bucket "${BUCKET}": ${error.message}`);
  }
  const created = await db.storage.createBucket(BUCKET, { public: true });
  if (created.error) {
    throw new OfficialError(`Cannot create storage bucket "${BUCKET}": ${created.error.message}`);
  }
  log(`created the public storage bucket ${BUCKET}`);
}

function decodeDataUrl(src) {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(src);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const data = match[2]
    ? Buffer.from(match[3], 'base64')
    : Buffer.from(decodeURIComponent(match[3]), 'utf8');
  return { mime, data };
}

async function readRemoteImage(src) {
  let response;
  try {
    response = await fetch(src, { signal: AbortSignal.timeout(20_000) });
  } catch (error) {
    throw new OfficialError(`Could not download an image from ${src}: ${error.message}`);
  }
  if (!response.ok) {
    throw new OfficialError(`Could not download an image from ${src}: HTTP ${response.status}.`);
  }
  const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!mime.startsWith('image/')) {
    throw new OfficialError(`The remote file at ${src} is not an image (${mime || 'unknown type'}).`);
  }
  const data = Buffer.from(await response.arrayBuffer());
  return { mime, data };
}

async function readImageSource(src) {
  if (typeof src !== 'string' || !src.trim()) return null;
  if (src.startsWith('data:')) return decodeDataUrl(src);
  if (/^https?:\/\//i.test(src)) return readRemoteImage(src);
  return null;
}

function extensionFor(mime, fallback) {
  return EXT_BY_MIME.get(mime.toLowerCase()) || fallback || 'bin';
}

function mediaBase(url, packId, deckId) {
  return `${url}/storage/v1/object/public/${BUCKET}/${encodeURIComponent(packId)}/${encodeURIComponent(deckId)}/`;
}

function touchesImage(media) {
  return Boolean(media && media.type === 'image');
}

async function uploadMedia(db, url, deck, packId, deckId, attachments) {
  const bucket = db.storage.from(BUCKET);
  const used = new Set();
  const uploaded = [];
  let figures = 0;
  let photos = 0;
  let userImages = 0;
  const base = `${packId}/${deckId}`;

  const put = async (payload, nameHint) => {
    if (payload.data.length > MAX_UPLOAD_BYTES) {
      throw new OfficialError(
        `Image ${nameHint} is ${(payload.data.length / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.`,
      );
    }
    const ext = extensionFor(payload.mime);
    let name = `${safeName(nameHint)}.${ext}`;
    let counter = 2;
    while (used.has(name)) name = `${safeName(nameHint)}-${counter++}.${ext}`;
    used.add(name);
    const storagePath = `${base}/${name}`;
    const { error } = await bucket.upload(storagePath, payload.data, {
      upsert: true,
      contentType: payload.mime,
      cacheControl: '31536000',
    });
    if (error) throw new OfficialError(`Could not upload ${storagePath}: ${error.message}`);
    uploaded.push(storagePath);
    return name;
  };

  const uploadSrc = async (src, nameHint) => {
    const payload = await readImageSource(src);
    if (!payload) return null;
    return put(payload, nameHint);
  };

  try {
    for (const [questionIndex, question] of deck.questions.entries()) {
      const questionKey = safeName(question.id || `q${questionIndex + 1}`, `q${questionIndex + 1}`);
      for (const [mediaIndex, media] of (Array.isArray(question.media) ? question.media : []).entries()) {
        if (media.type === 'figure') {
          figures += 1;
          continue;
        }
        if (!touchesImage(media)) continue;
        const name = await uploadSrc(media.src, `${questionKey}-${mediaIndex + 1}`);
        if (!name) continue;
        media.src = name;
        photos += 1;
      }
      for (const option of Array.isArray(question.options) ? question.options : []) {
        const optionKey = safeName(option.id || 'option', 'option');
        for (const [mediaIndex, media] of (Array.isArray(option.media) ? option.media : []).entries()) {
          if (!touchesImage(media)) continue;
          const name = await uploadSrc(
            media.src,
            `${questionKey}-${optionKey}-${mediaIndex + 1}`,
          );
          if (!name) continue;
          media.src = name;
          photos += 1;
        }
      }
    }

    for (const [index, attachment] of attachments.entries()) {
      const question = deck.questions[attachment.question - 1];
      if (!question) {
        throw new OfficialError(
          `Attachments[${index}].question is ${attachment.question}, but the bank has ${deck.questions.length} questions.`,
        );
      }
      const file = path.resolve(root, attachment.path);
      let info;
      try {
        info = await stat(file);
      } catch {
        throw new OfficialError(`Attachment not found: ${attachment.path}`);
      }
      if (!info.isFile()) throw new OfficialError(`Attachment is not a file: ${attachment.path}`);
      if (info.size > MAX_ATTACHMENT_BYTES) {
        throw new OfficialError(
          `Attachment ${attachment.path} is ${(info.size / 1024 / 1024).toFixed(1)} MB; the limit is 15 MB.`,
        );
      }
      const mime = MIME_BY_EXT.get(path.extname(file).toLowerCase());
      if (!mime) {
        throw new OfficialError(
          `Attachment ${attachment.path} must be SVG, PNG, JPEG, WebP, GIF or AVIF.`,
        );
      }
      const data = await readFile(file);
      const name = await put(
        { mime, data },
        `${safeName(question.id || `q${attachment.question}`)}-attachment-${index + 1}`,
      );
      const alt = attachment.alt || String(question.prompt || '').slice(0, 160);
      question.media = [...(Array.isArray(question.media) ? question.media : []), { type: 'image', src: name, alt }];
      userImages += 1;
    }
  } catch (error) {
    // A half-uploaded set would otherwise leave orphan objects in the public
    // bucket when the caller has not received `uploaded` yet.
    if (uploaded.length > 0) {
      await removeObjects(db, uploaded).catch((cleanupError) => {
        log(`image cleanup failed: ${cleanupError.message}`);
      });
    }
    throw error;
  }

  return {
    uploaded,
    figures,
    photos,
    userImages,
    mediaBaseUrl: uploaded.length > 0 ? mediaBase(url, packId, deckId) : null,
  };
}

async function removeObjects(db, paths) {
  const bucket = db.storage.from(BUCKET);
  let removed = 0;
  for (let index = 0; index < paths.length; index += 100) {
    const batch = paths.slice(index, index + 100);
    const { error } = await bucket.remove(batch);
    if (error) throw new OfficialError(`Could not remove stored images: ${error.message}`);
    removed += batch.length;
  }
  return removed;
}

async function storageFiles(db, prefix) {
  const bucket = db.storage.from(BUCKET);
  const cleanPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const files = [];
  const queue = cleanPrefix ? [cleanPrefix] : [];
  while (queue.length > 0) {
    const current = queue.shift();
    let offset = 0;
    for (;;) {
      const { data, error } = await bucket.list(current, { limit: 100, offset });
      if (error) throw new OfficialError(`Cannot list stored images: ${error.message}`);
      const entries = Array.isArray(data) ? data : [];
      if (entries.length === 0) break;
      for (const entry of entries) {
        const child = `${current}/${entry.name}`;
        if (entry.id === null || entry.id === undefined) queue.push(child);
        else files.push(child);
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
  }
  return files;
}

async function catalogueVersion(db) {
  const { data, error } = await db
    .from('official_catalog_meta')
    .select('version')
    .eq('id', true)
    .maybeSingle();
  if (error) throw new OfficialError(`Cannot read the catalogue version: ${error.message}`);
  return data ? Number(data.version) : null;
}

async function safeCatalogueVersion(db) {
  try {
    return await catalogueVersion(db);
  } catch {
    return null;
  }
}

async function nextSortOrder(db, table, column = 'sort_order') {
  const { data, error } = await db
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw new OfficialError(`Cannot read ${table}: ${error.message}`);
  return data && data[0] && Number.isFinite(data[0][column]) ? data[0][column] + 1 : 0;
}

async function insertPack(db, input) {
  const id = input.id || makeId('pack');
  const { data: existing, error: readError } = await db
    .from('official_packs')
    .select('id,name,published')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw new OfficialError(`Cannot check collection ${id}: ${readError.message}`);
  if (existing) {
    throw new OfficialError(
      `Collection "${id}" already exists${existing.name ? ` (${existing.name})` : ''}. Pass pack_id to add a bank to it.`,
    );
  }
  const row = {
    id,
    name: input.name,
    version: '1.0.0',
    description: input.description ?? null,
    author: input.author ?? 'MengYin Study',
    homepage: input.homepage ?? null,
    license: input.license ?? null,
    tags: input.tags ?? [],
    published: input.published !== false,
    sort_order: input.sortOrder ?? (await nextSortOrder(db, 'official_packs')),
  };
  const { error } = await db.from('official_packs').insert(row);
  if (error) throw new OfficialError(`Could not create collection "${input.name}": ${error.message}`);
  return row;
}

function normalizeAttachments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OfficialError('attachments must be an array.');
  if (value.length > 20) throw new OfficialError('At most 20 attachments are allowed.');
  return value.map((raw, index) => {
    const item = asRecord(raw);
    const question = integer(item.question, 1, 1000, undefined, `attachments[${index}].question`);
    if (question === undefined) {
      throw new OfficialError(`attachments[${index}].question is required (1-based).`);
    }
    const file = text(item.path, 500, `attachments[${index}].path`, { required: true });
    const alt = text(item.alt, 160, `attachments[${index}].alt`);
    return { question, path: file, ...(alt ? { alt } : {}) };
  });
}

function normalizeBankSpec(spec) {
  const description = text(spec.description, 20_000, 'description', { required: true });
  const title =
    text(spec.title, 200, 'title') || firstLine(description) || `Official bank ${new Date().toISOString().slice(0, 10)}`;
  const count = integer(spec.count, 1, MAX_QUESTION_COUNT, DEFAULT_QUESTION_COUNT, 'count');
  const rawTypes = spec.types === undefined ? ['single', 'multi', 'boolean'] : spec.types;
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    throw new OfficialError('types must be a non-empty array.');
  }
  const types = [];
  for (const type of rawTypes) {
    if (!QUESTION_TYPES.includes(type)) {
      throw new OfficialError(`Unknown question type "${type}". Use: ${QUESTION_TYPES.join(', ')}.`);
    }
    if (!types.includes(type)) types.push(type);
  }
  const codeLanguage = oneOf(spec.codeLanguage, CODE_LANGUAGES, 'javascript', 'codeLanguage');
  const difficulty = oneOf(spec.difficulty, DIFFICULTIES, 'mixed', 'difficulty');
  const language = oneOf(spec.language, LANGUAGES, 'auto', 'language');
  const images = oneOf(spec.images, IMAGE_MODES, 'auto', 'images');
  const imageMax = integer(spec.imageMax, 0, 20, 4, 'imageMax');
  const published = spec.published !== false;
  return {
    description,
    title,
    count,
    types,
    codeLanguage,
    difficulty,
    language,
    images,
    imageMax,
    published,
    model: text(spec.model, 100, 'model'),
    tags: tags(spec.tags),
    packId: identifier(spec.packId, 'packId'),
    packName: text(spec.packName, 80, 'packName'),
    packDescription: text(spec.packDescription, 2000, 'packDescription'),
    deckDescription: text(spec.deckDescription, 2000, 'deckDescription'),
    deckId: identifier(spec.deckId, 'deckId'),
    attachments: normalizeAttachments(spec.attachments),
  };
}

function combineTags(first, second) {
  return [...new Set([...(first ?? []), ...(second ?? [])].map((tag) => String(tag).trim()).filter(Boolean))].slice(
    0,
    8,
  );
}

async function createBank(spec) {
  loadEnvironment();
  const input = normalizeBankSpec(spec);
  const { url, db } = database();
  await ensureBucket(db);

  const config = await engineCatalog();
  const generated = await generateDeck(input, config);
  const deck = generated.deck;
  if (!Array.isArray(deck.questions) || deck.questions.length === 0) {
    throw new OfficialError('The generation service produced no questions.');
  }

  let pack;
  let createdPack = false;
  if (input.packId) {
    const { data, error } = await db
      .from('official_packs')
      .select('id,name,published')
      .eq('id', input.packId)
      .maybeSingle();
    if (error) throw new OfficialError(`Cannot read collection ${input.packId}: ${error.message}`);
    if (!data) {
      const { data: all, error: listError } = await db
        .from('official_packs')
        .select('id,name')
        .order('sort_order', { ascending: true })
        .limit(20);
      if (listError) throw new OfficialError(`Cannot list collections: ${listError.message}`);
      throw new OfficialError(
        `Collection "${input.packId}" does not exist. Available: ${
          (all ?? []).map((row) => `${row.id} (${row.name})`).join(', ') || 'none'
        }.`,
      );
    }
    pack = data;
  } else {
    const packName = input.packName || input.title.slice(0, 80);
    pack = await insertPack(db, {
      name: packName,
      description: input.packDescription ?? input.description.slice(0, 2000),
      tags: input.tags,
      published: input.published,
    });
    createdPack = true;
  }

  const deckId = input.deckId || makeId('deck');
  if (input.deckId) {
    const { data: clash, error } = await db
      .from('official_decks')
      .select('id')
      .eq('pack_id', pack.id)
      .eq('id', deckId)
      .maybeSingle();
    if (error) throw new OfficialError(`Cannot check deck ${deckId}: ${error.message}`);
    if (clash) {
      throw new OfficialError(`Question bank "${deckId}" already exists in collection "${pack.id}".`);
    }
  }

  let staged;
  try {
    staged = await uploadMedia(db, url, deck, pack.id, deckId, input.attachments);
    const examMinutes =
      Number.isFinite(deck.examMinutes) && deck.examMinutes > 0
        ? Math.min(600, Math.max(1, Math.round(deck.examMinutes)))
        : null;
    const row = {
      pack_id: pack.id,
      id: deckId,
      title: input.title,
      description: input.deckDescription ?? deck.description ?? null,
      tags: combineTags(input.tags, deck.tags),
      questions: deck.questions,
      exam_minutes: examMinutes,
      media_base_url: staged.mediaBaseUrl,
      version: '1',
      published: input.published,
      sort_order: 0,
    };
    // sort_order is scoped per pack: each collection has its own deck order.
    const { data: sibling, error: orderError } = await db
      .from('official_decks')
      .select('sort_order')
      .eq('pack_id', pack.id)
      .order('sort_order', { ascending: false })
      .limit(1);
    if (orderError) throw new OfficialError(`Cannot read collection order: ${orderError.message}`);
    row.sort_order = sibling && sibling[0] ? Number(sibling[0].sort_order) + 1 || 0 : 0;

    const { error } = await db.from('official_decks').insert(row);
    if (error) throw new OfficialError(`Could not publish the question bank: ${error.message}`);
  } catch (error) {
    if (staged && staged.uploaded.length > 0) {
      await removeObjects(db, staged.uploaded).catch((cleanupError) => {
        log(`cleanup failed: ${cleanupError.message}`);
      });
    }
    if (createdPack) {
      await db.from('official_packs').delete().eq('id', pack.id).then(
        () => undefined,
        () => undefined,
      );
    }
    throw error;
  }

  const warnings = [
    ...(generated.failures ?? []),
    ...(Array.isArray(generated.warnings)
      ? generated.warnings.map((warning) =>
          typeof warning === 'string' ? warning : warning && warning.message ? warning.message : String(warning),
        )
      : []),
  ];
  if (input.published && pack.published === false) {
    warnings.push(
      `The collection "${pack.name}" is unpublished, so this question bank stays hidden in the Plaza until the collection is published.`,
    );
  }

  const summaryParts = [
    `${createdPack ? 'Created collection' : 'Added to collection'} "${pack.name}" (${pack.id})`,
    `question bank "${input.title}" (${pack.id}::${deckId})`,
    `${deck.questions.length} question${deck.questions.length === 1 ? '' : 's'}`,
    `${staged.figures} figure${staged.figures === 1 ? '' : 's'}`,
    `${staged.photos + staged.userImages} image${staged.photos + staged.userImages === 1 ? '' : 's'}`,
  ];

  return {
    ok: true,
    summary: `${summaryParts.join(' · ')}${input.published ? '' : ' · draft'}.`,
    collection: {
      id: pack.id,
      name: pack.name,
      published: input.published ? pack.published !== false : false,
      created: createdPack,
    },
    bank: {
      packId: pack.id,
      id: deckId,
      title: input.title,
      questions: deck.questions.length,
      examMinutes:
        Number.isFinite(deck.examMinutes) && deck.examMinutes > 0 ? Math.round(deck.examMinutes) : null,
      figures: staged.figures,
      photos: staged.photos,
      userImages: staged.userImages,
      published: input.published,
      mediaBaseUrl: staged.mediaBaseUrl,
    },
    engine: generated.engine ?? generated.candidate,
    warnings,
    catalogueVersion: await safeCatalogueVersion(db),
  };
}

async function listCatalog(spec) {
  loadEnvironment();
  const { db } = database();
  const includeUnpublished = spec.includeUnpublished === true;
  const limit = integer(spec.limit, 1, 100, 50, 'limit');
  const packId = identifier(spec.packId, 'packId');

  let packQuery = db
    .from('official_packs')
    .select('id,name,version,description,author,tags,published,sort_order,updated_at')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (packId) packQuery = packQuery.eq('id', packId);
  if (!includeUnpublished) packQuery = packQuery.eq('published', true);
  const packsResult = await packQuery;
  if (packsResult.error) throw new OfficialError(`Cannot list collections: ${packsResult.error.message}`);

  let deckQuery = db
    .from('official_decks')
    .select('pack_id,id,title,description,tags,questions,published,exam_minutes,media_base_url,sort_order,updated_at')
    .order('sort_order', { ascending: true })
    .order('title', { ascending: true });
  if (packId) deckQuery = deckQuery.eq('pack_id', packId);
  if (!includeUnpublished) deckQuery = deckQuery.eq('published', true);
  const decksResult = await deckQuery;
  if (decksResult.error) throw new OfficialError(`Cannot list question banks: ${decksResult.error.message}`);

  if (packId && (!packsResult.data || packsResult.data.length === 0)) {
    throw new OfficialError(`Collection "${packId}" was not found.`);
  }

  const byPack = new Map();
  for (const deck of decksResult.data ?? []) {
    const list = byPack.get(deck.pack_id) ?? [];
    list.push(deck);
    byPack.set(deck.pack_id, list);
  }

  const packs = (packsResult.data ?? []).slice(0, limit).map((pack) => {
    const decks = (byPack.get(pack.id) ?? []).map((deck) => {
      const questions = Array.isArray(deck.questions) ? deck.questions : [];
      let figures = 0;
      let images = 0;
      for (const question of questions) {
        for (const media of Array.isArray(question.media) ? question.media : []) {
          if (media && media.type === 'figure') figures += 1;
          else if (media && media.type === 'image') images += 1;
        }
        for (const option of Array.isArray(question.options) ? question.options : []) {
          for (const media of Array.isArray(option.media) ? option.media : []) {
            if (media && media.type === 'figure') figures += 1;
            else if (media && media.type === 'image') images += 1;
          }
        }
      }
      return {
        id: deck.id,
        title: deck.title,
        published: deck.published === true,
        questions: questions.length,
        examMinutes: deck.exam_minutes ?? null,
        figures,
        images,
        visibleInApp: pack.published === true && deck.published === true && questions.length > 0,
        updatedAt: deck.updated_at ?? null,
      };
    });
    return {
      id: pack.id,
      name: pack.name,
      published: pack.published === true,
      version: pack.version ?? null,
      description: pack.description ?? null,
      author: pack.author ?? null,
      tags: Array.isArray(pack.tags) ? pack.tags : [],
      deckCount: decks.length,
      visibleInApp: pack.published === true && decks.some((deck) => deck.visibleInApp),
      updatedAt: pack.updated_at ?? null,
      decks,
    };
  });

  const totalDecks = packs.reduce((total, pack) => total + pack.deckCount, 0);
  return {
    ok: true,
    summary:
      packs.length === 0
        ? 'No official collections match.'
        : `${packs.length} collection${packs.length === 1 ? '' : 's'}, ${totalDecks} question bank${totalDecks === 1 ? '' : 's'}${includeUnpublished ? ' (including drafts)' : ''}.`,
    packs,
    truncated: (packsResult.data ?? []).length > limit,
    catalogueVersion: await catalogueVersion(db),
  };
}

async function createCollection(spec) {
  loadEnvironment();
  const { db } = database();
  const name = text(spec.name, 80, 'name', { required: true });
  const id = identifier(spec.id, 'id');
  const row = await insertPack(db, {
    id,
    name,
    description: text(spec.description, 2000, 'description'),
    tags: tags(spec.tags),
    author: text(spec.author, 80, 'author') ?? 'MengYin Study',
    homepage: text(spec.homepage, 200, 'homepage'),
    license: text(spec.license, 80, 'license'),
    published: spec.published !== false,
    sortOrder: integer(spec.sortOrder, 0, 1_000_000, undefined, 'sortOrder'),
  });
  return {
    ok: true,
    summary: `Created collection "${row.name}" (${row.id}).${
      row.published ? ' A collection appears in the Plaza once it has at least one published question bank.' : ' It is a draft.'
    }`,
    collection: {
      id: row.id,
      name: row.name,
      description: row.description,
      published: row.published,
      tags: row.tags,
      sortOrder: row.sort_order,
    },
    catalogueVersion: await safeCatalogueVersion(db),
  };
}

async function deleteBank(spec) {
  loadEnvironment();
  const { db } = database();
  const packId = identifier(spec.packId, 'packId');
  const deckId = identifier(spec.deckId, 'deckId');
  if (!packId) throw new OfficialError('packId is required.');
  if (!deckId) throw new OfficialError('deckId is required.');
  if (spec.confirm !== true) {
    throw new OfficialError('Set confirm to true to delete a question bank.');
  }

  const { data: deck, error } = await db
    .from('official_decks')
    .select('pack_id,id,title,published')
    .eq('pack_id', packId)
    .eq('id', deckId)
    .maybeSingle();
  if (error) throw new OfficialError(`Cannot read question bank: ${error.message}`);
  if (!deck) throw new OfficialError(`Question bank "${packId}::${deckId}" was not found.`);

  if (spec.dryRun === true) {
    const files = await storageFiles(db, `${packId}/${deckId}`);
    return {
      ok: true,
      summary: `Dry run: would delete question bank "${deck.title}" (${packId}::${deckId}) and ${files.length} stored image${files.length === 1 ? '' : 's'}.`,
      dryRun: true,
      deleted: { kind: 'question_bank', packId, deckId, title: deck.title, images: files.length },
    };
  }

  const { error: deleteError } = await db
    .from('official_decks')
    .delete()
    .eq('pack_id', packId)
    .eq('id', deckId);
  if (deleteError) throw new OfficialError(`Could not delete question bank: ${deleteError.message}`);

  let removed = 0;
  const warnings = [];
  try {
    const remaining = await storageFiles(db, `${packId}/${deckId}`);
    removed = await removeObjects(db, remaining);
  } catch (error) {
    warnings.push(
      `The question bank is deleted, but its stored images could not be fully removed: ${error.message}`,
    );
  }
  const warningNote = warnings.length > 0 ? ' Image cleanup needs attention.' : '';
  return {
    ok: true,
    summary: `Deleted question bank "${deck.title}" (${packId}::${deckId}) and ${removed} stored image${removed === 1 ? '' : 's'}.${warningNote}`,
    deleted: { kind: 'question_bank', packId, deckId, title: deck.title, images: removed },
    ...(warnings.length > 0 ? { warnings } : {}),
    catalogueVersion: await safeCatalogueVersion(db),
  };
}

async function deleteCollection(spec) {
  loadEnvironment();
  const { db } = database();
  const packId = identifier(spec.packId, 'packId');
  if (!packId) throw new OfficialError('packId is required.');
  if (spec.confirm !== true) {
    throw new OfficialError('Set confirm to true to delete a collection.');
  }

  const { data: pack, error } = await db
    .from('official_packs')
    .select('id,name,published')
    .eq('id', packId)
    .maybeSingle();
  if (error) throw new OfficialError(`Cannot read collection: ${error.message}`);
  if (!pack) throw new OfficialError(`Collection "${packId}" was not found.`);
  const { data: decks, error: decksError } = await db
    .from('official_decks')
    .select('id,title')
    .eq('pack_id', packId)
    .order('sort_order', { ascending: true });
  if (decksError) throw new OfficialError(`Cannot read collection banks: ${decksError.message}`);

  if (spec.dryRun === true) {
    const files = await storageFiles(db, packId);
    return {
      ok: true,
      summary: `Dry run: would delete collection "${pack.name}" (${packId}), ${
        decks?.length ?? 0
      } question bank(s) and ${files.length} stored image(s).`,
      dryRun: true,
      deleted: {
        kind: 'collection',
        packId,
        name: pack.name,
        banks: decks?.length ?? 0,
        images: files.length,
        deckIds: (decks ?? []).map((deck) => deck.id),
      },
    };
  }

  const { error: deleteError } = await db.from('official_packs').delete().eq('id', packId);
  if (deleteError) throw new OfficialError(`Could not delete collection: ${deleteError.message}`);

  let removed = 0;
  const warnings = [];
  try {
    const remaining = await storageFiles(db, packId);
    removed = await removeObjects(db, remaining);
  } catch (error) {
    warnings.push(
      `The collection is deleted, but its stored images could not be fully removed: ${error.message}`,
    );
  }
  const warningNote = warnings.length > 0 ? ' Image cleanup needs attention.' : '';
  return {
    ok: true,
    summary: `Deleted collection "${pack.name}" (${packId}), ${decks?.length ?? 0} question bank(s) and ${removed} stored image(s).${warningNote}`,
    deleted: {
      kind: 'collection',
      packId,
      name: pack.name,
      banks: decks?.length ?? 0,
      images: removed,
      deckIds: (decks ?? []).map((deck) => deck.id),
    },
    ...(warnings.length > 0 ? { warnings } : {}),
    catalogueVersion: await safeCatalogueVersion(db),
  };
}

const COMMANDS = {
  list: listCatalog,
  'create-pack': createCollection,
  'create-bank': createBank,
  'delete-pack': deleteCollection,
  'delete-deck': deleteBank,
};

function help() {
  return [
    'Usage: node tools/official-content.mjs <command> --spec <file|->',
    '',
    'Commands:',
    '  list          List official collections and question banks',
    '  create-pack   Create an official collection (合集)',
    '  create-bank   Generate and publish an official question bank (題庫)',
    '  delete-pack   Delete a collection and every bank in it',
    '  delete-deck   Delete one question bank',
    '',
    'The spec is a JSON object on stdin when --spec is "-" or omitted.',
  ].join('\n');
}

async function main() {
  const command = process.argv[2];
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`${help()}\n`);
    return;
  }
  const handler = COMMANDS[command];
  if (!handler) throw new OfficialError(`Unknown command "${command}".\n\n${help()}`);
  const spec = await readSpec();
  const result = await handler(spec);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[official] ${message}`);
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      error: {
        message,
        ...(error && error.code ? { code: error.code } : {}),
        ...(error && error.details ? { details: error.details } : {}),
      },
    })}\n`,
  );
  process.exit(1);
});

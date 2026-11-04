#!/usr/bin/env node
/**
 * Read-only backend smoke check.
 *
 *   npm run backend:check
 *
 * Uses only the publishable key and the same REST endpoints as the browser, so
 * it proves the RLS/public-read path rather than the secret-key path.
 */
import { loadEnvFiles } from './load-env.mjs';

loadEnvFiles();

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = (
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  ''
).trim();

if (!url || !key) {
  console.error('Missing SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. See .env.example.');
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function get(path) {
  const response = await fetch(`${url}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

async function main() {
  console.log(`[backend] ${url}`);

  const health = await get('/auth/v1/health');
  console.log(`[backend] auth: ${health.status === 200 ? 'ok' : `HTTP ${health.status}`}`);

  const settings = await get('/auth/v1/settings');
  const external = settings.body && typeof settings.body === 'object' ? settings.body.external : null;
  if (settings.status === 200 && external && typeof external === 'object') {
    console.log(
      `[backend] providers: email=${external.email === true} ` +
        `google=${external.google === true} github=${external.github === true}`,
    );
  } else {
    console.log(`[backend] providers: unavailable (HTTP ${settings.status})`);
  }

  const meta = await get('/rest/v1/official_catalog_meta?select=version,updated_at&id=eq.true');
  if (meta.status !== 200 || !Array.isArray(meta.body) || meta.body.length === 0) {
    const message =
      meta.status !== 200 && meta.body && typeof meta.body === 'object' && 'message' in meta.body
        ? meta.body.message
        : meta.status !== 200
          ? `HTTP ${meta.status}`
          : 'the catalogue metadata row is missing';
    console.error(`[backend] official catalogue: not ready — ${message}`);
    console.error('[backend] Apply supabase/migrations, then run npm run seed:official.');
    process.exitCode = 1;
    return;
  }

  const version = meta.body[0].version;
  const packs = await get('/rest/v1/official_packs?select=id,name,published&order=sort_order');
  const decks = await get('/rest/v1/official_decks?select=pack_id,id,published');
  const publishedPacks = Array.isArray(packs.body) ? packs.body.filter((row) => row.published) : [];
  const publishedDecks = Array.isArray(decks.body) ? decks.body.filter((row) => row.published) : [];

  console.log(`[backend] official catalogue: v${version}`);
  console.log(`[backend] published packs: ${publishedPacks.length}`);
  console.log(`[backend] published decks: ${publishedDecks.length}`);
  if (publishedPacks.length === 0) {
    console.log('[backend] catalogue is empty — run npm run seed:official to publish plugins/.');
  }
  if (publishedPacks.length > 0 && publishedDecks.length === 0) {
    console.error('[backend] packs are published but no decks are visible; check RLS or the seed.');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[backend] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

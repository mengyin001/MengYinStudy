#!/usr/bin/env node
/**
 * Apply supabase/migrations/*.sql over a direct Postgres connection.
 *
 *   SUPABASE_DB_PASSWORD=... npm run db:migrate
 *
 * or provide a complete URL:
 *
 *   SUPABASE_DB_URL=postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:5432/postgres npm run db:migrate
 *
 * Prefer the Session pooler host (Dashboard -> Connect). Current projects expose
 * the direct `db.<ref>.supabase.co` host over IPv6 only; an IPv4-only network
 * fails with `getaddrinfo ENOTFOUND`.
 *
 * The migrations are written to be re-runnable, so this script can be used
 * instead of the Supabase CLI when the CLI/Docker is unavailable. It does not
 * write to Supabase's migration-history table; `supabase db push` remains the
 * preferred path when the CLI is available.
 *
 * Flags: --dry-run
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { loadEnvFiles, root } from './load-env.mjs';

loadEnvFiles();

const dryRun = process.argv.includes('--dry-run');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const projectRef = process.env.SUPABASE_PROJECT_REF || 'yukmxeieklwgnwdcqwpb';

function connectionString() {
  const explicit = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  if (explicit) return explicit;

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) return null;

  const host = process.env.SUPABASE_DB_HOST || `db.${projectRef}.supabase.co`;
  const port = process.env.SUPABASE_DB_PORT || '5432';
  const user = process.env.SUPABASE_DB_USER || 'postgres';
  const database = process.env.SUPABASE_DB_NAME || 'postgres';
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

async function main() {
  const url = connectionString();
  if (!url) {
    console.error('Missing database credentials.');
    console.error('Set SUPABASE_DB_HOST/USER/PASSWORD, or the full SUPABASE_DB_URL in .env.local.');
    console.error(
      'Use the Session pooler string from Dashboard -> Connect; the direct db.<ref> host is IPv6-only.',
    );
    console.error(
      'SUPABASE_DB_PASSWORD is percent-encoded automatically; encode SUPABASE_DB_URL yourself.',
    );
    process.exit(1);
  }

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.error(`No migrations found in ${migrationsDir}`);
    process.exit(1);
  }

  console.log(`[db] ${files.length} migration(s) in ${migrationsDir}`);
  if (dryRun) {
    for (const file of files) console.log(`[db] would apply ${file}`);
    return;
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log(`[db] connected to ${client.host}:${client.port}/${client.database}`);

  try {
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      console.log(`[db] applying ${file}`);
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const meta = await client.query(
      'select version, updated_at from public.official_catalog_meta where id = true',
    );
    const packs = await client.query('select count(*)::int as n from public.official_packs');
    const decks = await client.query('select count(*)::int as n from public.official_decks');
    const profiles = await client.query('select count(*)::int as n from public.profiles');
    const userDecks = await client.query('select count(*)::int as n from public.user_decks');
    const progress = await client.query('select count(*)::int as n from public.user_progress');

    console.log(
      `[db] ready: catalogue v${meta.rows[0]?.version ?? '?'}, ` +
        `${packs.rows[0]?.n ?? 0} pack(s), ${decks.rows[0]?.n ?? 0} deck(s), ` +
        `${profiles.rows[0]?.n ?? 0} profile(s), ${userDecks.rows[0]?.n ?? 0} cloud deck(s), ` +
        `${progress.rows[0]?.n ?? 0} progress snapshot(s)`,
    );
    console.log('[db] next: npm run seed:official && npm run backend:check');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`[db] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

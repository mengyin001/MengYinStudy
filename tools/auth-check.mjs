#!/usr/bin/env node
/**
 * Read-only OAuth readiness check for Google / GitHub sign-in.
 *
 *   npm run auth:check
 *   npm run auth:check -- --origin=https://mengyinstudy.example.workers.dev
 *
 * What it can prove, and what it cannot:
 *
 * - **Provider enabled** — authoritative. `GET /auth/v1/authorize` answers 400
 *   `Unsupported provider: provider is not enabled` while the Google/GitHub card
 *   is off in Supabase, and 302 to the provider once it is on.
 * - **Redirect allow-list** — **not** verifiable from here. `/authorize` accepts
 *   any `redirect_to` and returns 302 even for `https://bogus.example.com/`;
 *   GoTrue only substitutes Site URL for a non-allow-listed target at the end of
 *   the round trip. A sign-in that comes back to `http://localhost:3000` (the
 *   project default Site URL) is the symptom of exactly that.
 *
 * Uses the publishable key only and never changes anything.
 */
import { loadEnvFiles } from './load-env.mjs';

loadEnvFiles();

const args = process.argv.slice(2);
const extraOrigins = args
  .filter((arg) => arg.startsWith('--origin='))
  .map((arg) => arg.slice('--origin='.length).replace(/\/+$/, ''));
const wanted = args.filter((arg) => arg.startsWith('--provider=')).map((arg) => arg.slice(11));

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

if (key.startsWith('sb_secret_')) {
  console.error('That is a secret key. Use the publishable key; this check needs no privilege.');
  process.exit(1);
}

const PROVIDERS = {
  google: { host: 'accounts.google.com', label: 'Google' },
  github: { host: 'github.com', label: 'GitHub' },
};
const tryProviders = wanted.length > 0 ? wanted : Object.keys(PROVIDERS);
const appOrigins = [
  ...new Set([
    ...extraOrigins,
    ...(extraOrigins.length > 0 ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
  ]),
];

const headers = { apikey: key };
const callbackUrl = `${url}/auth/v1/callback`;

async function fetchJson(path) {
  const response = await fetch(`${url}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: response.status, body: null };
  }
}

async function probeAuthorize(provider, redirectTo) {
  const target = `${url}/auth/v1/authorize?provider=${provider}&redirect_to=${encodeURIComponent(
    `${redirectTo}/`,
  )}`;
  const response = await fetch(target, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  const location = response.headers.get('location') ?? '';
  let message = '';
  if (response.status >= 400) {
    const text = await response.text();
    try {
      message = JSON.parse(text).msg ?? text.slice(0, 200);
    } catch {
      message = text.slice(0, 200);
    }
  }
  return { status: response.status, location, message };
}

function classify(probe, host) {
  if (probe.status >= 300 && probe.status < 400) {
    return probe.location.toLowerCase().includes(host)
      ? { verdict: 'ok' }
      : { verdict: 'unexpected', detail: probe.location.slice(0, 120) };
  }
  if (/provider is not enabled|unsupported provider/i.test(probe.message)) {
    return { verdict: 'provider-disabled' };
  }
  return { verdict: 'error', detail: probe.message || `HTTP ${probe.status}` };
}

async function main() {
  console.log(`[auth] project:  ${url}`);
  console.log(`[auth] callback: ${callbackUrl}`);

  const settings = await fetchJson('/auth/v1/settings');
  const external =
    settings.body && typeof settings.body === 'object' && settings.body.external
      ? settings.body.external
      : null;

  if (!external) {
    console.error(`[auth] /auth/v1/settings unavailable (HTTP ${settings.status}). Check the URL/key.`);
    process.exit(1);
  }

  console.log(
    `[auth] settings: ${tryProviders
      .map((provider) => `${provider}=${external[provider] === true}`)
      .join(' ')}  email=${external.email === true}`,
  );

  const problems = [];
  if (external.email !== true) {
    problems.push('Email sign-in is off; the password form cannot work either.');
  }

  for (const provider of tryProviders) {
    if (external[provider] !== true) {
      const name = PROVIDERS[provider].label;
      console.log(`[auth] ${provider}: disabled in Supabase`);
      problems.push(
        `${name} is off: Dashboard -> Authentication -> Sign In / Providers -> ${name} -> ` +
          `enable and paste the OAuth client id + secret. Callback for the provider console: ` +
          callbackUrl,
      );
      continue;
    }
    const probe = await probeAuthorize(provider, appOrigins[0]);
    const result = classify(probe, PROVIDERS[provider].host);
    console.log(
      `[auth] ${provider}: ${result.verdict === 'ok' ? 'enabled, authorize redirects to the provider' : `${result.verdict}`}` +
        (result.verdict === 'ok' ? '' : ` (HTTP ${probe.status}${result.detail ? `: ${result.detail}` : ''})`),
    );
    if (result.verdict !== 'ok') {
      problems.push(`${PROVIDERS[provider].label} authorize failed: ${result.detail ?? probe.message}`);
    }
  }

  console.log('[auth] URL Configuration (Dashboard -> Authentication -> URL Configuration):');
  console.log(`         Site URL:      ${appOrigins[0]}`);
  for (const origin of appOrigins) console.log(`         Redirect URL:  ${origin}/**`);
  console.log('         Redirect URL:  https://<production-host>/**');

  if (problems.length > 0) {
    console.error('[auth] problems:');
    for (const problem of [...new Set(problems)]) console.error(`  - ${problem}`);
    console.error('[auth] see docs/BACKEND.md section 3, "Providers", for the console walkthrough.');
    process.exitCode = 1;
    return;
  }

  console.log(
    '[auth] providers are on. The redirect allow-list cannot be checked from here: ' +
      'Supabase accepts any redirect_to and only falls back to Site URL at the end of the ' +
      'round trip. If a sign-in lands on http://localhost:3000 (the project default Site URL) ' +
      'instead of the URL above, Site URL / Redirect URLs are still wrong.',
  );
}

main().catch((error) => {
  console.error(`[auth] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

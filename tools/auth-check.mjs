#!/usr/bin/env node
/**
 * Read-only OAuth readiness check for Google / GitHub sign-in.
 *
 *   npm run auth:check
 *   npm run auth:check -- --origin=https://mengyinstudy.example.workers.dev
 *
 * Sign-in buttons only *build* the `/auth/v1/authorize` URL (supabase-js never
 * calls it), so a half-configured project looks like "the button is broken" and
 * the browser lands on a raw JSON page. This script asks the same endpoints the
 * browser would and reports the two things that actually break OAuth:
 *
 *   1. the provider is not switched on in Supabase (needs client id + secret), or
 *   2. the app origin is missing from Authentication -> URL Configuration.
 *
 * It uses the publishable key only and never changes anything.
 */
import { loadEnvFiles } from './load-env.mjs';

loadEnvFiles();

const args = process.argv.slice(2);
const origins = args
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
  console.error('That is a secret key. Use the publishable key; OAuth probing needs no privilege.');
  process.exit(1);
}

const PROVIDERS = {
  google: { host: 'accounts.google.com', label: 'Google' },
  github: { host: 'github.com', label: 'GitHub' },
};
const tryProviders = wanted.length > 0 ? wanted : Object.keys(PROVIDERS);
const tryOrigins = origins.length > 0 ? origins : ['http://localhost:5173', 'http://127.0.0.1:5173'];

const headers = { apikey: key };
const callbackUrl = `${url}/auth/v1/callback`;

async function fetchJson(path) {
  const response = await fetch(`${url}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: text ? JSON.parse(text) : null, text };
  } catch {
    return { status: response.status, body: null, text };
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
    const lowered = probe.location.toLowerCase();
    if (lowered.includes(host)) return { verdict: 'ok' };
    if (lowered.includes('/auth/v1/callback')) return { verdict: 'ok' };
    return { verdict: 'unexpected', detail: probe.location };
  }
  if (/provider is not enabled|unsupported provider/i.test(probe.message)) {
    return { verdict: 'provider-disabled' };
  }
  if (/redirect|not allowed|invalid.*url/i.test(probe.message)) {
    return { verdict: 'redirect-not-allowed' };
  }
  return { verdict: 'error', detail: probe.message || `HTTP ${probe.status}` };
}

function providerHint(provider, classifyResult, origin) {
  const name = PROVIDERS[provider].label;
  if (classifyResult.verdict === 'ok') return null;
  if (classifyResult.verdict === 'provider-disabled') {
    return (
      `${name} is off: Dashboard -> Authentication -> Providers -> ${name} -> enable, paste ` +
      `the OAuth client id + secret. Callback URL for the provider console: ${callbackUrl}`
    );
  }
  if (classifyResult.verdict === 'redirect-not-allowed') {
    return (
      `Redirect ${origin}/** is not allow-listed: Dashboard -> Authentication -> URL ` +
      `Configuration -> Redirect URLs.`
    );
  }
  return `${name} probe failed: ${classifyResult.detail ?? 'unknown error'}.`;
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

  const enabled = tryProviders.filter((provider) => external[provider] === true);
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
      console.log(`[auth] ${provider}: disabled in Supabase (skipping redirect probe)`);
      problems.push(providerHint(provider, { verdict: 'provider-disabled' }, null));
      continue;
    }
    for (const origin of tryOrigins) {
      const probe = await probeAuthorize(provider, origin);
      const result = classify(probe, PROVIDERS[provider].host);
      console.log(
        `[auth] ${provider} + ${origin}: ${result.verdict}` +
          (result.verdict === 'ok'
            ? ''
            : ` (HTTP ${probe.status}${result.detail ? `: ${result.detail}` : ''})`),
      );
      const hint = providerHint(provider, result, origin);
      if (hint) problems.push(hint);
    }
  }

  console.log(`[auth] redirect URLs to allow-list (Authentication -> URL Configuration):`);
  for (const origin of tryOrigins) console.log(`         ${origin}/**`);
  console.log('         https://<production-host>/**');

  const unique = [...new Set(problems)];
  if (unique.length > 0) {
    console.error('[auth] problems:');
    for (const problem of unique) console.error(`  - ${problem}`);
    console.error('[auth] see docs/BACKEND.md section 3, "Providers", for the console walkthrough.');
    process.exitCode = 1;
    return;
  }
  console.log(`[auth] ${enabled.join(' + ')} ready for: ${tryOrigins.join(', ')}`);
}

main().catch((error) => {
  console.error(`[auth] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

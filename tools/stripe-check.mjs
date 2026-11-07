#!/usr/bin/env node
/**
 * Verify the Stripe key and the six subscription price ids without opening
 * Checkout. Read-only: it calls GET /v1/prices for each configured id.
 *
 *   npm run stripe:check
 *
 * Reads .env and .dev.vars the same way the local API does. A test key is fine;
 * live mode is labelled so it is hard to mix the two up. The expected amounts
 * mirror `packages/core/src/billing.ts`; update both together.
 */
import { loadDevVars, loadEnvFiles } from './load-env.mjs';

loadEnvFiles();
loadDevVars();

const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY. Set it in .dev.vars (test) or the Worker secret (live).');
  console.error('See docs/STRIPE_SETUP.md.');
  process.exit(1);
}

const mode =
  key.startsWith('sk_live_') || key.startsWith('rk_live_')
    ? 'LIVE'
    : key.startsWith('sk_test_') || key.startsWith('rk_test_')
      ? 'TEST'
      : 'unknown';
console.log(`[stripe] key mode: ${mode}`);

/** plan, interval, env variable, expected unit amount in US cents. */
const EXPECTED = [
  ['light', 'month', 'STRIPE_PRICE_LIGHT_MONTH', 499],
  ['light', 'year', 'STRIPE_PRICE_LIGHT_YEAR', 4_990],
  ['standard', 'month', 'STRIPE_PRICE_STANDARD_MONTH', 999],
  ['standard', 'year', 'STRIPE_PRICE_STANDARD_YEAR', 9_990],
  ['pro', 'month', 'STRIPE_PRICE_PRO_MONTH', 1_999],
  ['pro', 'year', 'STRIPE_PRICE_PRO_YEAR', 19_990],
];

const INTERVAL_LABEL = { month: 'month', year: 'year' };

async function getPrice(id) {
  let response;
  try {
    response = await fetch(
      `https://api.stripe.com/v1/prices/${encodeURIComponent(id)}?expand[]=product&expand[]=currency_options`,
      {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      },
    );
  } catch (error) {
    throw new Error(`Could not reach Stripe (${error instanceof Error ? error.message : String(error)}).`);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

let failures = 0;
const rows = [];

for (const [plan, interval, variable, expectedCents] of EXPECTED) {
  const id = (process.env[variable] ?? '').trim();
  if (!id) {
    failures += 1;
    rows.push({ plan, interval, id: '—', status: `missing ${variable}` });
    continue;
  }

  try {
    const price = await getPrice(id);
    const problems = [];
    if (price.unit_amount !== expectedCents) {
      problems.push(`amount ${price.unit_amount ?? 'null'} ≠ ${expectedCents}`);
    }
    if (String(price.currency ?? '').toLowerCase() !== 'usd') {
      problems.push(`currency ${price.currency ?? 'null'} ≠ usd`);
    }
    if (price.type !== 'recurring' || price.recurring?.interval !== interval) {
      problems.push(`not a recurring ${interval} price`);
    }
    if (price.active === false) problems.push('price is archived');
    if (problems.length > 0) failures += 1;
    const currencies = [
      ...new Set([
        String(price.currency ?? '').toLowerCase(),
        ...Object.keys(price.currency_options ?? {}).map((code) => code.toLowerCase()),
      ]),
    ].filter(Boolean);
    rows.push({
      plan,
      interval,
      id,
      status: problems.length === 0 ? 'ok' : problems.join('; '),
      product: price.product?.name ?? '',
      currencies,
    });
  } catch (error) {
    failures += 1;
    rows.push({ plan, interval, id, status: error instanceof Error ? error.message : String(error) });
  }
}

for (const row of rows) {
  const label = `${row.plan.padEnd(8)} ${INTERVAL_LABEL[row.interval].padEnd(5)}`;
  const currencies = Array.isArray(row.currencies) && row.currencies.length > 0
    ? ` [${row.currencies.join(', ')}]`
    : '';
  console.log(
    `[stripe] ${label} ${row.id.padEnd(24)} ${row.status}${currencies}${
      row.product ? `  (${row.product})` : ''
    }`,
  );
}

if (failures > 0) {
  console.error(`\n[stripe] ${failures} price(s) need attention. See docs/STRIPE_SETUP.md §1.`);
  process.exitCode = 1;
} else {
  console.log(`\n[stripe] all six prices match ${mode === 'LIVE' ? 'live' : 'test'} mode.`);
}

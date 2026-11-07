#!/usr/bin/env node
/**
 * Create the six subscription prices in Stripe **test mode** and write their
 * ids into `.dev.vars` as a managed block.
 *
 *   STRIPE_SECRET_KEY=sk_test_... node tools/stripe-seed-test.mjs --write
 *
 * The live values already in `.dev.vars` are kept, commented as `# [live] ...`,
 * so switching back is one edit. Refuses to run with a live key: this script
 * only ever touches the sandbox.
 *
 * Idempotent: products are matched by `metadata.mengyin_plan`, prices by
 * `lookup_key`. Re-running only fills in what is missing and never creates a
 * duplicate price for the same amount/interval.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadDevVars, root } from './load-env.mjs';

loadDevVars();

const args = new Set(process.argv.slice(2));
const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
if (!key) {
  console.error('Missing STRIPE_SECRET_KEY (test mode).');
  process.exit(1);
}
if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key (sk_test_/rk_test_).');
  process.exit(1);
}

const API = 'https://api.stripe.com/v1';

async function stripe(method, endpoint, form) {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    ...(body ? { body } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    const code = payload?.error?.code ? ` [${payload.error.code}]` : '';
    throw new Error(`${method} ${endpoint} failed: ${message}${code}`);
  }
  return payload;
}

/** plan -> display name, monthly/annual amount in US cents. Mirrors packages/core/src/billing.ts. */
const PLANS = [
  { plan: 'light', name: 'MengYin Study Light', month: 499, year: 4_990 },
  { plan: 'standard', name: 'MengYin Study Standard', month: 999, year: 9_990 },
  { plan: 'pro', name: 'MengYin Study Pro', month: 1_999, year: 19_990 },
];

const TAX_CODE = 'txcd_10103000'; // SaaS - personal use

async function findOrCreateProduct(plan, name) {
  const products = await stripe('GET', '/products?limit=100&active=true');
  const existing = (products.data ?? []).find(
    (product) => product.metadata?.mengyin_plan === plan || product.name === name,
  );
  if (existing) {
    console.log(`[seed] product ${plan}: reuse ${existing.id} (${existing.name})`);
    return existing;
  }
  const created = await stripe('POST', '/products', {
    name,
    description: `${name} subscription`,
    'metadata[mengyin_plan]': plan,
    tax_code: TAX_CODE,
  });
  console.log(`[seed] product ${plan}: created ${created.id} (${created.name})`);
  return created;
}

async function findOrCreatePrice(product, plan, interval, unitAmount) {
  const lookupKey = `mengyin_${plan}_${interval}`;
  const found = await stripe(
    'GET',
    `/prices?limit=10&active=true&lookup_keys[]=${encodeURIComponent(lookupKey)}`,
  );
  const existing = (found.data ?? [])[0];
  if (existing) {
    const ok =
      existing.unit_amount === unitAmount &&
      existing.currency === 'usd' &&
      existing.recurring?.interval === interval &&
      existing.product === product.id;
    if (ok) {
      console.log(`[seed] price   ${plan}/${interval}: reuse ${existing.id} (${lookupKey})`);
      return existing;
    }
    console.log(
      `[seed] price   ${plan}/${interval}: ${existing.id} does not match (${existing.unit_amount} ${existing.currency} ${existing.recurring?.interval}); creating a corrected price`,
    );
  }
  const created = await stripe('POST', '/prices', {
    product: product.id,
    currency: 'usd',
    unit_amount: String(unitAmount),
    'recurring[interval]': interval,
    lookup_key: lookupKey,
    transfer_lookup_key: 'true',
    nickname: `${plan} ${interval}`,
    'metadata[mengyin_plan]': plan,
    'metadata[mengyin_interval]': interval,
  });
  console.log(`[seed] price   ${plan}/${interval}: created ${created.id} (${lookupKey})`);
  return created;
}

async function ensurePortalConfiguration(products, prices) {
  const list = await stripe('GET', '/billing_portal/configurations?limit=100');
  const existing = (list.data ?? []).find((config) => config.metadata?.mengyin_portal === 'true');

  const form = {
    'business_profile[headline]': 'MengYin Study',
    'features[invoice_history][enabled]': 'true',
    'features[payment_method_update][enabled]': 'true',
    'features[subscription_cancel][enabled]': 'true',
    'features[subscription_cancel][mode]': 'at_period_end',
    'features[subscription_update][enabled]': 'true',
    'features[subscription_update][default_allowed_updates][]': 'price',
    // Upgrades take effect now and are prorated; downgrades wait for the period
    // end so the learner keeps the plan they already paid for until then.
    'features[subscription_update][proration_behavior]': 'create_prorations',
    'features[subscription_update][schedule_at_period_end][conditions][0][type]':
      'decreasing_item_amount',
    'features[subscription_update][schedule_at_period_end][conditions][1][type]':
      'shortening_interval',
    'metadata[mengyin_portal]': 'true',
  };
  PLANS.forEach((entry, index) => {
    form[`features[subscription_update][products][${index}][product]`] = products[entry.plan].id;
    form[`features[subscription_update][products][${index}][prices][0]`] =
      prices[`${entry.plan}_month`].id;
    form[`features[subscription_update][products][${index}][prices][1]`] =
      prices[`${entry.plan}_year`].id;
  });

  if (existing) {
    const updated = await stripe(
      'POST',
      `/billing_portal/configurations/${existing.id}`,
      form,
    );
    console.log(`[seed] portal: updated ${updated.id}`);
    return updated;
  }

  let created;
  try {
    created = await stripe('POST', '/billing_portal/configurations', {
      ...form,
      is_default: 'true',
    });
  } catch (error) {
    // Older API versions do not accept `is_default`; the first configuration is
    // still what the portal falls back to.
    if (!String(error.message).includes('is_default')) throw error;
    created = await stripe('POST', '/billing_portal/configurations', form);
  }
  console.log(`[seed] portal: created ${created.id}`);
  return created;
}

function quote(value) {
  return /[\s#]/.test(value) ? `"${value}"` : value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function updateDevVars(values) {
  const file = path.join(root, '.dev.vars');
  let text = readFileSync(file, 'utf8');

  const start = '# >>> STRIPE TEST MODE (managed by tools/stripe-seed-test.mjs)';
  const end = '# <<< STRIPE TEST MODE';
  const blockPattern = new RegExp(
    `\\n?${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\n?`,
    'm',
  );
  const existingBlock = blockPattern.exec(text)?.[0] ?? '';
  const existingSecret = /STRIPE_WEBHOOK_SECRET\s*=\s*(.+)/.exec(existingBlock)?.[1]?.trim();
  const webhookSecret =
    existingSecret || values.STRIPE_WEBHOOK_SECRET || `whsec_${randomBytes(32).toString('hex')}`;

  // Replace the old managed block before commenting, so re-running does not
  // accumulate "# [live] ... sk_test_..." lines inside it.
  text = text.replace(blockPattern, '\n');

  const keys = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_LIGHT_MONTH',
    'STRIPE_PRICE_LIGHT_YEAR',
    'STRIPE_PRICE_STANDARD_MONTH',
    'STRIPE_PRICE_STANDARD_YEAR',
    'STRIPE_PRICE_PRO_MONTH',
    'STRIPE_PRICE_PRO_YEAR',
  ];

  // Keep the current values as comments, but only once. Lines that are already
  // commented (including the previous live values) are left alone.
  for (const name of keys) {
    const active = new RegExp(`^(?!\\s*#)\\s*${name}\\s*=\\s*(.*)$`, 'm');
    text = text.replace(active, (_line, value) => `# [live] ${name} = ${String(value).trim()}`);
  }

  const block = [
    '',
    start,
    `# Sandbox values. Live values are the "# [live] ..." lines above.`,
    `STRIPE_SECRET_KEY = ${quote(values.STRIPE_SECRET_KEY)}`,
    `STRIPE_WEBHOOK_SECRET = ${quote(webhookSecret)}`,
    `STRIPE_PRICE_LIGHT_MONTH = ${values.STRIPE_PRICE_LIGHT_MONTH}`,
    `STRIPE_PRICE_LIGHT_YEAR = ${values.STRIPE_PRICE_LIGHT_YEAR}`,
    `STRIPE_PRICE_STANDARD_MONTH = ${values.STRIPE_PRICE_STANDARD_MONTH}`,
    `STRIPE_PRICE_STANDARD_YEAR = ${values.STRIPE_PRICE_STANDARD_YEAR}`,
    `STRIPE_PRICE_PRO_MONTH = ${values.STRIPE_PRICE_PRO_MONTH}`,
    `STRIPE_PRICE_PRO_YEAR = ${values.STRIPE_PRICE_PRO_YEAR}`,
    end,
    '',
  ].join('\n');

  writeFileSync(file, `${text.trimEnd()}\n${block}`, 'utf8');
  console.log('[seed] .dev.vars updated (live values kept as "# [live] ..." comments).');
  return webhookSecret;
}

const products = {};
const prices = {};

for (const entry of PLANS) {
  products[entry.plan] = await findOrCreateProduct(entry.plan, entry.name);
}
for (const entry of PLANS) {
  for (const interval of ['month', 'year']) {
    prices[`${entry.plan}_${interval}`] = await findOrCreatePrice(
      products[entry.plan],
      entry.plan,
      interval,
      entry[interval],
    );
  }
}

await ensurePortalConfiguration(products, prices);

const values = { STRIPE_SECRET_KEY: key };
const envNames = {
  light_month: 'STRIPE_PRICE_LIGHT_MONTH',
  light_year: 'STRIPE_PRICE_LIGHT_YEAR',
  standard_month: 'STRIPE_PRICE_STANDARD_MONTH',
  standard_year: 'STRIPE_PRICE_STANDARD_YEAR',
  pro_month: 'STRIPE_PRICE_PRO_MONTH',
  pro_year: 'STRIPE_PRICE_PRO_YEAR',
};
for (const [name, envName] of Object.entries(envNames)) values[envName] = prices[name].id;

if (args.has('--write')) {
  values.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  const webhookSecret = updateDevVars(values);
  console.log(`\n[seed] test webhook secret: ${webhookSecret}`);
}

console.log('\n[seed] summary (test mode)');
for (const entry of PLANS) {
  console.log(
    `  ${entry.plan.padEnd(8)} ${products[entry.plan].id}  month=${prices[`${entry.plan}_month`].id}  year=${prices[`${entry.plan}_year`].id}`,
  );
}
if (!args.has('--write')) {
  console.log('\nRe-run with --write to put these ids into .dev.vars.');
}

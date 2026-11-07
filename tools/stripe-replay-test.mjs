#!/usr/bin/env node
/**
 * Apply a real Stripe **test-mode** subscription to the local database without a
 * public webhook endpoint or the Stripe CLI.
 *
 *   npm run stripe:replay-test -- --email learner@example.com
 *   npm run stripe:replay-test -- --subscription sub_...
 *
 * It fetches the subscription from Stripe, signs a `customer.subscription.updated`
 * event with the local STRIPE_WEBHOOK_SECRET and POSTs it to the local API. Use it
 * after a test Checkout when `stripe listen` is not running. Refuses live keys.
 */
import { createHmac } from 'node:crypto';
import { loadDevVars } from './load-env.mjs';

loadDevVars();

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? '' : (process.argv[index + 1] ?? '').trim();
}

const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? '').trim();
const email = option('email');
const subscriptionId = option('subscription');
const apiBase = (process.env.API_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');

if (!key || (!key.startsWith('sk_test_') && !key.startsWith('rk_test_'))) {
  console.error('This script only works with a test-mode STRIPE_SECRET_KEY (sk_test_/rk_test_).');
  process.exit(1);
}
if (!webhookSecret) {
  console.error('Missing STRIPE_WEBHOOK_SECRET. Run `npm run stripe:seed-test -- --write` first.');
  process.exit(1);
}
if (!email && !subscriptionId) {
  console.error('Pass --email <stripe customer email> or --subscription <sub_...>.');
  process.exit(1);
}

async function stripe(endpoint) {
  const response = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}

let subscription;
if (subscriptionId) {
  subscription = await stripe(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
} else {
  const customers = await stripe(`/customers?limit=1&email=${encodeURIComponent(email)}`);
  const customer = customers.data?.[0];
  if (!customer) throw new Error(`No test customer with email ${email}.`);
  const subscriptions = await stripe(
    `/subscriptions?limit=20&status=all&customer=${encodeURIComponent(customer.id)}`,
  );
  subscription = (subscriptions.data ?? []).sort((a, b) => b.created - a.created)[0];
  if (!subscription) throw new Error(`No subscription for ${email}.`);
}

const userId = subscription.metadata?.user_id;
if (!userId) {
  console.error(
    'The subscription has no metadata.user_id. Start Checkout from the app so Stripe receives it, or set the metadata in the Dashboard.',
  );
  process.exit(1);
}

const event = {
  id: `evt_replay_${Date.now()}`,
  object: 'event',
  api_version: '2026-09-30',
  created: Math.floor(Date.now() / 1000),
  type: 'customer.subscription.updated',
  data: { object: subscription },
};
const raw = JSON.stringify(event);
const timestamp = Math.floor(Date.now() / 1000);
const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${raw}`).digest('hex');

const response = await fetch(`${apiBase}/api/billing/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
  body: raw,
});
const text = await response.text();
console.log(`[replay] ${subscription.id} (${subscription.status}) -> ${response.status} ${text}`);
if (!response.ok) process.exit(1);
console.log('[replay] refresh the Account page to see the updated plan and points.');

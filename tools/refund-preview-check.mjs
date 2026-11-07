#!/usr/bin/env node
/**
 * End-to-end refund check against the local preview API.
 *
 * Creates a Stripe TEST customer and subscription, a disposable Supabase user,
 * spends 100 of its 500 plan points, then calls the real billing endpoints on
 * 127.0.0.1:8787. Everything is deleted afterwards. Refuses to run with a live
 * Stripe key.
 */
import { loadDevVars, loadEnvFiles } from './load-env.mjs';

loadEnvFiles();
loadDevVars();

const stripeKey = (process.env.STRIPE_SECRET_KEY ?? '').trim();
if (!stripeKey.startsWith('sk_test_') && !stripeKey.startsWith('rk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a test-mode key.');
  process.exit(1);
}
const interval = process.argv.includes('--year') ? 'year' : 'month';
const priceVar = interval === 'year' ? 'STRIPE_PRICE_LIGHT_YEAR' : 'STRIPE_PRICE_LIGHT_MONTH';
const priceId = (process.env[priceVar] ?? '').trim();
const expectedAmountCents = interval === 'year' ? 4_906 : 399;
if (!priceId) {
  console.error(`Missing ${priceVar}.`);
  process.exit(1);
}

const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const publishable = (process.env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
const service = (process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '').trim();
if (!supabaseUrl || !publishable || !service) {
  console.error('Missing Supabase preview credentials.');
  process.exit(1);
}

const api = (process.env.REFUND_API_BASE ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const health = await fetch(`${api}/api/ai/health`).catch(() => null);
if (!health?.ok) {
  console.error(`The preview API is not running at ${api}. Start it with: npm run dev:api`);
  process.exit(1);
}
const stamp = Date.now();
const email = `refund-preview-${stamp}@example.com`;
const password = `Preview-${stamp}-Aa1!`;

async function stripe(path, form, method = 'POST') {
  const body = form ? new URLSearchParams(form).toString() : undefined;
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey}`,
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
    throw new Error(`Stripe ${method} ${path}: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

async function supa(path, { method = 'GET', body, token = service, key = service } = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${path}: ${payload?.message ?? payload?.msg ?? `HTTP ${response.status}`}`);
  }
  return payload;
}

async function apiCall(path, token, method = 'GET') {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, body: payload };
}

let userId = null;
let customerId = null;
let subscriptionId = null;

try {
  console.log('[preview] creating Stripe test customer and subscription');
  const customer = await stripe('/customers', {
    email,
    payment_method: 'pm_card_visa',
    'invoice_settings[default_payment_method]': 'pm_card_visa',
    'metadata[mengyin_preview]': 'refund',
  });
  customerId = customer.id;

  const subscription = await stripe('/subscriptions', {
    customer: customerId,
    'items[0][price]': priceId,
    payment_behavior: 'error_if_incomplete',
    'metadata[mengyin_preview]': 'refund',
    'expand[]': 'latest_invoice',
  });
  subscriptionId = subscription.id;
  const invoice = subscription.latest_invoice;
  console.log(
    `[preview] subscription ${subscription.id} status=${subscription.status} invoice=${invoice?.id} paid=${invoice?.amount_paid}`,
  );


  console.log('[preview] creating disposable Supabase user');
  const created = await supa('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: 'Refund Preview' },
    },
  });
  userId = created.id;

  const login = await supa('/auth/v1/token?grant_type=password', {
    method: 'POST',
    key: publishable,
    token: publishable,
    body: { email, password },
  });
  const accessToken = login.access_token;
  if (!accessToken) throw new Error('No access token from Supabase.');

  const periodEnd =
    subscription.current_period_end ?? subscription.items?.data?.[0]?.current_period_end;
  await supa(`/rest/v1/billing_accounts?user_id=eq.${userId}`, {
    method: 'PATCH',
    body: {
      plan: 'light',
      points: 500,
      monthly_points: 500,
      bonus_points: 0,
      lifetime_points: 500,
      images_used: 0,
      points_reset_at: new Date(stamp + 30 * 24 * 60 * 60 * 1000).toISOString(),
      period_start: new Date(stamp).toISOString(),
      period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      subscription_status: 'active',
      cancel_at_period_end: false,
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      refunded_at: null,
      refunded_invoice_id: null,
    },
  });

  console.log('[preview] spending 100 of 500 plan points');
  await supa('/rest/v1/rpc/billing_spend', {
    method: 'POST',
    token: accessToken,
    key: publishable,
    body: {
      p_points: 100,
      p_kind: 'preview',
      p_request_id: `preview-refund-${stamp}`,
      p_metadata: { check: 'refund-preview' },
    },
  });

  const quote = await apiCall('/api/billing/refund', accessToken);
  console.log(`[preview] quote HTTP ${quote.status}:`, JSON.stringify(quote.body));
  if (quote.status !== 200 || quote.body?.eligible !== true) {
    throw new Error('Expected an eligible refund quote.');
  }
  if (
    quote.body.unusedPoints !== 400 ||
    quote.body.amountCents !== expectedAmountCents ||
    quote.body.interval !== interval
  ) {
    throw new Error('Unexpected refund quote values.');
  }

  const refund = await apiCall('/api/billing/refund', accessToken, 'POST');
  console.log(`[preview] refund HTTP ${refund.status}:`, JSON.stringify(refund.body));
  if (refund.status !== 200 || refund.body?.refunded !== true) {
    throw new Error('Refund endpoint did not complete.');
  }
  if (refund.body.amountCents !== expectedAmountCents) {
    throw new Error('Unexpected refund amount.');
  }

  const retry = await apiCall('/api/billing/refund', accessToken, 'POST');
  console.log(`[preview] retry HTTP ${retry.status}:`, JSON.stringify(retry.body));
  if (
    retry.status !== 200 ||
    retry.body?.alreadyRefunded !== true ||
    retry.body?.refundId !== refund.body.refundId
  ) {
    throw new Error('Retry did not return the recorded refund.');
  }

  // Simulate a late `customer.subscription.updated` webhook. The database must
  // keep the account free and must not grant the paid allowance again.
  const late = await supa('/rest/v1/rpc/billing_set_subscription', {
    method: 'POST',
    body: {
      p_user: userId,
      p_plan: 'light',
      p_status: 'active',
      p_period_end: new Date(stamp + 30 * 24 * 60 * 60 * 1000).toISOString(),
      p_point_cap: 1000,
      p_grant_points: 500,
      p_period_key: `preview-late-${stamp}`,
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_cancel_at_period_end: false,
    },
  });
  console.log('[preview] late webhook result:', JSON.stringify(late));

  const stored = await stripe(`/refunds/${encodeURIComponent(refund.body.refundId)}`, null, 'GET');
  const canceled = await stripe(
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    null,
    'GET',
  );
  console.log(
    `[preview] Stripe refund ${stored.id} amount=${stored.amount} status=${stored.status}; subscription=${canceled.status}`,
  );
  if (
    stored.amount !== expectedAmountCents ||
    stored.status === 'failed' ||
    canceled.status !== 'canceled'
  ) {
    throw new Error('Stripe state does not match the completed refund.');
  }

  const snapshot = await supa('/rest/v1/rpc/billing_snapshot', {
    method: 'POST',
    token: accessToken,
    key: publishable,
    body: {},
  });
  console.log(
    `[preview] account after refund: plan=${snapshot.plan} points=${snapshot.points} status=${snapshot.status}`,
  );
  if (snapshot.plan !== 'free' || snapshot.points !== 0) {
    throw new Error('Account was not downgraded after the refund.');
  }

  console.log('[preview] PASS — partial refund, cancellation and downgrade all verified');
} finally {
  if (userId) {
    await supa(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch((error) => {
      console.error(`[preview] cleanup user failed: ${error.message}`);
    });
  }
  if (customerId) {
    await stripe(`/customers/${encodeURIComponent(customerId)}`, null, 'DELETE').catch((error) => {
      console.error(`[preview] cleanup Stripe customer failed: ${error.message}`);
    });
  }
}

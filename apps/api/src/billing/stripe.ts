/**
 * Minimal Stripe client.
 *
 * Only the three calls this app needs are implemented, over the REST API, so
 * the Worker bundle stays free of the Stripe SDK. The secret key never reaches
 * the browser.
 */
import type { PlanId } from '@mengyin/core';
import type { Env } from '../env';
import { badRequest, unconfigured } from '../errors';

export type BillingInterval = 'month' | 'year';

const PRICE_VARS: Record<Exclude<PlanId, 'free'>, Record<BillingInterval, keyof Env>> = {
  light: { month: 'STRIPE_PRICE_LIGHT_MONTH', year: 'STRIPE_PRICE_LIGHT_YEAR' },
  standard: { month: 'STRIPE_PRICE_STANDARD_MONTH', year: 'STRIPE_PRICE_STANDARD_YEAR' },
  pro: { month: 'STRIPE_PRICE_PRO_MONTH', year: 'STRIPE_PRICE_PRO_YEAR' },
};

function secret(env: Env): string {
  return (env.STRIPE_SECRET_KEY ?? '').trim();
}

export function stripeConfigured(env: Env): boolean {
  return Boolean(secret(env) && (env.STRIPE_WEBHOOK_SECRET ?? '').trim());
}

/** True when at least one price is configured; Checkout needs a price id. */
export function stripePricesReady(env: Env): boolean {
  if (!secret(env)) return false;
  return (Object.keys(PRICE_VARS) as Array<Exclude<PlanId, 'free'>>).some((plan) =>
    (['month', 'year'] as const).some((interval) => priceIdFor(env, plan, interval) !== null),
  );
}

export function priceIdFor(env: Env, plan: PlanId, interval: BillingInterval): string | null {
  if (plan === 'free') return null;
  const variable = PRICE_VARS[plan][interval];
  const value = (env[variable] as string | undefined)?.trim();
  return value ? value : null;
}

export function planForPrice(env: Env, priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null;
  for (const plan of Object.keys(PRICE_VARS) as Array<Exclude<PlanId, 'free'>>) {
    for (const interval of ['month', 'year'] as const) {
      if (priceIdFor(env, plan, interval) === priceId) return plan;
    }
  }
  return null;
}

interface StripeErrorBody {
  error?: { message?: string; type?: string };
}

/** Shown on Stripe's hosted Checkout page; keep in sync with the web support address. */
const SUPPORT_EMAIL = 'mengyinqwq@gmail.com';

async function stripeRequest<T>(
  env: Env,
  path: string,
  form: Record<string, string> | null,
  method: 'GET' | 'POST' | 'DELETE' = 'POST',
  idempotencyKey?: string,
): Promise<T> {
  const key = secret(env);
  if (!key) throw unconfigured('Stripe is not configured on this server.');

  let response: Response;
  try {
    response = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        Accept: 'application/json',
      },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
    });
  } catch (error) {
    throw unconfigured(
      `Could not reach Stripe (${error instanceof Error ? error.message : String(error)}).`,
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    const message = (payload as StripeErrorBody)?.error?.message;
    throw unconfigured(`Stripe rejected the request: ${message ?? `HTTP ${response.status}`}`);
  }
  return payload as T;
}

function siteOrigin(env: Env, requestOrigin: string): string {
  const configured = (env.APP_URL ?? '').trim().replace(/\/+$/, '');
  return configured || requestOrigin.replace(/\/+$/, '');
}

export interface CheckoutInput {
  userId: string;
  plan: PlanId;
  interval: BillingInterval;
  customerId: string | null;
  requestOrigin: string;
}

export async function createCheckoutSession(env: Env, input: CheckoutInput): Promise<string> {
  const price = priceIdFor(env, input.plan, input.interval);
  if (!price) {
    throw unconfigured(
      `No Stripe price is configured for the ${input.plan} plan (${input.interval}).`,
    );
  }
  const origin = siteOrigin(env, input.requestOrigin);
  const form: Record<string, string> = {
    mode: 'subscription',
    'line_items[0][price]': price,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/#/pricing?checkout=success`,
    cancel_url: `${origin}/#/pricing?checkout=cancelled`,
    client_reference_id: input.userId,
    allow_promotion_codes: 'true',
    // Let Checkout present the customer's local currency and convert from the
    // USD price at Stripe's rate. This is per session, so it also works before
    // the Dashboard default is enabled.
    'adaptive_pricing[enabled]': 'true',
    'subscription_data[metadata][user_id]': input.userId,
    'subscription_data[metadata][plan]': input.plan,
    'subscription_data[metadata][interval]': input.interval,
    'metadata[user_id]': input.userId,
    'metadata[plan]': input.plan,
    'custom_text[submit][message]': `Payment or subscription questions? Email ${SUPPORT_EMAIL}.`,
  };
  if (input.customerId) form.customer = input.customerId;

  const session = await stripeRequest<{ url?: string }>(env, '/checkout/sessions', form);
  if (!session.url) throw unconfigured('Stripe did not return a checkout URL.');
  return session.url;
}

/**
 * Stop a subscription renewing. Used when an account is deleted: the learner
 * loses access now, but the already-paid period is not refunded and Stripe must
 * not charge again after the account row is gone.
 */
export async function cancelSubscriptionAtPeriodEnd(
  env: Env,
  subscriptionId: string,
): Promise<void> {
  await stripeRequest<Record<string, unknown>>(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { cancel_at_period_end: 'true' },
  );
}

export async function createPortalSession(
  env: Env,
  customerId: string,
  requestOrigin: string,
): Promise<string> {
  const origin = siteOrigin(env, requestOrigin);
  const session = await stripeRequest<{ url?: string }>(env, '/billing_portal/sessions', {
    customer: customerId,
    return_url: `${origin}/#/pricing`,
  });
  if (!session.url) throw unconfigured('Stripe did not return a portal URL.');
  return session.url;
}

/**
 * Read one subscription. The webhook needs the authoritative period end and
 * status, which the invoice and checkout payloads do not always carry.
 */
export async function fetchSubscription(
  env: Env,
  subscriptionId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await stripeRequest<Record<string, unknown>>(
      env,
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
      null,
      'GET',
    );
  } catch {
    // A deleted subscription returns 404; the caller falls back to the event.
    return null;
  }
}

/** Read the first invoice for a subscription, with its refundable references. */
export async function fetchInvoice(
  env: Env,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await stripeRequest<Record<string, unknown>>(
      env,
      // Stripe's 2025-03-31 API moved the payment reference to
      // `payments.data[].payment`; older accounts still expose `charge`.
      `/invoices/${encodeURIComponent(invoiceId)}?expand[]=payments&expand[]=charge&expand[]=payment_intent`,
      null,
      'GET',
    );
  } catch {
    return null;
  }
}

export interface StripeRefundResult {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export interface CreateRefundInput {
  /** One of these identifies the original payment. */
  paymentIntentId?: string | null;
  chargeId?: string | null;
  amountCents: number;
  /** A stable key for this invoice/amount, so a retry returns the same refund. */
  idempotencyKey: string;
  metadata?: Record<string, string>;
}

/**
 * Refund part of the latest subscription payment. `reason` is deliberately
 * `requested_by_customer`: the learner asked for it from the account page.
 */
export async function createRefund(
  env: Env,
  input: CreateRefundInput,
): Promise<StripeRefundResult> {
  const form: Record<string, string> = {
    amount: String(Math.max(0, Math.round(input.amountCents))),
    reason: 'requested_by_customer',
  };
  if (input.paymentIntentId) form.payment_intent = input.paymentIntentId;
  else if (input.chargeId) form.charge = input.chargeId;
  else throw unconfigured('The paid invoice has no refundable payment reference.');

  for (const [key, value] of Object.entries(input.metadata ?? {})) {
    form[`metadata[${key}]`] = value;
  }

  const refund = await stripeRequest<StripeRefundResult>(
    env,
    '/refunds',
    form,
    'POST',
    input.idempotencyKey,
  );
  return {
    id: refund.id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
  };
}

/** Sum successful or pending refunds for a payment intent. */
export async function refundedCentsForPaymentIntent(
  env: Env,
  paymentIntentId: string,
): Promise<number> {
  const payload = await stripeRequest<{ data?: Array<{ amount?: number; status?: string }> }>(
    env,
    `/refunds?payment_intent=${encodeURIComponent(paymentIntentId)}&limit=100`,
    null,
    'GET',
  );
  return (payload.data ?? []).reduce((total, refund) => {
    if (refund.status === 'failed' || refund.status === 'canceled') return total;
    return total + (typeof refund.amount === 'number' ? refund.amount : 0);
  }, 0);
}

/**
 * Cancel immediately after a refund. The subscription has already been paid
 * for, so the account is downgraded by the caller as soon as this returns.
 */
export async function cancelSubscriptionNow(env: Env, subscriptionId: string): Promise<void> {
  await stripeRequest<Record<string, unknown>>(
    env,
    `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    null,
    'DELETE',
  );
}

// -- Webhook verification ---------------------------------------------------

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseSignature(header: string): { timestamp: number; signatures: string[] } | null {
  let timestamp = 0;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=').map((piece) => piece.trim());
    if (key === 't' && value) timestamp = Number(value) || 0;
    if (key === 'v1' && value) signatures.push(value);
  }
  return timestamp > 0 && signatures.length > 0 ? { timestamp, signatures } : null;
}

/**
 * Verify `Stripe-Signature` for the raw body and return the parsed event.
 * Throws when the body was not signed with this endpoint's secret.
 */
export async function verifyWebhook(
  env: Env,
  rawBody: string,
  signatureHeader: string,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  const webhookSecret = (env.STRIPE_WEBHOOK_SECRET ?? '').trim();
  if (!webhookSecret) throw unconfigured('STRIPE_WEBHOOK_SECRET is not configured.');

  const parsed = parseSignature(signatureHeader);
  if (!parsed) throw badRequest('Missing or malformed Stripe-Signature header.');

  // Reject a replayed old signature. Stripe's own tolerance is five minutes.
  if (Math.abs(now / 1000 - parsed.timestamp) > 300) {
    throw badRequest('The Stripe signature has expired.');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const expected = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${parsed.timestamp}.${rawBody}`)),
  );

  const matches = parsed.signatures.some((candidate) => {
    if (candidate.length !== expected.length) return false;
    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) {
      diff |= expected.charCodeAt(index) ^ candidate.charCodeAt(index);
    }
    return diff === 0;
  });
  if (!matches) throw badRequest('The Stripe signature does not match this endpoint.');

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw badRequest('The Stripe event body is not JSON.');
  }
  if (!event || typeof event !== 'object') throw badRequest('The Stripe event body is not JSON.');
  return event as Record<string, unknown>;
}

/**
 * Billing HTTP handlers. Thin: validation and Stripe shapes live here, while
 * the ledger stays behind the RPCs in `store.ts`.
 */
import {
  DEFAULT_MODEL_POINTS,
  IMAGE_POINTS,
  MATERIAL_TIERS,
  MODEL_POINT_COSTS,
  PLANS,
  isPlanId,
  planFor,
  type PlanId,
} from '@mengyin/core';
import type { Env } from '../env';
import type { AuthContext } from '../http/auth';
import { badRequest, unconfigured } from '../errors';
import {
  applyRefundStatus,
  applySubscription,
  billingConfigured,
  billingEnforced,
  claimStripeEvent,
  finalizeRefund,
  finishStripeEvent,
  isBillingUnavailable,
  isRefundStatus,
  latestRecordedRefund,
  readSnapshot,
  recordedRefund,
  releaseStripeEvent,
  serviceKey,
  userIdForCustomer,
  type BillingSnapshot,
  type RefundRecord,
  type RefundStatus,
} from './store';
import {
  cancelSubscriptionAtPeriodEnd,
  cancelSubscriptionNow,
  createCheckoutSession,
  createPortalSession,
  createRefund,
  fetchInvoice,
  fetchSubscription,
  planForPrice,
  priceIdFor,
  stripeConfigured,
  stripePricesReady,
  verifyWebhook,
  type BillingInterval,
} from './stripe';
import {
  calculateRefundQuote,
  REFUND_WINDOW_DAYS,
  type RefundQuote,
  type RefundReason,
} from './refund';

export function billingConfig(env: Env) {
  return {
    plans: PLANS,
    pointCosts: MODEL_POINT_COSTS,
    defaultModelPoints: DEFAULT_MODEL_POINTS,
    imagePoints: IMAGE_POINTS,
    materialTiers: MATERIAL_TIERS,
    enforced: billingEnforced(env),
    configured: billingConfigured(env),
    stripeReady: stripePricesReady(env) && stripeConfigured(env),
  };
}

export interface BillingRefundSummary {
  status: RefundStatus;
  amountCents: number;
  currency: string;
  failureReason: string | null;
  createdAt: string | null;
}

export interface BillingMe {
  plan: PlanId;
  /** True when a paid plan's subscription is currently valid. */
  membershipActive: boolean;
  /** Total usable points: plan points plus the bonus bucket. */
  points: number;
  /** Plan points only; replaced at each monthly reset. */
  planPoints: number;
  /** Purchased or admin-granted points; the monthly reset never clears them. */
  bonusPoints: number;
  /** Plan points granted at each monthly reset; 0 on the free plan. */
  monthlyPoints: number;
  /** Next monthly reset, or null when none is scheduled. */
  pointsResetAt: string | null;
  lifetimePoints: number;
  imagesUsed: number;
  imagesPerMonth: number;
  /** Free-plan questions used this calendar month. */
  questionsUsed: number;
  /** Free-plan monthly question limit; 0 for a paid plan. */
  questionsLimit: number;
  /** Questions left on the free plan; null when points are the cap. */
  questionsRemaining: number | null;
  questionsResetAt: string | null;
  periodEnd: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  /** The latest refund for this account, if one was requested. */
  latestRefund: BillingRefundSummary | null;
  enforced: boolean;
  stripeReady: boolean;
}

function freeMe(stripeReady: boolean): BillingMe {
  const plan = planFor('free');
  return {
    plan: 'free',
    membershipActive: true,
    points: 0,
    planPoints: 0,
    bonusPoints: 0,
    monthlyPoints: 0,
    pointsResetAt: null,
    lifetimePoints: 0,
    imagesUsed: 0,
    imagesPerMonth: plan.imagesPerMonth,
    questionsUsed: 0,
    questionsLimit: plan.monthlyQuestions,
    questionsRemaining: plan.monthlyQuestions,
    questionsResetAt: null,
    periodEnd: null,
    status: null,
    cancelAtPeriodEnd: false,
    latestRefund: null,
    enforced: false,
    stripeReady,
  };
}

export async function billingMe(env: Env, auth: AuthContext): Promise<BillingMe> {
  const enforced = billingEnforced(env) && Boolean(auth.userId);
  const stripeReady = stripePricesReady(env) && stripeConfigured(env);

  if (!billingConfigured(env) || !auth.userId) {
    return freeMe(stripeReady);
  }

  try {
    const snapshot = await readSnapshot(env, auth);
    const me = meFromSnapshot(snapshot, enforced, stripeReady);
    try {
      const record = await latestRecordedRefund(env, auth.userId);
      if (record) {
        return {
          ...me,
          latestRefund: {
            status: record.status,
            amountCents: record.amountCents,
            currency: record.currency,
            failureReason: record.failureReason,
            createdAt: record.createdAt,
          },
        };
      }
    } catch {
      // The refund table may not be migrated yet; the plan snapshot still works.
    }
    return me;
  } catch (error) {
    if (isBillingUnavailable(error)) {
      // The migration may not be applied yet. Show a free plan rather than
      // failing the account page; generation fails closed if enforcement is on.
      return { ...freeMe(stripeReady), enforced };
    }
    throw error;
  }
}

/** Map a database snapshot to the account payload; kept pure so it is testable. */
export function meFromSnapshot(
  snapshot: BillingSnapshot,
  enforced: boolean,
  stripeReady: boolean,
): BillingMe {
  const plan = planFor(snapshot.plan);
  const questionsLimit = plan.monthlyQuestions;
  return {
    plan: snapshot.plan,
    membershipActive: snapshot.membershipActive,
    points: snapshot.points,
    planPoints: snapshot.planPoints,
    bonusPoints: snapshot.bonusPoints,
    monthlyPoints: snapshot.monthlyPoints,
    pointsResetAt: snapshot.pointsResetAt,
    lifetimePoints: snapshot.lifetimePoints,
    imagesUsed: snapshot.imagesUsed,
    imagesPerMonth: plan.imagesPerMonth,
    questionsUsed: snapshot.questionsUsed,
    questionsLimit,
    questionsRemaining:
      questionsLimit > 0 ? Math.max(0, questionsLimit - snapshot.questionsUsed) : null,
    questionsResetAt: snapshot.questionsResetAt,
    periodEnd: snapshot.periodEnd,
    status: snapshot.status,
    cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd,
    latestRefund: null,
    enforced,
    stripeReady,
  };
}

function intervalOf(value: unknown): BillingInterval {
  return value === 'year' ? 'year' : 'month';
}

/**
 * A live subscription must not go through Checkout again: Stripe would create a
 * second subscription while the first keeps charging. Existing subscribers
 * change plans in the Customer Portal instead. Past-due and unpaid subscriptions
 * are still live — the portal is where the card gets fixed.
 */
const OPEN_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'paused']);

export function hasLiveSubscription(
  snapshot: Pick<BillingSnapshot, 'membershipActive' | 'status' | 'stripeSubscriptionId'>,
): boolean {
  if (!snapshot.stripeSubscriptionId) return false;
  if (snapshot.membershipActive) return true;
  return OPEN_SUBSCRIPTION_STATUSES.has(snapshot.status ?? '');
}

export async function startCheckout(
  env: Env,
  auth: AuthContext,
  body: Record<string, unknown>,
  requestOrigin: string,
): Promise<{ url: string }> {
  if (!auth.userId) throw badRequest('Sign in to subscribe.');
  const planId = body.plan;
  if (!isPlanId(planId) || planId === 'free') throw badRequest('Choose a paid plan.');
  const interval = intervalOf(body.interval);
  if (!priceIdFor(env, planId, interval)) {
    throw unconfigured(`No Stripe price is configured for ${planId} (${interval}).`);
  }

  const snapshot = await readSnapshot(env, auth).catch(() => null);
  if (snapshot && hasLiveSubscription(snapshot)) {
    if (!snapshot.stripeCustomerId) {
      throw badRequest(
        'This account already has a subscription but no billing customer. Contact support to change it.',
      );
    }
    return { url: await createPortalSession(env, snapshot.stripeCustomerId, requestOrigin) };
  }

  const url = await createCheckoutSession(env, {
    userId: auth.userId,
    plan: planId,
    interval,
    customerId: snapshot?.stripeCustomerId ?? null,
    requestOrigin,
  });
  return { url };
}

export async function startPortal(
  env: Env,
  auth: AuthContext,
  requestOrigin: string,
): Promise<{ url: string }> {
  if (!auth.userId) throw badRequest('Sign in to manage a subscription.');
  const snapshot = await readSnapshot(env, auth);
  if (!snapshot.stripeCustomerId) {
    throw unconfigured('This account has no Stripe customer yet. Subscribe first.');
  }
  return { url: await createPortalSession(env, snapshot.stripeCustomerId, requestOrigin) };
}

/** True when deleting the account must also stop a live Stripe subscription. */
export function shouldCancelSubscription(
  snapshot: Pick<BillingSnapshot, 'stripeSubscriptionId' | 'status' | 'cancelAtPeriodEnd'>,
): boolean {
  if (!snapshot.stripeSubscriptionId) return false;
  if (snapshot.status === 'canceled' || snapshot.status === 'incomplete_expired') return false;
  return !snapshot.cancelAtPeriodEnd;
}

/**
 * Cancel renewal before the account row is deleted. The account is removed by
 * the browser's Supabase RPC immediately afterwards, so this has to happen
 * server-side while the Stripe identifiers still exist.
 */
export async function cancelSubscription(
  env: Env,
  auth: AuthContext,
): Promise<{ canceled: boolean }> {
  if (!auth.userId) throw badRequest('Sign in to cancel a subscription.');
  const snapshot = await readSnapshot(env, auth);
  if (!shouldCancelSubscription(snapshot) || !snapshot.stripeSubscriptionId) {
    return { canceled: false };
  }
  await cancelSubscriptionAtPeriodEnd(env, snapshot.stripeSubscriptionId);
  return { canceled: true };
}

// -- Refunds -----------------------------------------------------------------

export interface RefundQuoteView extends RefundQuote {
  currency: string;
  /** The automatic refund window, repeated here so the UI does not hard-code it. */
  windowDays: number;
}

function blockedQuote(
  reason: RefundReason,
  overrides: Partial<RefundQuote> = {},
): RefundQuote {
  return {
    eligible: false,
    reason,
    paidCents: 0,
    amountCents: 0,
    unusedRatio: 0,
    refundRatio: 0,
    unusedPoints: 0,
    monthlyPoints: 0,
    interval: 'month',
    windowEndsAt: null,
    ...overrides,
  };
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function nestedId(value: unknown): string {
  if (typeof value === 'string') return value;
  return asString(asRecord(value).id);
}

/**
 * Stripe moved `invoice.subscription` to
 * `invoice.parent.subscription_details.subscription` in the 2025-03-31 API.
 * Read both so invoice events work on either account API version.
 */
export function invoiceSubscriptionId(invoice: Record<string, unknown>): string {
  const direct = nestedId(invoice.subscription);
  if (direct) return direct;
  return asString(asRecord(asRecord(invoice.parent).subscription_details).subscription);
}

interface InvoicePaymentIds {
  paymentIntentId: string | null;
  chargeId: string | null;
}

/**
 * The invoice's payment is `payments.data[0].payment` on newer API versions
 * and `payment_intent`/`charge` on older ones.
 */
export function invoicePaymentIds(invoice: Record<string, unknown>): InvoicePaymentIds {
  const payments = asRecord(invoice.payments);
  const first = Array.isArray(payments.data) ? payments.data[0] : null;
  const payment = asRecord(asRecord(first).payment);
  const paymentIntentId =
    nestedId(payment.payment_intent) || nestedId(invoice.payment_intent) || null;
  const chargeId = nestedId(payment.charge) || nestedId(invoice.charge) || null;
  return { paymentIntentId, chargeId };
}

export function subscriptionInterval(subscription: Record<string, unknown>): BillingInterval {
  const items = asRecord(subscription.items);
  const first = Array.isArray(items.data) ? items.data[0] : null;
  const recurring = asRecord(asRecord(asRecord(first).price).recurring);
  return asString(recurring.interval) === 'year' ? 'year' : 'month';
}

interface RefundContext {
  quote: RefundQuote;
  currency: string;
  invoiceId: string;
  paymentIntentId: string | null;
  chargeId: string | null;
  subscriptionId: string;
  record: RefundRecord | null;
}

/**
 * Read the one invoice the automatic flow may refund: the first successful
 * subscription invoice. A later invoice, a plan-change proration or a missing
 * payment reference is sent to support rather than guessed at.
 */
async function buildRefundContext(
  env: Env,
  auth: AuthContext,
  now: number,
): Promise<RefundContext> {
  const snapshot = await readSnapshot(env, auth);

  // A retry after a dropped response must be able to return the refund that
  // was already recorded, even though the account is now on the free plan.
  const previous = await latestRecordedRefund(env, auth.userId ?? '');
  if (
    previous?.subscriptionId &&
    snapshot.stripeSubscriptionId &&
    previous.subscriptionId === snapshot.stripeSubscriptionId
  ) {
    const priorSubscription = await fetchSubscription(env, previous.subscriptionId);
    return {
      quote: blockedQuote('already_refunded', {
        interval: priorSubscription ? subscriptionInterval(priorSubscription) : 'month',
        unusedPoints: previous.unusedPoints,
        monthlyPoints: previous.monthlyPoints,
        unusedRatio:
          previous.monthlyPoints > 0 ? previous.unusedPoints / previous.monthlyPoints : 0,
        refundRatio: previous.refundRatio,
      }),
      currency: previous.currency,
      invoiceId: previous.invoiceId ?? '',
      paymentIntentId: null,
      chargeId: null,
      subscriptionId: previous.subscriptionId,
      record: previous,
    };
  }

  if (!snapshot.stripeSubscriptionId || snapshot.plan === 'free') {
    return {
      quote: blockedQuote('not_paid'),
      currency: 'usd',
      invoiceId: '',
      paymentIntentId: null,
      chargeId: null,
      subscriptionId: '',
      record: null,
    };
  }
  if (!snapshot.membershipActive) {
    return {
      quote: blockedQuote('not_active'),
      currency: 'usd',
      invoiceId: '',
      paymentIntentId: null,
      chargeId: null,
      subscriptionId: snapshot.stripeSubscriptionId,
      record: null,
    };
  }

  const subscription = await fetchSubscription(env, snapshot.stripeSubscriptionId);
  if (!subscription) {
    return {
      quote: blockedQuote('not_active'),
      currency: 'usd',
      invoiceId: '',
      paymentIntentId: null,
      chargeId: null,
      subscriptionId: snapshot.stripeSubscriptionId,
      record: null,
    };
  }

  const subscriptionId = asString(subscription.id) || snapshot.stripeSubscriptionId;
  const created = numberValue(subscription.created);
  const interval = subscriptionInterval(subscription);
  const status = asString(subscription.status);
  const windowEndsAt =
    created > 0
      ? new Date(created * 1000 + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const invoiceId = nestedId(subscription.latest_invoice);
  if (!invoiceId) {
    return {
      quote: blockedQuote('no_payment', { interval, windowEndsAt }),
      currency: 'usd',
      invoiceId: '',
      paymentIntentId: null,
      chargeId: null,
      subscriptionId,
      record: null,
    };
  }

  const invoice = await fetchInvoice(env, invoiceId);
  if (!invoice) {
    return {
      quote: blockedQuote('unavailable', { interval, windowEndsAt }),
      currency: 'usd',
      invoiceId,
      paymentIntentId: null,
      chargeId: null,
      subscriptionId,
      record: null,
    };
  }

  const invoiceSubscription = invoiceSubscriptionId(invoice);
  const billingReason = asString(invoice.billing_reason);
  const paidCents = numberValue(invoice.amount_paid);
  const currency = asString(invoice.currency) || 'usd';
  const { paymentIntentId, chargeId } = invoicePaymentIds(invoice);

  if (
    (invoiceSubscription && invoiceSubscription !== subscriptionId) ||
    (billingReason && billingReason !== 'subscription_create')
  ) {
    return {
      quote: blockedQuote('unsupported_invoice', {
        interval,
        paidCents,
        windowEndsAt,
      }),
      currency,
      invoiceId,
      paymentIntentId,
      chargeId,
      subscriptionId,
      record: null,
    };
  }

  const record = await recordedRefund(env, auth.userId ?? '', invoiceId);
  const quote = calculateRefundQuote({
    now,
    subscriptionCreatedAt: created > 0 ? created : null,
    status,
    interval,
    paidCents,
    planPoints: snapshot.planPoints,
    monthlyPoints: snapshot.monthlyPoints,
  });

  if (record) {
    return {
      quote: {
        ...quote,
        eligible: false,
        reason: 'already_refunded',
        amountCents: 0,
      },
      currency: record.currency || currency,
      invoiceId,
      paymentIntentId,
      chargeId,
      subscriptionId,
      record,
    };
  }

  if (quote.eligible && !paymentIntentId && !chargeId) {
    return {
      quote: blockedQuote('unsupported_invoice', {
        interval,
        paidCents,
        unusedRatio: quote.unusedRatio,
        refundRatio: quote.refundRatio,
        unusedPoints: quote.unusedPoints,
        monthlyPoints: quote.monthlyPoints,
        windowEndsAt,
      }),
      currency,
      invoiceId,
      paymentIntentId,
      chargeId,
      subscriptionId,
      record: null,
    };
  }

  return {
    quote,
    currency,
    invoiceId,
    paymentIntentId,
    chargeId,
    subscriptionId,
    record: null,
  };
}

const REFUND_REASON_TEXT: Record<RefundReason, string> = {
  not_paid: 'There is no paid subscription to refund on this account.',
  not_active: 'The subscription is not active, so it cannot be refunded automatically.',
  outside_window:
    `The automatic refund window is ${REFUND_WINDOW_DAYS} days from the first payment. Contact support to discuss your options.`,
  no_payment: 'No paid invoice was found for this subscription.',
  no_plan_points: 'This plan has no monthly plan points to measure the refund against.',
  no_unused_points:
    'All plan points for this period have been used, so there is no unused portion to refund. You can still cancel from Manage billing.',
  unsupported_invoice:
    'This invoice cannot be refunded automatically. Contact support and we will review it.',
  already_refunded: 'This payment has already been refunded.',
  unavailable: 'The payment details are temporarily unavailable. Try again shortly.',
};

export async function getRefundQuote(
  env: Env,
  auth: AuthContext,
  now = Date.now(),
): Promise<RefundQuoteView> {
  const context = await buildRefundContext(env, auth, now);
  return {
    ...context.quote,
    currency: context.currency,
    windowDays: REFUND_WINDOW_DAYS,
  };
}

export interface RefundReceipt {
  refunded: true;
  alreadyRefunded: boolean;
  refundId: string;
  amountCents: number;
  paidCents: number;
  currency: string;
  unusedPoints: number;
  monthlyPoints: number;
  unusedRatio: number;
  refundRatio: number;
  interval: 'month' | 'year';
  status: RefundStatus;
  subscriptionCanceled: boolean;
}

export async function startRefund(
  env: Env,
  auth: AuthContext,
  now = Date.now(),
): Promise<RefundReceipt> {
  const context = await buildRefundContext(env, auth, now);

  // A retry after a dropped response must return the recorded refund, not
  // attempt a second one.
  if (context.record) {
    return {
      refunded: true,
      alreadyRefunded: true,
      refundId: context.record.refundId,
      amountCents: context.record.amountCents,
      paidCents: 0,
      currency: context.record.currency,
      unusedPoints: context.record.unusedPoints,
      monthlyPoints: context.record.monthlyPoints,
      unusedRatio:
        context.record.monthlyPoints > 0
          ? context.record.unusedPoints / context.record.monthlyPoints
          : 0,
      refundRatio: context.record.refundRatio,
      interval: context.quote.interval,
      status: context.record.status,
      subscriptionCanceled: false,
    };
  }

  if (!context.quote.eligible) {
    throw badRequest(REFUND_REASON_TEXT[context.quote.reason ?? 'unavailable']);
  }

  const refund = await createRefund(env, {
    paymentIntentId: context.paymentIntentId,
    chargeId: context.chargeId,
    amountCents: context.quote.amountCents,
    idempotencyKey: `mengyin-refund-${context.invoiceId}-${context.quote.amountCents}-${context.quote.unusedPoints}`,
    metadata: {
      invoice_id: context.invoiceId,
      user_id: auth.userId ?? '',
    },
  });

  const refundStatus: RefundStatus = isRefundStatus(refund.status) ? refund.status : 'pending';
  if (refundStatus === 'failed' || refundStatus === 'canceled') {
    throw badRequest('Stripe could not complete the refund. Contact support and we will help.');
  }

  // Try to end access immediately. If Stripe refuses, at least stop renewal at
  // the period end; the database marker below still prevents a late webhook
  // from restoring the paid plan.
  let subscriptionCanceled = true;
  try {
    await cancelSubscriptionNow(env, context.subscriptionId);
  } catch {
    subscriptionCanceled = false;
    await cancelSubscriptionAtPeriodEnd(env, context.subscriptionId).catch(() => undefined);
  }

  await finalizeRefund(env, {
    userId: auth.userId ?? '',
    refundId: refund.id,
    invoiceId: context.invoiceId,
    subscriptionId: context.subscriptionId,
    amountCents: refund.amount,
    currency: refund.currency || context.currency,
    unusedPoints: context.quote.unusedPoints,
    monthlyPoints: context.quote.monthlyPoints,
    refundRatio: context.quote.refundRatio,
    reason: 'requested_by_customer',
    status: refundStatus,
  });

  return {
    refunded: true,
    alreadyRefunded: false,
    refundId: refund.id,
    amountCents: refund.amount,
    paidCents: context.quote.paidCents,
    currency: refund.currency || context.currency,
    unusedPoints: context.quote.unusedPoints,
    monthlyPoints: context.quote.monthlyPoints,
    unusedRatio: context.quote.unusedRatio,
    refundRatio: context.quote.refundRatio,
    interval: context.quote.interval,
    status: refundStatus,
    subscriptionCanceled,
  };
}

// -- Webhook -----------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function metadataValue(subscription: Record<string, unknown>, key: string): string {
  return asString(asRecord(subscription.metadata)[key]);
}

/**
 * Stripe moved `current_period_end` from the subscription to its items in the
 * 2025-03-31 API version. Read both shapes: a new account's default API version
 * otherwise returns no period end, and the monthly point grant is skipped.
 */
export function periodEndFrom(subscription: Record<string, unknown>): string | null {
  const direct = subscription.current_period_end;
  if (typeof direct === 'number' && Number.isFinite(direct) && direct > 0) {
    return new Date(direct * 1000).toISOString();
  }
  const items = asRecord(subscription.items);
  const first = Array.isArray(items.data) ? items.data[0] : null;
  const itemEnd = asRecord(first).current_period_end;
  if (typeof itemEnd === 'number' && Number.isFinite(itemEnd) && itemEnd > 0) {
    return new Date(itemEnd * 1000).toISOString();
  }
  return null;
}

/**
 * The price is the source of truth: the Customer Portal swaps the subscription
 * item but leaves `metadata.plan` at the value Checkout wrote. Reading metadata
 * first made an upgrade charge the new plan while the account stayed on the old
 * one. Metadata remains the fallback for a price that is not in this deployment's
 * catalogue.
 */
export function subscriptionPlan(
  subscription: Record<string, unknown>,
  env: Env,
): PlanId | null {
  const items = asRecord(subscription.items);
  const first = Array.isArray(items.data) ? items.data[0] : null;
  const priceId = asString(asRecord(asRecord(first).price).id);
  const fromPrice = planForPrice(env, priceId);
  if (fromPrice) return fromPrice;

  const fromMetadata = metadataValue(subscription, 'plan');
  if (isPlanId(fromMetadata) && fromMetadata !== 'free') return fromMetadata;
  return null;
}

export function cancelAtPeriodEndFrom(subscription: Record<string, unknown>): boolean {
  if (subscription.cancel_at_period_end === true) return true;
  const items = asRecord(subscription.items);
  const first = Array.isArray(items.data) ? items.data[0] : null;
  return asRecord(first).cancel_at_period_end === true;
}

async function applySubscriptionEvent(
  env: Env,
  subscription: Record<string, unknown>,
  deleted: boolean,
): Promise<void> {
  const customerId = asString(subscription.customer);
  let userId = metadataValue(subscription, 'user_id');
  if (!userId && customerId) userId = (await userIdForCustomer(env, customerId)) ?? '';
  if (!userId) return;

  const subscriptionId = asString(subscription.id) || null;
  const status = deleted ? 'canceled' : asString(subscription.status) || 'active';
  const active = status === 'active' || status === 'trialing';
  const planId = deleted || !active ? 'free' : subscriptionPlan(subscription, env);
  if (!planId) return;

  const plan = planFor(planId);
  const periodEnd = deleted ? null : periodEndFrom(subscription);

  await applySubscription(env, {
    userId,
    plan: plan.id,
    status,
    periodEnd,
    pointCap: plan.pointCap,
    grantPoints: active ? plan.monthlyPoints : 0,
    // One grant per Stripe period: the same period end is the same key.
    periodKey: active && periodEnd ? periodEnd : null,
    customerId: customerId || null,
    subscriptionId,
    cancelAtPeriodEnd: cancelAtPeriodEndFrom(subscription),
  });
}

export async function handleWebhook(
  env: Env,
  rawBody: string,
  signature: string,
  now = Date.now(),
): Promise<{ received: true; duplicate?: boolean }> {
  if (!serviceKey(env)) {
    throw unconfigured('SUPABASE_SERVICE_KEY is required to process Stripe webhooks.');
  }
  const event = await verifyWebhook(env, rawBody, signature, now);
  const id = asString(event.id);
  const type = asString(event.type);
  if (!id || !type) throw badRequest('The Stripe event is missing an id or type.');

  if (!(await claimStripeEvent(env, id, type))) {
    return { received: true, duplicate: true };
  }

  try {
    const object = asRecord(asRecord(event.data).object);
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated') {
      await applySubscriptionEvent(env, object, false);
    } else if (type === 'customer.subscription.deleted') {
      await applySubscriptionEvent(env, object, true);
    } else if (type === 'charge.refund.updated') {
      // A refund can move from pending to succeeded or failed after the API
      // response. Keep the recorded row in step with Stripe.
      const refundId = asString(object.id);
      if (refundId && isRefundStatus(object.status)) {
        await applyRefundStatus(
          env,
          refundId,
          object.status,
          asString(object.failure_reason) || null,
        );
      }
    } else if (type === 'checkout.session.completed') {
      const subscriptionId = asString(object.subscription);
      if (subscriptionId) {
        const subscription = await fetchSubscription(env, subscriptionId);
        if (subscription) await applySubscriptionEvent(env, subscription, false);
      }
    } else if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
      // The invoice is the reliable renewal signal; the subscription object
      // carries the authoritative period and plan. Newer API versions put the
      // subscription under `parent.subscription_details`.
      const subscriptionId = invoiceSubscriptionId(object);
      if (subscriptionId) {
        const subscription = await fetchSubscription(env, subscriptionId);
        if (subscription) await applySubscriptionEvent(env, subscription, false);
      }
    }
    await finishStripeEvent(env, id, null);
    return { received: true };
  } catch (error) {
    // Release the claim so Stripe's automatic retry can process the event
    // again; a transient database error must not become permanent.
    await releaseStripeEvent(env, id);
    throw error;
  }
}

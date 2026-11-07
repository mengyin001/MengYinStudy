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
  applySubscription,
  billingConfigured,
  billingEnforced,
  claimStripeEvent,
  finishStripeEvent,
  isBillingUnavailable,
  readSnapshot,
  releaseStripeEvent,
  serviceKey,
  userIdForCustomer,
  type BillingSnapshot,
} from './store';
import {
  cancelSubscriptionAtPeriodEnd,
  createCheckoutSession,
  createPortalSession,
  fetchSubscription,
  planForPrice,
  priceIdFor,
  stripeConfigured,
  stripePricesReady,
  verifyWebhook,
  type BillingInterval,
} from './stripe';

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
    return meFromSnapshot(snapshot, enforced, stripeReady);
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
    } else if (type === 'checkout.session.completed') {
      const subscriptionId = asString(object.subscription);
      if (subscriptionId) {
        const subscription = await fetchSubscription(env, subscriptionId);
        if (subscription) await applySubscriptionEvent(env, subscription, false);
      }
    } else if (type === 'invoice.paid' || type === 'invoice.payment_failed') {
      // The invoice is the reliable renewal signal; the subscription object
      // carries the authoritative period and plan.
      const subscriptionId = asString(object.subscription);
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

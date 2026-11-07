/**
 * Point balance transport.
 *
 * Balances are never written directly: this module calls the security-definer
 * RPCs added by `20261107090000_subscription_points.sql`, which read auth.uid()
 * from the caller's JWT and append to the ledger atomically.
 *
 * Every failure is classified. A missing function or an unreachable database
 * is `BillingUnavailable`; the caller decides whether to enforce (fail closed)
 * or continue (billing switched off). A real shortage is `paymentRequired`.
 */
import type { PlanId } from '@mengyin/core';
import type { Env } from '../env';
import type { AuthContext } from '../http/auth';
import { ApiError, paymentRequired } from '../errors';

export interface BillingSnapshot {
  plan: PlanId;
  /** The plan stored on the row; may be higher than `plan` when expired. */
  storedPlan: PlanId;
  /** False when a stored paid plan is expired, past due or cancelled. */
  membershipActive: boolean;
  points: number;
  /** Plan points only, excluding bonus points. */
  planPoints: number;
  /** Purchased or admin-granted points; not cleared by the monthly reset. */
  bonusPoints: number;
  /** Plan points granted at each monthly reset. */
  monthlyPoints: number;
  /** Next lazy monthly reset, or null when none is scheduled. */
  pointsResetAt: string | null;
  lifetimePoints: number;
  periodStart: string | null;
  periodEnd: string | null;
  imagesUsed: number;
  /** Free-plan questions used in the current calendar month. */
  questionsUsed: number;
  /** ISO date (UTC) of the next free-quota reset. */
  questionsResetAt: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export class BillingUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingUnavailable';
  }
}

function baseUrl(env: Env): string {
  return (env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
}

function publishableKey(env: Env): string {
  return (env.SUPABASE_PUBLISHABLE_KEY ?? '').trim();
}

export function serviceKey(env: Env): string {
  return (env.SUPABASE_SERVICE_KEY ?? env.SUPABASE_SECRET_KEY ?? '').trim();
}

/** The database can answer billing questions for this deployment. */
export function billingConfigured(env: Env): boolean {
  return Boolean(baseUrl(env) && publishableKey(env));
}

/**
 * Plan limits are enforced whenever billing is configured, unless an operator
 * explicitly turns enforcement off with BILLING_ENFORCE=false. Generation must
 * never trust a client-side plan, so the default is on.
 */
export function billingEnforced(env: Env): boolean {
  return billingConfigured(env) && (env.BILLING_ENFORCE ?? 'true').trim().toLowerCase() !== 'false';
}

interface RpcOptions {
  /** Use the secret key and skip the user's token (webhook / admin calls). */
  service?: boolean;
}

interface PostgrestError {
  code?: string;
  message?: string;
  details?: string;
}

async function rpc<T>(
  env: Env,
  name: string,
  body: Record<string, unknown>,
  auth: AuthContext | null,
  options: RpcOptions = {},
): Promise<T> {
  const url = baseUrl(env);
  const anon = publishableKey(env);
  if (!url || !anon) throw new BillingUnavailable('Supabase is not configured on this server.');

  const secret = serviceKey(env);
  const key = options.service ? secret : anon;
  const token = options.service ? secret : auth?.token;
  if (!key) throw new BillingUnavailable('SUPABASE_SERVICE_KEY is not configured.');
  if (!token) throw new BillingUnavailable('No session token available for billing.');

  let response: Response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new BillingUnavailable(
      `Billing database unreachable (${error instanceof Error ? error.message : String(error)}).`,
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
    const failure = (payload ?? {}) as PostgrestError;
    const message = failure.message ?? `Billing call ${name} failed (${response.status}).`;
    if (message.includes('insufficient_points')) {
      throw paymentRequired('Not enough points for this request. Top up or upgrade your plan.');
    }
    if (message.includes('question_quota_exceeded')) {
      throw paymentRequired(
        'The free monthly question limit is used up. Upgrade for more questions, or wait for next month.',
      );
    }
    // PGRST202 = function not found, i.e. the migration has not been applied.
    if (failure.code === 'PGRST202' || /could not find the function/i.test(message)) {
      throw new BillingUnavailable('The billing migration has not been applied to this database.');
    }
    throw new BillingUnavailable(message);
  }

  return payload as T;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const PLAN_IDS: readonly string[] = ['free', 'light', 'standard', 'pro'];

function planId(value: unknown): PlanId {
  return typeof value === 'string' && PLAN_IDS.includes(value) ? (value as PlanId) : 'free';
}

function normalizeSnapshot(raw: unknown): BillingSnapshot {
  const entry = (raw ?? {}) as Record<string, unknown>;
  const plan = planId(entry.plan);
  return {
    plan,
    storedPlan: planId(entry.storedPlan ?? entry.plan),
    membershipActive: entry.membershipActive !== false,
    points: Math.max(0, Math.trunc(number(entry.points))),
    planPoints: Math.max(0, Math.trunc(number(entry.planPoints, number(entry.points)))),
    bonusPoints: Math.max(0, Math.trunc(number(entry.bonusPoints))),
    monthlyPoints: Math.max(0, Math.trunc(number(entry.monthlyPoints))),
    pointsResetAt: text(entry.pointsResetAt),
    lifetimePoints: Math.max(0, Math.trunc(number(entry.lifetimePoints))),
    periodStart: text(entry.periodStart),
    periodEnd: text(entry.periodEnd),
    imagesUsed: Math.max(0, Math.trunc(number(entry.imagesUsed))),
    questionsUsed: Math.max(0, Math.trunc(number(entry.questionsUsed))),
    questionsResetAt: text(entry.questionsResetAt),
    status: text(entry.status),
    cancelAtPeriodEnd: entry.cancelAtPeriodEnd === true,
    stripeCustomerId: text(entry.stripeCustomerId),
    stripeSubscriptionId: text(entry.stripeSubscriptionId),
  };
}

export async function readSnapshot(env: Env, auth: AuthContext): Promise<BillingSnapshot> {
  const raw = await rpc<unknown>(env, 'billing_snapshot', {}, auth);
  return normalizeSnapshot(raw);
}

export interface SpendResult {
  balance: number;
  duplicate: boolean;
}

export async function spendPoints(
  env: Env,
  auth: AuthContext,
  points: number,
  kind: string,
  requestId: string,
  metadata: Record<string, unknown> = {},
): Promise<SpendResult> {
  const raw = await rpc<Record<string, unknown>>(
    env,
    'billing_spend',
    { p_points: Math.max(0, Math.round(points)), p_kind: kind, p_request_id: requestId, p_metadata: metadata },
    auth,
  );
  return { balance: number(raw?.balance), duplicate: raw?.duplicate === true };
}

export async function refundPoints(
  env: Env,
  auth: AuthContext,
  points: number,
  kind: string,
  requestId: string,
  metadata: Record<string, unknown> = {},
): Promise<number> {
  if (points <= 0) return 0;
  if (!auth.userId) throw new BillingUnavailable('No account available for a refund.');
  // Service role: a user-callable refund could credit points without a charge.
  const raw = await rpc<Record<string, unknown>>(
    env,
    'billing_refund',
    {
      p_user: auth.userId,
      p_points: Math.round(points),
      p_kind: kind,
      p_request_id: requestId,
      p_metadata: metadata,
    },
    null,
    { service: true },
  );
  return number(raw?.balance);
}

export interface ImageTake {
  included: number;
  extra: number;
  imagesUsed: number;
  quota: number;
}

export async function takeImages(
  env: Env,
  auth: AuthContext,
  count: number,
  quota: number,
): Promise<ImageTake> {
  const raw = await rpc<Record<string, unknown>>(
    env,
    'billing_image_take',
    { p_count: Math.max(0, Math.round(count)), p_quota: Math.max(0, Math.round(quota)) },
    auth,
  );
  return {
    included: number(raw?.included),
    extra: number(raw?.extra),
    imagesUsed: number(raw?.imagesUsed),
    quota: number(raw?.quota, quota),
  };
}

// -- Free-plan question quota -----------------------------------------------

export interface QuestionTake {
  used: number;
  limit: number;
  /** Null when the plan has no question quota (paid plans). */
  remaining: number | null;
  duplicate: boolean;
}

/**
 * Reserve free questions before a run. Service role only: the browser must not
 * be able to reset its own monthly counter.
 */
export async function takeQuestions(
  env: Env,
  auth: AuthContext,
  count: number,
  limit: number,
  requestId: string,
): Promise<QuestionTake> {
  if (!auth.userId) throw new BillingUnavailable('No account available for a question quota.');
  const raw = await rpc<Record<string, unknown>>(
    env,
    'billing_questions_take',
    {
      p_user: auth.userId,
      p_count: Math.max(0, Math.round(count)),
      p_limit: Math.max(0, Math.round(limit)),
      p_request_id: requestId,
    },
    null,
    { service: true },
  );
  const remaining = raw?.remaining;
  return {
    used: number(raw?.used),
    limit: number(raw?.limit, limit),
    remaining: typeof remaining === 'number' ? Math.max(0, Math.trunc(remaining)) : null,
    duplicate: raw?.duplicate === true,
  };
}

/** Return reserved free questions after a shortfall or a failed run. */
export async function refundQuestions(
  env: Env,
  auth: AuthContext,
  count: number,
  requestId: string,
): Promise<number> {
  if (count <= 0) return 0;
  if (!auth.userId) throw new BillingUnavailable('No account available for a question refund.');
  const raw = await rpc<Record<string, unknown>>(
    env,
    'billing_questions_refund',
    { p_user: auth.userId, p_count: Math.round(count), p_request_id: requestId },
    null,
    { service: true },
  );
  return number(raw?.used);
}

// -- Service-role operations (webhook, admin) -------------------------------

export interface SubscriptionInput {
  userId: string;
  plan: PlanId;
  status: string;
  periodEnd: string | null;
  pointCap: number;
  grantPoints: number;
  periodKey: string | null;
  customerId?: string | null;
  subscriptionId?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export async function applySubscription(env: Env, input: SubscriptionInput): Promise<void> {
  await rpc(
    env,
    'billing_set_subscription',
    {
      p_user: input.userId,
      p_plan: input.plan,
      p_status: input.status,
      p_period_end: input.periodEnd,
      p_point_cap: input.pointCap,
      p_grant_points: input.grantPoints,
      p_period_key: input.periodKey,
      p_customer_id: input.customerId ?? null,
      p_subscription_id: input.subscriptionId ?? null,
      p_cancel_at_period_end: input.cancelAtPeriodEnd ?? false,
    },
    null,
    { service: true },
  );
}

export async function grantPoints(
  env: Env,
  userId: string,
  points: number,
  kind: string,
  requestId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await rpc(
    env,
    'billing_grant',
    { p_user: userId, p_points: Math.round(points), p_kind: kind, p_request_id: requestId, p_metadata: metadata },
    null,
    { service: true },
  );
}

/** Find the account that owns a Stripe customer, when metadata was not enough. */
export async function userIdForCustomer(env: Env, customerId: string): Promise<string | null> {
  const url = baseUrl(env);
  const secret = serviceKey(env);
  if (!url || !secret) throw new BillingUnavailable('SUPABASE_SERVICE_KEY is not configured.');
  const response = await fetch(
    `${url}/rest/v1/billing_accounts?select=user_id&stripe_customer_id=eq.${encodeURIComponent(customerId)}&limit=1`,
    { headers: { apikey: secret, Authorization: `Bearer ${secret}`, Accept: 'application/json' } },
  );
  if (!response.ok) throw new BillingUnavailable(`Could not look up a Stripe customer (${response.status}).`);
  const rows = (await response.json()) as Array<{ user_id?: unknown }>;
  const id = rows[0]?.user_id;
  return typeof id === 'string' ? id : null;
}

/**
 * Record a Stripe event id. Returns false when the id is already present, which
 * makes a retry a no-op instead of granting a month twice.
 */
export async function claimStripeEvent(env: Env, id: string, type: string): Promise<boolean> {
  const url = baseUrl(env);
  const secret = serviceKey(env);
  if (!url || !secret) throw new BillingUnavailable('SUPABASE_SERVICE_KEY is not configured.');
  const response = await fetch(`${url}/rest/v1/stripe_events`, {
    method: 'POST',
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({ id, type }),
  });
  if (!response.ok) throw new BillingUnavailable(`Could not record the Stripe event (${response.status}).`);
  const rows = (await response.json()) as unknown[];
  return Array.isArray(rows) && rows.length > 0;
}

export async function finishStripeEvent(env: Env, id: string, error: string | null): Promise<void> {  const url = baseUrl(env);
  const secret = serviceKey(env);
  if (!url || !secret) return;
  const response = await fetch(`${url}/rest/v1/stripe_events?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ processed_at: new Date().toISOString(), error }),
  });
  // Bookkeeping only; a failed update must not fail the webhook response.
  void response.status;
}

/**
 * Drop a claimed event after a processing failure, so Stripe's retry can try
 * again. Keeping the row would turn a transient error into a permanent one.
 */
export async function releaseStripeEvent(env: Env, id: string): Promise<void> {
  const url = baseUrl(env);
  const secret = serviceKey(env);
  if (!url || !secret) return;
  await fetch(`${url}/rest/v1/stripe_events?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      Prefer: 'return=minimal',
    },
  }).catch(() => undefined);
}

export function isBillingUnavailable(error: unknown): error is BillingUnavailable {
  return error instanceof BillingUnavailable;
}

export function billingApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(503, 'server_error', 'The billing service is temporarily unavailable.');
}

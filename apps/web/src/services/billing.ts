/**
 * Browser transport for billing.
 *
 * The server owns prices, plan limits and the point ledger; this module only
 * moves JSON and turns a failed call into a readable message.
 */
import type { MaterialTier, Plan, PlanId } from '@mengyin/core';
import { aiApiBase } from '@/ai/config';
import { backend } from '@/services';

export interface BillingConfig {
  plans: Plan[];
  pointCosts: Record<string, number>;
  defaultModelPoints: number;
  imagePoints: number;
  materialTiers: MaterialTier[];
  /** Plan limits and point charges are being applied on the server. */
  enforced: boolean;
  /** The billing tables answered on this deployment. */
  configured: boolean;
  /** Stripe keys and at least one price are configured. */
  stripeReady: boolean;
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
  questionsUsed: number;
  /** Zero for a paid plan, because points are its limit. */
  questionsLimit: number;
  /** Null when points are the limit (paid plan). */
  questionsRemaining: number | null;
  questionsResetAt: string | null;
  periodEnd: string | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  enforced: boolean;
  stripeReady: boolean;
}

export class BillingError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = 'BillingError';
    this.status = status;
  }
}

function billingUrl(path: string): string {
  const base = aiApiBase();
  // The API base always ends in /ai; billing is its sibling.
  const root = base.endsWith('/ai') ? base.slice(0, -3) : base;
  return `${root}/billing/${path.replace(/^\/+/, '')}`;
}

async function headers(json = false): Promise<Record<string, string>> {
  let token: string | null = null;
  try {
    token = await backend.auth.getAccessToken();
  } catch {
    token = null;
  }
  return {
    Accept: 'application/json',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readError(response: Response): Promise<BillingError> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return new BillingError(parsed.error.message, response.status);
  } catch {
    // Not JSON; fall through to the status.
  }
  if (response.status === 401) return new BillingError('Sign in again to manage billing.', 401);
  return new BillingError(text.slice(0, 300) || `Billing returned HTTP ${response.status}.`, response.status);
}

export async function getBillingConfig(signal?: AbortSignal): Promise<BillingConfig> {
  const response = await fetch(billingUrl('config'), {
    headers: await headers(),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as BillingConfig;
}

export async function getBillingMe(signal?: AbortSignal): Promise<BillingMe> {
  const response = await fetch(billingUrl('me'), {
    headers: await headers(),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as BillingMe;
}

async function post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(billingUrl(path), {
    method: 'POST',
    headers: await headers(true),
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

export async function startCheckout(
  plan: Exclude<PlanId, 'free'>,
  interval: 'month' | 'year',
): Promise<string> {
  const result = await post<{ url: string }>('checkout', { plan, interval });
  return result.url;
}

export async function openBillingPortal(): Promise<string> {
  const result = await post<{ url: string }>('portal');
  return result.url;
}

/** Stop renewal before deleting the account; safe to call when there is none. */
export async function cancelBillingSubscription(): Promise<boolean> {
  const result = await post<{ canceled: boolean }>('cancel');
  return result.canceled === true;
}

export type RefundReason =
  | 'not_paid'
  | 'not_active'
  | 'outside_window'
  | 'no_payment'
  | 'no_plan_points'
  | 'no_unused_points'
  | 'unsupported_invoice'
  | 'already_refunded'
  | 'unavailable';

export interface RefundQuote {
  eligible: boolean;
  reason: RefundReason | null;
  paidCents: number;
  amountCents: number;
  unusedRatio: number;
  refundRatio: number;
  unusedPoints: number;
  monthlyPoints: number;
  interval: 'month' | 'year';
  windowEndsAt: string | null;
  windowDays: number;
  currency: string;
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
  subscriptionCanceled: boolean;
}

export async function getRefundQuote(signal?: AbortSignal): Promise<RefundQuote> {
  const response = await fetch(billingUrl('refund'), {
    headers: await headers(),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw await readError(response);
  return (await response.json()) as RefundQuote;
}

/** Execute the refund after the learner has seen and confirmed the quote. */
export async function requestRefund(): Promise<RefundReceipt> {
  return post<RefundReceipt>('refund');
}

/**
 * Refund arithmetic.
 *
 * A refund returns the part of the latest subscription payment that has not
 * been consumed. Plan points are the usage meter: a learner who has spent 100
 * of a 500-point monthly allowance has consumed 20% of that month's allowance,
 * so 80% of the month's payment is refundable.
 *
 * Annual plans are paid for twelve monthly portions but receive their points
 * one month at a time. A refund therefore returns every untouched future month
 * in full plus the unused fraction of the current month:
 *
 *   annual refund ratio = (11 + unusedPoints / monthlyPoints) / 12
 *
 * The seven-day window is the same for both intervals. It keeps the automatic
 * flow to a first, recent payment; anything older is handled by support and
 * the statutory rights described in the Terms.
 */

export const REFUND_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface RefundQuoteInput {
  /** Current time in milliseconds. */
  now: number;
  /** Stripe subscription `created`, in seconds or as an ISO timestamp. */
  subscriptionCreatedAt: number | string | null;
  /** Stripe subscription status. */
  status: string;
  interval: 'month' | 'year';
  /** Amount actually paid on the first subscription invoice, in cents. */
  paidCents: number;
  /** Plan points still on the account. Bonus points are deliberately excluded. */
  planPoints: number;
  /** The plan's monthly point grant. */
  monthlyPoints: number;
}

export interface RefundQuote {
  eligible: boolean;
  reason: RefundReason | null;
  /** The amount paid on the invoice being refunded. */
  paidCents: number;
  /** The suggested refund, rounded down to a whole cent. */
  amountCents: number;
  /** Plan points left / monthly allowance; 1 means untouched. */
  unusedRatio: number;
  /** Share of the payment returned, including untouched annual months. */
  refundRatio: number;
  unusedPoints: number;
  monthlyPoints: number;
  interval: 'month' | 'year';
  /** End of the seven-day automatic-refund window. */
  windowEndsAt: string | null;
}

function timestamp(value: number | string | null): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    // Stripe timestamps are seconds; accept milliseconds defensively.
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function calculateRefundQuote(input: RefundQuoteInput): RefundQuote {
  const paidCents = Math.max(0, Math.round(input.paidCents));
  const monthlyPoints = Math.max(0, Math.round(input.monthlyPoints));
  const unusedPoints = Math.min(
    monthlyPoints,
    Math.max(0, Math.round(input.planPoints)),
  );
  const created = timestamp(input.subscriptionCreatedAt);
  const windowEndsAt = created === null ? null : created + REFUND_WINDOW_DAYS * DAY_MS;

  const base = {
    paidCents,
    amountCents: 0,
    unusedRatio: monthlyPoints > 0 ? clampRatio(unusedPoints / monthlyPoints) : 0,
    refundRatio: 0,
    unusedPoints,
    monthlyPoints,
    interval: input.interval,
    windowEndsAt: windowEndsAt === null ? null : new Date(windowEndsAt).toISOString(),
  } satisfies Omit<RefundQuote, 'eligible' | 'reason'>;

  const notEligible = (reason: RefundReason): RefundQuote => ({
    ...base,
    eligible: false,
    reason,
  });

  if (input.status !== 'active' && input.status !== 'trialing') {
    return notEligible('not_active');
  }
  if (created === null) return notEligible('unavailable');
  if (input.now > (windowEndsAt ?? 0)) return notEligible('outside_window');
  if (monthlyPoints <= 0) return notEligible('no_plan_points');
  if (paidCents <= 0) return notEligible('no_payment');

  const unusedRatio = base.unusedRatio;
  // Annual: eleven untouched months plus the unused part of the month that
  // has already started. Monthly: only the unused part of this period.
  const refundRatio =
    input.interval === 'year' ? (11 + unusedRatio) / 12 : unusedRatio;
  const amountCents = Math.min(
    paidCents,
    Math.floor(paidCents * clampRatio(refundRatio) + 1e-9),
  );

  if (amountCents <= 0) return notEligible('no_unused_points');

  return {
    ...base,
    eligible: true,
    reason: null,
    amountCents,
    refundRatio,
  };
}

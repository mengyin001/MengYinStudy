import { describe, expect, it } from 'vitest';
import { calculateRefundQuote, REFUND_WINDOW_DAYS, type RefundQuoteInput } from './refund';

const CREATED = Date.UTC(2026, 10, 8, 0, 0, 0); // 2026-11-08
const NOW = CREATED + 60 * 60 * 1000;

function input(overrides: Partial<RefundQuoteInput> = {}): RefundQuoteInput {
  return {
    now: NOW,
    subscriptionCreatedAt: CREATED / 1000,
    status: 'active',
    interval: 'month',
    paidCents: 499,
    planPoints: 500,
    monthlyPoints: 500,
    ...overrides,
  };
}

describe('refund calculation', () => {
  it('refunds the full payment when no plan points were used', () => {
    const quote = calculateRefundQuote(input());
    expect(quote.eligible).toBe(true);
    expect(quote.reason).toBeNull();
    expect(quote.unusedRatio).toBe(1);
    expect(quote.amountCents).toBe(499);
  });

  it('refunds the unused share of a monthly payment, not the full amount', () => {
    const quote = calculateRefundQuote(input({ planPoints: 400 }));
    expect(quote.unusedPoints).toBe(400);
    expect(quote.unusedRatio).toBeCloseTo(0.8);
    expect(quote.refundRatio).toBeCloseTo(0.8);
    // $4.99 × 80% = $3.99 (rounded down to a whole cent).
    expect(quote.amountCents).toBe(399);
  });

  it('refuses a monthly refund once every plan point is used', () => {
    const quote = calculateRefundQuote(input({ planPoints: 0 }));
    expect(quote.eligible).toBe(false);
    expect(quote.reason).toBe('no_unused_points');
    expect(quote.amountCents).toBe(0);
  });

  it('keeps unused annual months whole and applies the point share to this month', () => {
    const full = calculateRefundQuote(
      input({ interval: 'year', paidCents: 4_990, planPoints: 500 }),
    );
    expect(full.amountCents).toBe(4_990);

    const used = calculateRefundQuote(
      input({ interval: 'year', paidCents: 4_990, planPoints: 400 }),
    );
    // 11 untouched months + 80% of the current month = 11.8 / 12.
    expect(used.refundRatio).toBeCloseTo(11.8 / 12);
    expect(used.amountCents).toBe(4_906);
  });

  it('still returns the untouched annual months after this month is spent', () => {
    const quote = calculateRefundQuote(
      input({ interval: 'year', paidCents: 4_990, planPoints: 0 }),
    );
    expect(quote.eligible).toBe(true);
    expect(quote.amountCents).toBe(4_574);
  });

  it(`closes the automatic window after ${REFUND_WINDOW_DAYS} days`, () => {
    const outside = calculateRefundQuote(
      input({ now: CREATED + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000 + 1 }),
    );
    expect(outside.eligible).toBe(false);
    expect(outside.reason).toBe('outside_window');
    expect(outside.windowEndsAt).toBe(
      new Date(CREATED + REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it('rejects a subscription that is no longer active', () => {
    const quote = calculateRefundQuote(input({ status: 'past_due' }));
    expect(quote.eligible).toBe(false);
    expect(quote.reason).toBe('not_active');
  });

  it('never counts more points than the monthly allowance', () => {
    const quote = calculateRefundQuote(input({ planPoints: 900 }));
    expect(quote.unusedPoints).toBe(500);
    expect(quote.amountCents).toBe(499);
  });

  it('reports missing payment data instead of inventing a refund', () => {
    expect(calculateRefundQuote(input({ paidCents: 0 })).reason).toBe('no_payment');
    expect(calculateRefundQuote(input({ monthlyPoints: 0 })).reason).toBe('no_plan_points');
    expect(calculateRefundQuote(input({ subscriptionCreatedAt: null })).reason).toBe('unavailable');
  });
});

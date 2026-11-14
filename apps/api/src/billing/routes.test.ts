import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { isRefundStatus, type BillingSnapshot } from './store';
import {
  cancelAtPeriodEndFrom,
  hasLiveSubscription,
  invoicePaymentIds,
  invoiceSubscriptionId,
  meFromSnapshot,
  periodEndFrom,
  shouldCancelSubscription,
  subscriptionInterval,
  subscriptionPlan,
} from './routes';

function snapshot(overrides: Partial<BillingSnapshot> = {}): BillingSnapshot {
  return {
    plan: 'light',
    storedPlan: 'light',
    membershipActive: true,
    points: 620,
    planPoints: 500,
    bonusPoints: 120,
    monthlyPoints: 500,
    pointsResetAt: '2026-12-07T00:00:00.000Z',
    lifetimePoints: 1_000,
    periodStart: '2026-11-07T00:00:00.000Z',
    periodEnd: '2027-11-07T00:00:00.000Z',
    imagesUsed: 3,
    questionsUsed: 0,
    questionsResetAt: '2026-12-01T00:00:00.000Z',
    status: 'active',
    cancelAtPeriodEnd: false,
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    ...overrides,
  };
}

describe('Stripe subscription shapes', () => {
  it('reads the period end from the pre-2025-03-31 subscription shape', () => {
    expect(periodEndFrom({ current_period_end: 1_800_000_000 })).toBe(
      new Date(1_800_000_000 * 1000).toISOString(),
    );
  });

  it('reads the period end from the item shape used by newer API versions', () => {
    expect(
      periodEndFrom({ items: { data: [{ current_period_end: 1_900_000_000 }] } }),
    ).toBe(new Date(1_900_000_000 * 1000).toISOString());
  });

  it('returns null when neither shape carries a period end', () => {
    expect(periodEndFrom({ items: { data: [{}] } })).toBeNull();
    expect(periodEndFrom({})).toBeNull();
  });

  it('reads cancel_at_period_end from either shape', () => {
    expect(cancelAtPeriodEndFrom({ cancel_at_period_end: true })).toBe(true);
    expect(cancelAtPeriodEndFrom({ items: { data: [{ cancel_at_period_end: true }] } })).toBe(true);
    expect(cancelAtPeriodEndFrom({ items: { data: [{}] } })).toBe(false);
  });

  it('reads the subscription interval from the price', () => {
    expect(
      subscriptionInterval({ items: { data: [{ price: { recurring: { interval: 'year' } } }] } }),
    ).toBe('year');
    expect(
      subscriptionInterval({ items: { data: [{ price: { recurring: { interval: 'month' } } }] } }),
    ).toBe('month');
    expect(subscriptionInterval({})).toBe('month');
  });

  it('reads an invoice subscription from the old and new API shapes', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_old' })).toBe('sub_old');
    expect(
      invoiceSubscriptionId({
        parent: { subscription_details: { subscription: 'sub_new' } },
      }),
    ).toBe('sub_new');
    expect(invoiceSubscriptionId({})).toBe('');
  });

  it('reads an invoice payment from the old and new API shapes', () => {
    expect(invoicePaymentIds({ payment_intent: 'pi_old', charge: 'ch_old' })).toEqual({
      paymentIntentId: 'pi_old',
      chargeId: 'ch_old',
    });
    expect(
      invoicePaymentIds({
        payments: {
          data: [{ payment: { payment_intent: 'pi_new', charge: null } }],
        },
      }),
    ).toEqual({ paymentIntentId: 'pi_new', chargeId: null });
    expect(invoicePaymentIds({})).toEqual({ paymentIntentId: null, chargeId: null });
  });

  it('only accepts Stripe refund statuses the webhook understands', () => {
    expect(isRefundStatus('pending')).toBe(true);
    expect(isRefundStatus('requires_action')).toBe(true);
    expect(isRefundStatus('succeeded')).toBe(true);
    expect(isRefundStatus('failed')).toBe(true);
    expect(isRefundStatus('canceled')).toBe(true);
    expect(isRefundStatus('refunded')).toBe(false);
    expect(isRefundStatus(null)).toBe(false);
  });
});

describe('subscription plan mapping', () => {
  const env = {
    STRIPE_PRICE_LIGHT_MONTH: 'price_light_month',
    STRIPE_PRICE_STANDARD_MONTH: 'price_standard_month',
    STRIPE_PRICE_PRO_MONTH: 'price_pro_month',
  } as Env;

  it('follows the new price after a Customer Portal plan change', () => {
    const subscription = {
      metadata: { plan: 'light' },
      items: { data: [{ price: { id: 'price_standard_month' } }] },
    };
    expect(subscriptionPlan(subscription, env)).toBe('standard');
  });

  it('falls back to metadata when the price is not in this catalogue', () => {
    const subscription = {
      metadata: { plan: 'pro' },
      items: { data: [{ price: { id: 'price_from_another_environment' } }] },
    };
    expect(subscriptionPlan(subscription, env)).toBe('pro');
  });
});

describe('billing me payload', () => {
  it('passes the monthly allowance and reset date through for an annual plan', () => {
    const me = meFromSnapshot(snapshot(), true, true);
    expect(me.plan).toBe('light');
    expect(me.points).toBe(620);
    expect(me.planPoints).toBe(500);
    expect(me.bonusPoints).toBe(120);
    expect(me.monthlyPoints).toBe(500);
    expect(me.pointsResetAt).toBe('2026-12-07T00:00:00.000Z');
    expect(me.imagesPerMonth).toBe(10);
  });

  it('reports zero monthly points for the free plan', () => {
    const me = meFromSnapshot(
      snapshot({
        plan: 'free',
        storedPlan: 'free',
        membershipActive: false,
        points: 0,
        planPoints: 0,
        bonusPoints: 0,
        monthlyPoints: 0,
        pointsResetAt: null,
        status: null,
      }),
      true,
      true,
    );
    expect(me.monthlyPoints).toBe(0);
    expect(me.pointsResetAt).toBeNull();
    // The free plan has no question quota while it has no AI model.
    expect(me.questionsRemaining).toBeNull();
  });
});

describe('existing subscriptions', () => {
  it('sends a live subscriber to the portal instead of a second Checkout', () => {
    expect(hasLiveSubscription(snapshot())).toBe(true);
  });

  it('still sends a past-due subscriber to the portal, not a second Checkout', () => {
    expect(hasLiveSubscription(snapshot({ membershipActive: false, status: 'past_due' }))).toBe(true);
    expect(hasLiveSubscription(snapshot({ membershipActive: false, status: 'unpaid' }))).toBe(true);
  });

  it('allows Checkout when the old subscription has ended', () => {
    expect(hasLiveSubscription(snapshot({ membershipActive: false, status: 'canceled' }))).toBe(false);
    expect(hasLiveSubscription(snapshot({ stripeSubscriptionId: null, status: null }))).toBe(false);
    expect(hasLiveSubscription(snapshot({ membershipActive: false, status: null }))).toBe(false);
  });
});

describe('account deletion and billing', () => {
  it('cancels renewal for a live subscription', () => {
    expect(shouldCancelSubscription(snapshot())).toBe(true);
    expect(shouldCancelSubscription(snapshot({ status: 'past_due' }))).toBe(true);
  });

  it('does nothing when there is no subscription or it is already ending', () => {
    expect(shouldCancelSubscription(snapshot({ stripeSubscriptionId: null }))).toBe(false);
    expect(shouldCancelSubscription(snapshot({ status: 'canceled' }))).toBe(false);
    expect(shouldCancelSubscription(snapshot({ status: 'incomplete_expired' }))).toBe(false);
    expect(shouldCancelSubscription(snapshot({ cancelAtPeriodEnd: true }))).toBe(false);
  });
});


import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanId } from '@mengyin/core';
import type { BillingSnapshot } from './store';

vi.mock('./store', () => ({
  billingEnforced: vi.fn(() => true),
  readSnapshot: vi.fn(),
  spendPoints: vi.fn(async () => ({ balance: 0, duplicate: false })),
  refundPoints: vi.fn(async () => 0),
  takeQuestions: vi.fn(async () => ({ used: 10, limit: 200, remaining: 190, duplicate: false })),
  refundQuestions: vi.fn(async () => 0),
  takeImages: vi.fn(async () => ({ included: 0, extra: 1, imagesUsed: 1, quota: 0 })),
}));

import * as store from './store';
import {
  cancelGeneration,
  chargeDeckImages,
  chargeStandaloneImage,
  refundStandaloneImage,
  resolveGenerationPolicy,
  settleGeneration,
} from './policy';

const env = { SUPABASE_URL: 'https://example.test', SUPABASE_PUBLISHABLE_KEY: 'public' };
const auth = { userId: 'user-1', token: 'token-1' };

function snapshot(plan: PlanId, points = 0): BillingSnapshot {
  return {
    plan,
    storedPlan: plan,
    membershipActive: true,
    points,
    planPoints: points,
    bonusPoints: 0,
    monthlyPoints: plan === 'free' ? 0 : 500,
    pointsResetAt: plan === 'free' ? null : '2026-12-01T00:00:00.000Z',
    lifetimePoints: points,
    periodStart: '2026-11-01T00:00:00.000Z',
    periodEnd: '2026-12-01T00:00:00.000Z',
    imagesUsed: 0,
    questionsUsed: 0,
    questionsResetAt: '2026-12-01T00:00:00.000Z',
    status: 'active',
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(store.billingEnforced).mockReturnValue(true);
  vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('light', 500));
});

describe('resolveGenerationPolicy', () => {
  it('keeps the free plan on the free model and blocks AI photos, not rendered figures', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('free'));

    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'glm-4.7-flash', count: 10, materialChars: 0, imageMode: 'auto' },
      'req-1',
    );

    expect(policy.enforced).toBe(true);
    expect(policy.plan.id).toBe('free');
    // The mode stays "auto": diagrams are free, so the planner still runs.
    expect(policy.imageMode).toBe('auto');
    expect(policy.imagesBlocked).toBe(true);
    expect(policy.photosAllowed).toBe(false);
    expect(policy.estimate.total).toBe(0);
    expect(policy.reservedQuestions).toBe(10);
    expect(store.takeQuestions).toHaveBeenCalledWith(env, auth, 10, 200, 'gen:req-1');
    expect(store.spendPoints).not.toHaveBeenCalled();
  });

  it('still lets the free plan ask for rendered figures in "on" mode', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('free'));

    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'glm-4.7-flash', count: 10, materialChars: 0, imageMode: 'on' },
      'req-figures',
    );

    expect(policy.imageMode).toBe('on');
    expect(policy.imagesBlocked).toBe(true);
    expect(policy.photosAllowed).toBe(false);
  });

  it('does not reserve image quota before deck images exist', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'on' },
      'req-images',
    );

    // The planner may produce fewer images than the question count, so the
    // quota is taken after illustrations are attached, not at reservation time.
    expect(policy.imageMode).toBe('on');
    expect(policy.photosAllowed).toBe(true);
    expect(policy.estimate.images).toBe(0);
    expect(store.takeImages).not.toHaveBeenCalled();
  });

  it('counts deck AI images toward the monthly quota and charges only extras', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'on' },
      'req-deck-images',
    );
    vi.mocked(store.takeImages).mockResolvedValue({
      included: 1,
      extra: 2,
      imagesUsed: 42,
      quota: 40,
    });

    await expect(chargeDeckImages(env, auth, policy, 3)).resolves.toBe(20);
    expect(store.takeImages).toHaveBeenCalledWith(env, auth, 3, 10);
    expect(store.spendPoints).toHaveBeenCalledWith(env, auth, 20, 'image', 'gen-img:req-deck-images', {
      count: 3,
      imagesUsed: 42,
    });
  });

  it('rejects a model the plan does not include', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('light'));

    await expect(
      resolveGenerationPolicy(
        env,
        auth,
        { model: 'deepseek-v4-pro', count: 10, materialChars: 0, imageMode: 'off' },
        'req-2',
      ),
    ).rejects.toMatchObject({ status: 402 });
  });

  it('explains a lapsed subscription instead of a plain upgrade', async () => {
    const lapsed = { ...snapshot('free'), storedPlan: 'light' as const, membershipActive: false };
    vi.mocked(store.readSnapshot).mockResolvedValue(lapsed);

    await expect(
      resolveGenerationPolicy(
        env,
        auth,
        { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'off' },
        'req-lapsed',
      ),
    ).rejects.toThrow(/not active/i);
  });

  it('reserves points for a paid run', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'off' },
      'req-3',
    );

    expect(policy.estimate.total).toBe(10);
    expect(store.spendPoints).toHaveBeenCalledWith(
      env,
      auth,
      10,
      'generation',
      'gen:req-3',
      expect.objectContaining({ model: 'deepseek-flash', count: 10 }),
    );
  });

  it('has no per-run question ceiling when the wallet covers the run', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 200, materialChars: 0, imageMode: 'off' },
      'req-5',
    );

    expect(policy.estimate.total).toBe(200);
    expect(policy.reserved).toBe(200);
    expect(store.spendPoints).toHaveBeenCalledWith(
      env,
      auth,
      200,
      'generation',
      'gen:req-5',
      expect.objectContaining({ count: 200 }),
    );
  });

  it('does not restrict anything when billing is switched off', async () => {
    vi.mocked(store.billingEnforced).mockReturnValue(false);

    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-v4-pro', count: 100, materialChars: 0, imageMode: 'on' },
      'req-6',
    );

    expect(policy.enforced).toBe(false);
    expect(policy.reserved).toBe(0);
    expect(policy.reservedQuestions).toBe(0);
    expect(store.readSnapshot).not.toHaveBeenCalled();
  });
});

describe('settlement', () => {
  it('returns the points for questions that were not delivered', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'off' },
      'req-7',
    );

    await settleGeneration(env, auth, policy, 7);

    expect(store.refundPoints).toHaveBeenCalledWith(
      env,
      auth,
      3,
      'generation-refund',
      'gen:req-7:refund',
      expect.objectContaining({ delivered: 7 }),
    );
  });

  it('does not refund a full delivery', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 0, imageMode: 'off' },
      'req-8',
    );

    await settleGeneration(env, auth, policy, 10);
    expect(store.refundPoints).not.toHaveBeenCalled();
  });

  it('refunds the whole reservation after a failure', async () => {
    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'deepseek-flash', count: 10, materialChars: 30_000, imageMode: 'off' },
      'req-9',
    );

    await cancelGeneration(env, auth, policy, 'provider-error');
    expect(store.refundPoints).toHaveBeenCalledWith(
      env,
      auth,
      25,
      'generation-refund',
      'gen:req-9:refund',
      expect.objectContaining({ reason: 'provider-error' }),
    );
  });

  it('returns unused free questions after a shortfall', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('free'));

    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'glm-4.7-flash', count: 10, materialChars: 0, imageMode: 'off' },
      'req-10',
    );

    await settleGeneration(env, auth, policy, 7);

    expect(store.refundQuestions).toHaveBeenCalledWith(env, auth, 3, 'gen:req-10:qrefund');
    expect(store.refundPoints).not.toHaveBeenCalled();
  });

  it('returns the whole free reservation when a run fails', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('free'));

    const policy = await resolveGenerationPolicy(
      env,
      auth,
      { model: 'glm-4.7-flash', count: 10, materialChars: 0, imageMode: 'off' },
      'req-11',
    );

    await cancelGeneration(env, auth, policy, 'provider-error');

    expect(store.refundQuestions).toHaveBeenCalledWith(env, auth, 10, 'gen:req-11:qrefund');
    expect(store.refundPoints).not.toHaveBeenCalled();
  });
});

describe('standalone images', () => {
  it('refuses images on the free plan', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('free'));
    await expect(chargeStandaloneImage(env, auth, 'img-1')).rejects.toMatchObject({ status: 402 });
  });

  it('charges only the images beyond the monthly quota', async () => {
    vi.mocked(store.readSnapshot).mockResolvedValue(snapshot('light'));
    vi.mocked(store.takeImages).mockResolvedValue({ included: 0, extra: 1, imagesUsed: 11, quota: 10 });

    const policy = await chargeStandaloneImage(env, auth, 'img-2');
    expect(policy.points).toBe(10);
    expect(store.spendPoints).toHaveBeenCalledWith(env, auth, 10, 'image', 'img:img-2', {});

    await refundStandaloneImage(env, auth, policy, 'failed');
    expect(store.refundPoints).toHaveBeenCalledWith(
      env,
      auth,
      10,
      'image-refund',
      'img:img-2:refund',
      { reason: 'failed' },
    );
  });
});

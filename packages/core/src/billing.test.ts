import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_PRO_MULTIPLIER,
  MODEL_POINT_COSTS,
  PLANS,
  SUPPORTED_MODELS,
  annualSavingCents,
  chargeForImages,
  cheapestPlanFor,
  estimatePoints,
  formatUsd,
  materialSurcharge,
  planAllowsPhotos,
  planAllowsModel,
  planFor,
  pointsPerQuestion,
  questionsForPoints,
} from './billing';

describe('plans', () => {
  it('has the four documented tiers', () => {
    expect(PLANS.map((plan) => plan.id)).toEqual(['free', 'light', 'standard', 'pro']);
    expect(PLANS.map((plan) => plan.monthlyCents)).toEqual([0, 499, 999, 1999]);
    expect(PLANS.map((plan) => plan.annualCents)).toEqual([0, 4_990, 9_990, 19_990]);
    expect(PLANS.map((plan) => plan.monthlyPoints)).toEqual([0, 500, 1_100, 2_500]);
    expect(PLANS.map((plan) => plan.monthlyQuestions)).toEqual([200, 0, 0, 0]);
  });

  it('prices the year at ten months', () => {
    for (const plan of PLANS.filter((candidate) => candidate.paid)) {
      expect(annualSavingCents(plan)).toBe(plan.monthlyCents * 2);
    }
  });

  it('falls back to free for an unknown plan id', () => {
    expect(planFor('gold').id).toBe('free');
    expect(planFor(null).id).toBe('free');
  });

  it('formats dollars without trailing zero cents', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(499)).toBe('$4.99');
    expect(formatUsd(19_990)).toBe('$199.90');
  });
});

describe('model permissions', () => {
  it('offers exactly three models, cheapest first', () => {
    expect(SUPPORTED_MODELS).toEqual(['glm-4.7-flash', 'deepseek-flash', 'deepseek-v4-pro']);
    expect(Object.keys(MODEL_POINT_COSTS)).toEqual([...SUPPORTED_MODELS]);
    for (const plan of PLANS) {
      for (const model of plan.models) expect(SUPPORTED_MODELS).toContain(model);
    }
  });

  it('keeps the free plan on the free model only', () => {
    expect(planAllowsModel('free', 'glm-4.7-flash')).toBe(true);
    expect(planAllowsModel('free', 'glm-5.3-flash')).toBe(false);
    expect(planAllowsModel('free', 'deepseek-flash')).toBe(false);
    expect(planAllowsPhotos('free')).toBe(false);
  });

  it('unlocks DeepSeek Flash at the light tier and Pro at standard', () => {
    expect(planAllowsModel('light', 'deepseek-flash')).toBe(true);
    expect(planAllowsModel('light', 'deepseek-v4-pro')).toBe(false);
    expect(planAllowsModel('standard', 'deepseek-v4-pro')).toBe(true);
    expect(planAllowsModel('pro', 'deepseek-v4-pro')).toBe(true);
    expect(cheapestPlanFor('deepseek-v4-pro')?.id).toBe('standard');
  });
});

describe('estimatePoints', () => {
  it('charges one point per DeepSeek Flash question and four per Pro question', () => {
    expect(pointsPerQuestion('glm-4.7-flash')).toBe(0);
    expect(pointsPerQuestion('deepseek-flash')).toBe(1);
    expect(pointsPerQuestion('deepseek-v4-pro')).toBe(DEEPSEEK_PRO_MULTIPLIER);
  });

  it('matches the worked examples in the design doc', () => {
    expect(estimatePoints({ model: 'glm-4.7-flash', count: 10 }).total).toBe(0);
    expect(
      estimatePoints({ model: 'deepseek-flash', count: 10, materialChars: 30_000 }).total,
    ).toBe(25);
    expect(
      estimatePoints({ model: 'deepseek-v4-pro', count: 20, materialChars: 120_000 }).total,
    ).toBe(125);
    expect(
      estimatePoints({ model: 'deepseek-v4-pro', count: 50, materialChars: 400_000 }).total,
    ).toBe(290);
    expect(estimatePoints({ count: 0, images: 5 }).total).toBe(50);
  });

  it('charges exactly one point for a single Flash question', () => {
    const estimate = estimatePoints({ model: 'deepseek-flash', count: 1 });
    expect(estimate.questions).toBe(1);
    expect(estimate.total).toBe(1);
  });

  it('charges nothing for a free-model request without images', () => {
    const estimate = estimatePoints({ model: 'glm-4.7-flash', count: 10 });
    expect(estimate.total).toBe(0);
  });

  it('converts a point balance into whole questions', () => {
    expect(questionsForPoints(500, 'deepseek-flash')).toBe(500);
    expect(questionsForPoints(500, 'deepseek-v4-pro')).toBe(125);
    expect(questionsForPoints(3, 'deepseek-v4-pro')).toBe(0);
    expect(questionsForPoints(500, 'glm-4.7-flash')).toBeNull();
  });
});

describe('materialSurcharge', () => {
  it('uses the four tiers', () => {
    expect(materialSurcharge(0)).toBe(0);
    expect(materialSurcharge(20_000)).toBe(0);
    expect(materialSurcharge(20_001)).toBe(15);
    expect(materialSurcharge(80_000)).toBe(15);
    expect(materialSurcharge(200_000)).toBe(45);
    expect(materialSurcharge(400_000)).toBe(90);
    expect(materialSurcharge(1_000_000)).toBe(90);
  });
});

describe('images', () => {
  it('uses the monthly image quota before charging points', () => {
    expect(chargeForImages('light', 0, 4)).toEqual({ points: 0, remaining: 6 });
    expect(chargeForImages('light', 8, 4)).toEqual({ points: 20, remaining: 0 });
    expect(chargeForImages('free', 0, 1)).toEqual({ points: 10, remaining: 0 });
  });
});

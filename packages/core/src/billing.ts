/**
 * Subscription plans and the point price list.
 *
 * One point is the price of one DeepSeek Flash question. Plans unlock models;
 * points pay for the work. The free plan is charged in questions per calendar
 * month instead of points. The numbers here mirror docs/SUBSCRIPTION_POINTS.md
 * and are the single source of truth for both the browser and the API, so a
 * price change is one edit rather than two that can drift apart.
 */

export type PlanId = 'free' | 'light' | 'standard' | 'pro';

export const PLAN_IDS: readonly PlanId[] = ['free', 'light', 'standard', 'pro'];

/** The free model. Free accounts may generate with this one only. */
export const FREE_MODEL = 'glm-4.7-flash';

/**
 * Every model this release offers, cheapest first. A provider may expose more
 * ids through its environment list, but a plan can only unlock these.
 */
export const SUPPORTED_MODELS = [
  'glm-4.7-flash',
  'deepseek-flash',
  'deepseek-v4-pro',
] as const;

export interface Plan {
  id: PlanId;
  /** Monthly price in US cents. */
  monthlyCents: number;
  /** Yearly price in US cents (ten months, two free). 0 for free. */
  annualCents: number;
  /** Points granted at each monthly reset (the plan's monthly allowance). */
  monthlyPoints: number;
  /**
   * AI images included each month, whether requested on their own or generated
   * with a deck; extra images cost points. Figures the app draws from structured
   * data are not images for billing: they never consume this quota, cost no
   * points and are unlimited on every plan.
   */
  imagesPerMonth: number;
  /**
   * Calendar-month question cap for a plan that does not spend points (the
   * free plan). Paid plans use points instead, so theirs is 0.
   */
  monthlyQuestions: number;
  /** Total material characters accepted in one generation. */
  materialChars: number;
  /**
   * Legacy rollover cap. Plan points are now replaced at each monthly reset and
   * never accumulate, so this value is informational only and not enforced.
   */
  pointCap: number;
  /** Paid plans queue ahead of free work. */
  priority: boolean;
  /** Text models this plan may call. */
  models: readonly string[];
  /** Features used by the UI. */
  paid: boolean;
}

const FREE_MODELS = [FREE_MODEL] as const;
const LIGHT_MODELS = ['glm-4.7-flash', 'deepseek-flash'] as const;
const STANDARD_MODELS = [...LIGHT_MODELS, 'deepseek-v4-pro'] as const;

export const PLANS: readonly Plan[] = [
  {
    id: 'free',
    monthlyCents: 0,
    annualCents: 0,
    monthlyPoints: 0,
    imagesPerMonth: 0,
    monthlyQuestions: 200,
    materialChars: 10_000,
    pointCap: 0,
    priority: false,
    models: FREE_MODELS,
    paid: false,
  },
  {
    id: 'light',
    monthlyCents: 499,
    annualCents: 4_990,
    monthlyPoints: 500,
    imagesPerMonth: 10,
    monthlyQuestions: 0,
    materialChars: 100_000,
    pointCap: 1_000,
    priority: false,
    models: LIGHT_MODELS,
    paid: true,
  },
  {
    id: 'standard',
    monthlyCents: 999,
    annualCents: 9_990,
    monthlyPoints: 1_100,
    imagesPerMonth: 40,
    monthlyQuestions: 0,
    materialChars: 200_000,
    pointCap: 2_200,
    priority: true,
    models: STANDARD_MODELS,
    paid: true,
  },
  {
    id: 'pro',
    monthlyCents: 1_999,
    annualCents: 19_990,
    monthlyPoints: 2_500,
    imagesPerMonth: 100,
    monthlyQuestions: 0,
    materialChars: 400_000,
    pointCap: 5_000,
    priority: true,
    models: STANDARD_MODELS,
    paid: true,
  },
];

const PLAN_MAP = new Map<PlanId, Plan>(PLANS.map((plan) => [plan.id, plan]));

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && PLAN_MAP.has(value as PlanId);
}

/** Unknown ids fall back to free, so a stale row can never unlock anything. */
export function planFor(id: unknown): Plan {
  return (isPlanId(id) ? PLAN_MAP.get(id) : undefined) ?? PLANS[0]!;
}

/** Points per US dollar; one point is one cent. */
export const POINTS_PER_USD = 100;

export function centsToPoints(cents: number): number {
  return Math.round(cents);
}

export function usdFromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** `$4.99`, `$0`, `$199.90` — no trailing `.00`. */
export function formatUsd(cents: number): string {
  const value = usdFromCents(cents);
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

export function annualSavingCents(plan: Plan): number {
  return Math.max(0, plan.monthlyCents * 12 - plan.annualCents);
}

/** Effective monthly price on the annual plan, in cents (rounded). */
export function annualMonthlyCents(plan: Plan): number {
  return plan.annualCents === 0 ? 0 : Math.round(plan.annualCents / 12);
}

// -- Point price list -------------------------------------------------------

/**
 * Points charged per generated question, by model id.
 *
 * DeepSeek Flash is the unit: one Flash question costs one point. DeepSeek V4
 * Pro costs the same multiple of that unit as its list price is to Flash. The
 * provider prices are about 3.5×; the multiplier is rounded up to a whole point
 * (4) so a Pro question can never be cheaper than its share of the bill.
 *
 * The catalogue has exactly three models. Unknown models use the highest rate:
 * a newly added expensive model must not be accidentally cheap, and the server
 * rejects models a plan may not use.
 */
export const MODEL_POINT_COSTS: Readonly<Record<string, number>> = {
  'glm-4.7-flash': 0,
  'deepseek-flash': 1,
  'deepseek-v4-pro': 4,
};

/** The DeepSeek Pro multiplier, kept separately for display and documentation. */
export const DEEPSEEK_PRO_MULTIPLIER = 4;

export const DEFAULT_MODEL_POINTS = DEEPSEEK_PRO_MULTIPLIER;

/** A standalone illustration. Illustrations inside a deck are included. */
export const IMAGE_POINTS = 10;

export interface MaterialTier {
  /** Upper bound in characters. */
  maxChars: number;
  points: number;
}

export const MATERIAL_TIERS: readonly MaterialTier[] = [
  { maxChars: 20_000, points: 0 },
  { maxChars: 80_000, points: 15 },
  { maxChars: 200_000, points: 45 },
  { maxChars: 400_000, points: 90 },
];

export function materialSurcharge(chars: number): number {
  const safe = Number.isFinite(chars) && chars > 0 ? chars : 0;
  for (const tier of MATERIAL_TIERS) {
    if (safe <= tier.maxChars) return tier.points;
  }
  return MATERIAL_TIERS[MATERIAL_TIERS.length - 1]?.points ?? 90;
}

export function pointsPerQuestion(model: string | undefined): number {
  if (!model) return DEFAULT_MODEL_POINTS;
  return MODEL_POINT_COSTS[model] ?? DEFAULT_MODEL_POINTS;
}

/**
 * How many questions a point balance still buys on a model. Null means the
 * model is free (zero points), so its limit comes from the plan's monthly
 * question quota instead.
 */
export function questionsForPoints(points: number, model: string | undefined): number | null {
  const perQuestion = pointsPerQuestion(model);
  if (perQuestion <= 0) return null;
  return Math.max(0, Math.floor(Math.max(0, points) / perQuestion));
}

export interface PointEstimate {
  /** Points for the questions themselves. */
  questions: number;
  /** Extra points for long material. */
  materials: number;
  /** Points for standalone images; zero when covered by the monthly quota. */
  images: number;
  /** What the server reserves before the work starts. */
  total: number;
  perQuestion: number;
}

export interface EstimateInput {
  model?: string | undefined;
  count: number;
  materialChars?: number | undefined;
  /** Standalone images outside the plan quota. */
  images?: number | undefined;
}

export function estimatePoints(input: EstimateInput): PointEstimate {
  const count = Math.max(0, Math.round(input.count || 0));
  const perQuestion = pointsPerQuestion(input.model);
  const questions = perQuestion * count;
  const materials = materialSurcharge(input.materialChars ?? 0);
  const images = Math.max(0, Math.round(input.images ?? 0)) * IMAGE_POINTS;
  return { questions, materials, images, total: questions + materials + images, perQuestion };
}

// -- Plan permissions -------------------------------------------------------

export function planAllowsModel(plan: PlanId | Plan, model: string): boolean {
  const entry = typeof plan === 'string' ? planFor(plan) : plan;
  return entry.models.includes(model);
}

/** True when the plan includes AI photos (standalone or in a deck). */
export function planAllowsPhotos(plan: PlanId | Plan): boolean {
  const entry = typeof plan === 'string' ? planFor(plan) : plan;
  return entry.imagesPerMonth > 0;
}

/**
 * @deprecated Use `planAllowsPhotos`. The old name suggested that rendered
 * figures were also gated, but they are free on every plan.
 */
export const planAllowsImages = planAllowsPhotos;

/** True when the plan can generate without spending points. */
export function planUsesFreeModel(plan: PlanId | Plan): boolean {
  const entry = typeof plan === 'string' ? planFor(plan) : plan;
  return !entry.paid;
}

/** The cheapest plan that unlocks a model, for the upgrade prompt. */
export function cheapestPlanFor(model: string): Plan | null {
  for (const plan of PLANS) {
    if (plan.paid && plan.models.includes(model)) return plan;
  }
  return null;
}

// -- Images -----------------------------------------------------------------

export interface ImageCharge {
  /** Points to charge now; 0 when the monthly quota covers it. */
  points: number;
  /** Remaining included images after this request. */
  remaining: number;
}

/**
 * Charge for AI-generated images. `requested` must count only photos from the
 * image model (or web image search); app-rendered figures are never passed in,
 * so they cannot consume the monthly quota.
 */
export function chargeForImages(
  plan: PlanId | Plan,
  imagesUsedThisPeriod: number,
  requested: number,
): ImageCharge {
  const entry = typeof plan === 'string' ? planFor(plan) : plan;
  const count = Math.max(0, Math.round(requested));
  const left = Math.max(0, entry.imagesPerMonth - Math.max(0, imagesUsedThisPeriod));
  const included = Math.min(count, left);
  return { points: (count - included) * IMAGE_POINTS, remaining: left - included };
}

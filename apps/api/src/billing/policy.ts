/**
 * Plan and point enforcement for AI work.
 *
 * The flow is reserve → run → settle. Points for the requested number of
 * questions are charged before the provider is called, then the difference for
 * anything that was not delivered is refunded. A failed run is refunded in
 * full. Every ledger entry carries the HTTP request id, so a retry cannot
 * charge twice.
 */
import {
  cheapestPlanFor,
  estimatePoints,
  formatUsd,
  IMAGE_POINTS,
  planAllowsModel,
  planAllowsPhotos,
  planFor,
  type Plan,
  type PointEstimate,
} from '@mengyin/core';
import type { Env } from '../env';
import type { AuthContext } from '../http/auth';
import { badRequest, paymentRequired } from '../errors';
import {
  billingEnforced,
  readSnapshot,
  refundPoints,
  refundQuestions,
  spendPoints,
  takeImages,
  takeQuestions,
  type BillingSnapshot,
} from './store';

export interface GenerationPolicy {
  /** False when the operator has not switched billing on. */
  enforced: boolean;
  plan: Plan;
  snapshot: BillingSnapshot | null;
  /** Image mode after the plan has had its say. */
  imageMode: 'off' | 'auto' | 'on';
  /**
   * True when the plan does not include AI photos (the free tier). Rendered
   * figures are still allowed: they cost nothing and are not images for billing.
   */
  imagesBlocked: boolean;
  /** True when AI photos (generated or web-searched) are included. */
  photosAllowed: boolean;
  estimate: PointEstimate;
  requestId: string;
  /** Points actually reserved, for the refund calculation. */
  reserved: number;
  /** Free-plan questions reserved; zero for a plan that spends points. */
  reservedQuestions: number;
  /** The plan's calendar-month question cap; zero when there is none. */
  questionLimit: number;
}

export interface GenerationLimitsInput {
  model: string;
  count: number;
  materialChars: number;
  imageMode: 'off' | 'auto' | 'on';
  /** True when the learner supplied their own provider key for this request. */
  byoKey?: boolean;
}

/** Plan used for a deployment that has billing switched off. */
const UNRESTRICTED = 'pro' as const;

export async function resolveGenerationPolicy(
  env: Env,
  auth: AuthContext,
  input: GenerationLimitsInput,
  requestId: string,
): Promise<GenerationPolicy> {
  const enforced = billingEnforced(env) && Boolean(auth.userId);

  // A learner's own key means the provider bill is theirs: nothing is reserved
  // or charged, and the free plan may generate. Their plan still decides
  // whether AI photos (which use this server's image provider) are allowed.
  if (input.byoKey) {
    let plan = planFor(UNRESTRICTED);
    let snapshot: BillingSnapshot | null = null;
    if (billingEnforced(env) && auth.userId) {
      try {
        snapshot = await readSnapshot(env, auth);
        plan = planFor(snapshot.plan);
      } catch {
        plan = planFor(UNRESTRICTED);
      }
    }
    const photosAllowed = planAllowsPhotos(plan);
    return {
      enforced: false,
      plan,
      snapshot,
      imageMode: input.imageMode,
      imagesBlocked: input.imageMode !== 'off' && !photosAllowed,
      photosAllowed,
      estimate: estimatePoints({
        model: input.model,
        count: input.count,
        materialChars: input.materialChars,
      }),
      requestId,
      reserved: 0,
      reservedQuestions: 0,
      questionLimit: 0,
    };
  }

  if (!enforced) {
    return {
      enforced: false,
      plan: planFor(UNRESTRICTED),
      snapshot: null,
      imageMode: input.imageMode,
      imagesBlocked: false,
      photosAllowed: true,
      estimate: estimatePoints({ model: input.model, count: input.count, materialChars: input.materialChars }),
      requestId,
      reserved: 0,
      reservedQuestions: 0,
      questionLimit: 0,
    };
  }

  const snapshot = await readSnapshot(env, auth);
  // billing_snapshot already downgrades an expired/past-due subscription to
  // free, so a client cannot keep a paid model by editing local state.
  const plan = planFor(snapshot.plan);

  if (!planAllowsModel(plan, input.model)) {
    const upgrade = cheapestPlanFor(input.model);
    const lapsed = plan.id === 'free' && snapshot.storedPlan !== 'free';
    throw paymentRequired(
      (lapsed
        ? `Your ${snapshot.storedPlan} subscription is not active, so ${input.model} is unavailable.`
        : `The ${plan.id} plan cannot use ${input.model}.`) +
        (upgrade ? ` Renew or upgrade to ${upgrade.id} (${formatUsd(upgrade.monthlyCents)}/month) to unlock it.` : ''),
    );
  }

  // There is deliberately no per-run question ceiling: the free monthly quota
  // or the point balance is the only bound. A large request is reserved up
  // front, so it cannot overdraw the wallet halfway through.
  if (input.materialChars > plan.materialChars) {
    throw badRequest(
      `The ${plan.id} plan accepts at most ${plan.materialChars.toLocaleString()} characters of material per generation.`,
    );
  }

  const photosAllowed = planAllowsPhotos(plan);
  // Rendered figures are free on every plan, so the requested mode stays as it
  // is and the planner may still draw diagrams for a free account. Only AI
  // photos are blocked, and `photosAllowed` is passed down to the generator.
  const imagesBlocked = input.imageMode !== 'off' && !photosAllowed;
  const imageMode = input.imageMode;

  // AI images are charged after they are actually attached, because a deck may
  // need fewer pictures than questions. The monthly image quota is used first;
  // extras cost points. App-rendered figures never reach that path.
  const estimate = estimatePoints({
    model: input.model,
    count: input.count,
    materialChars: input.materialChars,
  });

  // The free plan pays in questions per calendar month, reserved through a
  // service-role RPC. Paid plans pay in points. The reservation happens before
  // the provider is called, so parallel tabs cannot exceed the quota.
  let reservedQuestions = 0;
  const questionLimit = plan.paid ? 0 : plan.monthlyQuestions;
  if (questionLimit > 0) {
    await takeQuestions(env, auth, input.count, questionLimit, `gen:${requestId}`);
    reservedQuestions = input.count;
  }

  const reserved = estimate.total;
  if (reserved > 0) {
    await spendPoints(env, auth, reserved, 'generation', `gen:${requestId}`, {
      model: input.model,
      count: input.count,
      materialChars: input.materialChars,
    });
  }

  return {
    enforced,
    plan,
    snapshot,
    imageMode,
    imagesBlocked,
    photosAllowed,
    estimate,
    requestId,
    reserved,
    reservedQuestions,
    questionLimit,
  };
}

/**
 * Refund the questions that were not delivered. Charging happens for the
 * requested count, so a shortfall (provider error, partial batch) is returned
 * to the wallet without an operator touching anything.
 */
export async function settleGeneration(
  env: Env,
  auth: AuthContext,
  policy: GenerationPolicy,
  deliveredQuestions: number,
): Promise<void> {
  if (!policy.enforced) return;
  const delivered = Math.max(0, deliveredQuestions);

  // Free plan: give back the questions that were not generated.
  if (policy.reservedQuestions > 0) {
    const used = Math.min(delivered, policy.reservedQuestions);
    const refund = policy.reservedQuestions - used;
    if (refund > 0) {
      await refundQuestions(env, auth, refund, `gen:${policy.requestId}:qrefund`);
    }
  }

  if (policy.reserved <= 0) return;
  const charged = policy.estimate.perQuestion === 0 ? 0 : delivered * policy.estimate.perQuestion;
  const refund = Math.max(0, policy.estimate.questions - charged);
  if (refund <= 0) return;
  await refundPoints(env, auth, refund, 'generation-refund', `gen:${policy.requestId}:refund`, {
    delivered,
  });
}

/** Return the whole reservation after a failed run. */
export async function cancelGeneration(
  env: Env,
  auth: AuthContext,
  policy: GenerationPolicy,
  reason: string,
): Promise<void> {
  if (!policy.enforced) return;
  if (policy.reservedQuestions > 0) {
    await refundQuestions(env, auth, policy.reservedQuestions, `gen:${policy.requestId}:qrefund`);
  }
  if (policy.reserved <= 0) return;
  await refundPoints(env, auth, policy.reserved, 'generation-refund', `gen:${policy.requestId}:refund`, {
    reason,
  });
}

export interface ImagePolicy {
  enforced: boolean;
  plan: Plan;
  /** Points charged for images beyond the monthly quota. */
  points: number;
  requestId: string;
}

/**
 * Charge one standalone AI image request. The plan's monthly quota is used
 * first; anything beyond it costs IMAGE_POINTS. A free account has no quota.
 *
 * Only generated photos reach this function. A figure drawn by the app from a
 * structured spec is attached during deck generation and is never an image
 * request, so it cannot consume this quota.
 */
export async function chargeStandaloneImage(
  env: Env,
  auth: AuthContext,
  requestId: string,
): Promise<ImagePolicy> {
  const enforced = billingEnforced(env) && Boolean(auth.userId);
  if (!enforced) {
    return { enforced: false, plan: planFor(UNRESTRICTED), points: 0, requestId };
  }

  const snapshot = await readSnapshot(env, auth);
  const plan = planFor(snapshot.plan);
  if (!planAllowsPhotos(plan)) {
    const upgrade = cheapestPlanFor('deepseek-flash');
    throw paymentRequired(
      'Image generation needs a paid plan.' +
        (upgrade ? ` The ${upgrade.id} plan includes images from ${formatUsd(upgrade.monthlyCents)}/month.` : ''),
    );
  }

  const taken = await takeImages(env, auth, 1, plan.imagesPerMonth);
  const points = taken.extra * 10;
  if (points > 0) {
    await spendPoints(env, auth, points, 'image', `img:${requestId}`, {});
  }
  return { enforced: true, plan, points, requestId };
}

export async function refundStandaloneImage(
  env: Env,
  auth: AuthContext,
  policy: ImagePolicy,
  reason: string,
): Promise<void> {
  if (!policy.enforced || policy.points <= 0) return;
  await refundPoints(env, auth, policy.points, 'image-refund', `img:${policy.requestId}:refund`, { reason });
}

/**
 * Account for AI photos generated as part of a deck. The monthly image quota
 * is used first; photos beyond it cost IMAGE_POINTS, exactly like a standalone
 * image. Web-search reference photos are not AI generations and are not passed
 * here.
 */
export async function chargeDeckImages(
  env: Env,
  auth: AuthContext,
  policy: GenerationPolicy,
  count: number,
): Promise<number> {
  if (!policy.enforced || count <= 0) return 0;
  const taken = await takeImages(env, auth, count, policy.plan.imagesPerMonth);
  const points = taken.extra * IMAGE_POINTS;
  if (points > 0) {
    await spendPoints(env, auth, points, 'image', `gen-img:${policy.requestId}`, {
      count,
      imagesUsed: taken.imagesUsed,
    });
  }
  return points;
}

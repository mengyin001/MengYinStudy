/**
 * Optional per-account daily quotas.
 *
 * The API is protected by a Supabase account, but a free image allocation
 * should not be spendable by one account in a loop. Bind a KV namespace as
 * `AI_QUOTA` to enforce these; with no binding the service runs without a
 * per-account cap (Cloudflare's own rate limiting still applies).
 */
import type { Env } from '../env';
import { isApiError, quotaExceeded } from '../errors';

export interface QuotaLimits {
  questions: number;
  images: number;
}

function limit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed));
}

export function quotaLimits(env: Env): QuotaLimits {
  return {
    questions: limit(env.AI_DAILY_QUESTIONS, 120),
    images: limit(env.AI_DAILY_IMAGES, 30),
  };
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Consume quota before the expensive call. `0` or a missing KV binding means
 * unlimited. A storage failure fails open so an outage does not take AI down.
 */
export async function consumeQuota(
  env: Env,
  userId: string | null,
  kind: 'questions' | 'images',
  amount: number,
  now: () => number = Date.now,
): Promise<void> {
  if (!env.AI_QUOTA || !userId || amount <= 0) return;
  const cap = quotaLimits(env)[kind];
  if (cap <= 0) return;

  const key = `quota:${utcDay(now())}:${userId}:${kind}`;
  try {
    const current = Number((await env.AI_QUOTA.get(key)) ?? 0) || 0;
    if (current + amount > cap) {
      throw quotaExceeded(
        `The daily ${kind === 'questions' ? 'question' : 'image'} limit (${cap}) is used up. Try again tomorrow.`,
      );
    }
    await env.AI_QUOTA.put(key, String(current + amount), { expirationTtl: 172_800 });
  } catch (error) {
    if (isApiError(error)) throw error;
    // KV outage: do not fail a learner's generation over bookkeeping.
    console.warn('AI quota storage unavailable', error instanceof Error ? error.message : String(error));
  }
}

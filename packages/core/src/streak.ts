/**
 * The streak flame.
 *
 * The flame is dark until a learner has practised on three consecutive days;
 * one missed day puts it out and the count restarts. Once lit it changes colour
 * every three days, up to the thirty-day maximum.
 */

export const STREAK_UNLOCK_DAYS = 3;
export const STREAK_MAX_DAYS = 30;
export const STREAK_TIER_DAYS = 3;

export interface StreakTier {
  /** First streak length that shows this colour. */
  min: number;
  /** Stable id used for the CSS class and tests. */
  id: string;
  /** Accent colour, also used for the glow. */
  color: string;
}

/** Ten colours, one every three days, from the first lit day to day thirty. */
export const STREAK_TIERS: readonly StreakTier[] = [
  { min: 3, id: 'spark', color: '#f59e0b' },
  { min: 6, id: 'ember', color: '#fb923c' },
  { min: 9, id: 'coral', color: '#f87171' },
  { min: 12, id: 'rose', color: '#f43f5e' },
  { min: 15, id: 'orchid', color: '#c084fc' },
  { min: 18, id: 'indigo', color: '#818cf8' },
  { min: 21, id: 'sky', color: '#60a5fa' },
  { min: 24, id: 'teal', color: '#2dd4bf' },
  { min: 27, id: 'jade', color: '#34d399' },
  { min: 30, id: 'aurora', color: '#22d3ee' },
];

export interface StreakStatus {
  /** Consecutive days ending today (or yesterday when today is not done yet). */
  current: number;
  best: number;
  /** The flame is lit from the third consecutive day. */
  lit: boolean;
  /** Index into STREAK_TIERS, or -1 while the flame is out. */
  tierIndex: number;
  tier: StreakTier | null;
  /** The next colour, or null at the thirty-day maximum. */
  next: StreakTier | null;
  /** Days still needed for the next colour. */
  daysToNext: number;
  /** Progress within the current colour band, 0–1. */
  bandProgress: number;
  /** Progress towards the thirty-day maximum, 0–1. */
  progress: number;
  /** Days until the flame lights, 0 once lit. */
  daysToLight: number;
}

function clampDays(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(STREAK_MAX_DAYS, Math.trunc(value)));
}

export function streakTierFor(current: number): StreakTier | null {
  const days = clampDays(current);
  if (days < STREAK_UNLOCK_DAYS) return null;
  let match: StreakTier | null = null;
  for (const tier of STREAK_TIERS) {
    if (days >= tier.min) match = tier;
    else break;
  }
  return match;
}

export function streakStatus(current: number, best = 0): StreakStatus {
  const days = Math.min(STREAK_MAX_DAYS, Math.max(0, Number.isFinite(current) ? Math.trunc(current) : 0));
  const bestDays = Math.max(days, Math.max(0, Number.isFinite(best) ? Math.trunc(best) : 0));
  const tier = streakTierFor(days);
  const lit = tier !== null;
  const tierIndex = tier ? STREAK_TIERS.findIndex((candidate) => candidate.id === tier.id) : -1;
  const next = tierIndex >= 0 && tierIndex + 1 < STREAK_TIERS.length ? STREAK_TIERS[tierIndex + 1]! : null;

  const bandStart = tier ? tier.min : 0;
  const bandEnd = next ? next.min : STREAK_MAX_DAYS;
  const bandProgress = lit
    ? Math.min(1, Math.max(0, (days - bandStart) / Math.max(1, bandEnd - bandStart)))
    : 0;

  return {
    current: days,
    best: bestDays,
    lit,
    tierIndex,
    tier,
    next,
    daysToNext: next ? Math.max(1, next.min - days) : 0,
    bandProgress,
    progress: Math.min(1, days / STREAK_MAX_DAYS),
    daysToLight: lit ? 0 : Math.max(0, STREAK_UNLOCK_DAYS - days),
  };
}

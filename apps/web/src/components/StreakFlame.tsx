import { streakStatus } from '@mengyin/core';
import type { CSSProperties } from 'react';
import { Icon } from './Icons';

export interface StreakFlameProps {
  current: number;
  best?: number;
  size?: number;
  /** Accessible description, e.g. "6-day streak · 3 days to the next colour". */
  label: string;
  className?: string;
}

/**
 * The streak flame.
 *
 * Dark until the third consecutive day. From then on it takes the colour of the
 * current band (a new colour every three days, ten bands up to day thirty).
 */
export function StreakFlame({ current, best = 0, size = 15, label, className = '' }: StreakFlameProps) {
  const status = streakStatus(current, best);
  const style = status.tier
    ? ({ '--flame': status.tier.color } as CSSProperties)
    : undefined;

  return (
    <span
      className={`streak-flame ${status.lit ? 'is-lit' : 'is-out'} ${className}`}
      data-tier={status.tier?.id ?? 'off'}
      style={style}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon name="flame" size={size} strokeWidth={1.7} />
    </span>
  );
}

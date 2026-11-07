import { streakStatus } from '@mengyin/core';
import type { Translate } from '@/i18n/messages';

/** One description used by the tooltip and the screen-reader label. */
export function streakLabel(current: number, best: number, t: Translate): string {
  const status = streakStatus(current, best);
  if (!status.lit) return t('streak.outLabel', { n: status.current });
  if (!status.next) return t('streak.maxLabel', { n: status.current });
  return t('streak.litLabel', { n: status.current, next: status.daysToNext });
}

/** The short line under the flame, e.g. "3 more days to the next colour". */
export function streakHint(current: number, best: number, t: Translate): string {
  const status = streakStatus(current, best);
  if (!status.lit) return t('streak.locked');
  if (!status.next) return t('streak.max');
  return t('streak.next', { n: status.daysToNext });
}

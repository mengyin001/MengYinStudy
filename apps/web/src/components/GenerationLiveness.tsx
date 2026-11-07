import { useEffect, useState } from 'react';
import { waitingMessageKey } from '@/ai/progress';
import type { Translate } from '@/i18n/messages';

interface GenerationLivenessProps {
  /** `Date.now()` when the run started. */
  startedAt: number;
  t: Translate;
}

/**
 * Isolated one-second clock.
 *
 * It is a separate component on purpose: re-rendering the whole Generate page
 * (which may hold dozens of question cards) once per second would be wasteful,
 * and the rotating line only needs to prove that the request is still alive.
 */
export function GenerationLiveness({ startedAt, t }: GenerationLivenessProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="gen-status__wait">
      <span className="gen-status__pulse" aria-hidden="true" />
      <span>{t(waitingMessageKey(seconds))}</span>
      <span className="gen-status__elapsed">{t('gen.elapsed', { seconds })}</span>
    </span>
  );
}

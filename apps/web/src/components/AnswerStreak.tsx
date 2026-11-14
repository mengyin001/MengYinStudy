import { useEffect, useMemo, type CSSProperties } from 'react';
import { Icon } from './Icons';

export interface AnswerStreakBurstState {
  id: number;
  streak: number;
}

/**
 * The live counter in the session bar. It appears from the second consecutive
 * correct answer, which is the point where "in a row" starts to mean something.
 */
export function AnswerStreakBadge({ streak, label }: { streak: number; label: string }) {
  if (streak < 2) return null;
  return (
    <span
      className={`answer-streak ${streak >= 3 ? 'is-hot' : ''}`}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon name="flame" size={14} strokeWidth={1.7} />
      <span className="answer-streak__count" key={streak}>
        {streak}
      </span>
    </span>
  );
}

interface Particle {
  dx: number;
  dy: number;
  rot: number;
  delay: number;
  size: number;
  token: string;
}

/** Deterministic particles: the same streak always throws the same confetti. */
function particlesFor(streak: number): Particle[] {
  const tokens = ['--accent', '--ok', '--warn'];
  return Array.from({ length: 20 }, (_, index) => {
    const angle = (Math.PI * 2 * index) / 20 + ((streak * 7) % 11) * 0.035;
    const distance = 72 + ((index * 37 + streak * 13) % 96);
    return {
      dx: Math.round(Math.cos(angle) * distance),
      dy: Math.round(Math.sin(angle) * distance - 18),
      rot: (index * 67 + streak * 11) % 360,
      delay: (index % 6) * 26,
      size: 5 + ((index * 3 + streak) % 5),
      token: tokens[index % tokens.length] ?? '--accent',
    };
  });
}

const BURST_MS = 1700;

/**
 * A brief, pointer-transparent celebration at a streak milestone. The parent
 * unmounts it after the animation, so it can never block the next question.
 */
export function AnswerStreakBurst({
  burst,
  message,
  onDone,
}: {
  burst: AnswerStreakBurstState;
  message: string;
  onDone: () => void;
}) {
  const particles = useMemo(() => particlesFor(burst.streak), [burst.streak]);

  useEffect(() => {
    const timer = window.setTimeout(onDone, BURST_MS);
    return () => window.clearTimeout(timer);
  }, [burst.id, onDone]);

  return (
    <div
      className="streak-celebration"
      role="status"
      aria-live="polite"
      aria-label={message}
      data-streak={burst.streak}
    >
      <div className="streak-celebration__particles" aria-hidden="true">
        {particles.map((particle, index) => (
          <span
            key={`${burst.id}-${index}`}
            className="streak-celebration__particle"
            style={
              {
                '--dx': `${particle.dx}px`,
                '--dy': `${particle.dy}px`,
                '--rot': `${particle.rot}deg`,
                '--delay': `${particle.delay}ms`,
                '--size': `${particle.size}px`,
                '--dot': `var(${particle.token})`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="streak-celebration__card" aria-hidden="true">
        <span className="streak-celebration__flame">
          <Icon name="flame" size={22} strokeWidth={1.6} />
        </span>
        <span className="streak-celebration__count">{burst.streak}</span>
        <span className="streak-celebration__text">{message}</span>
      </div>
    </div>
  );
}

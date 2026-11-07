/**
 * Reassurance while a provider is thinking.
 *
 * A reasoning model can spend minutes on one batch before the next SSE event
 * arrives. The progress stage is accurate but static, so the Generate page also
 * rotates a short line and shows elapsed seconds: that is the difference
 * between "still working" and "the tab has hung".
 */
export const WAITING_MESSAGE_KEYS = [
  'gen.wait1',
  'gen.wait2',
  'gen.wait3',
  'gen.wait4',
  'gen.wait5',
] as const;

export type WaitingMessageKey = (typeof WAITING_MESSAGE_KEYS)[number];

/** Rotate every 9 seconds, starting with the first message. */
export const WAITING_ROTATE_SECONDS = 9;

export function waitingMessageKey(seconds: number): WaitingMessageKey {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const slot = Math.floor(safe / WAITING_ROTATE_SECONDS);
  return WAITING_MESSAGE_KEYS[slot % WAITING_MESSAGE_KEYS.length]!;
}

/**
 * Stale-reply guard for the cloud-deck list.
 *
 * A refresh started before a delete resolves with the account as it was — the
 * deck that was just deleted is still in that reply. Painting it puts the deck
 * back on screen about a second later, so the learner has to delete it twice.
 * A write therefore invalidates every refresh that started before it, and a
 * refresh only dispatches when its token is still the current one.
 */
export interface RefreshGuard {
  /** Call at the start of a refresh; the returned token identifies its reply. */
  begin(): number;
  /** Call at the start of a write so earlier replies are dropped. */
  invalidate(): void;
  /** True when nothing invalidated this token, and no newer refresh started. */
  accept(token: number): boolean;
}

export function createRefreshGuard(): RefreshGuard {
  let token = 0;
  return {
    begin: () => {
      token += 1;
      return token;
    },
    invalidate: () => {
      token += 1;
    },
    accept: (issued) => issued === token,
  };
}

/**
 * The question-count ceiling shown on Generate.
 *
 * There is no per-run question cap: a paid plan is bounded by its points, and
 * an own provider key is billed by that provider. Only a free account spending
 * the server's provider is limited to the questions it has left this calendar
 * month. `undefined` means the field has no UI ceiling.
 */
export interface QuestionCountLimit {
  /** The app has hydrated its saved settings, including the own key. */
  hydrated: boolean;
  /** Billing is actually enforced for this account. */
  enforced: boolean;
  /** The account's plan is a paid plan. */
  paid: boolean;
  /** The learner selected their own provider key for this run. */
  byo: boolean;
  /** Questions left this month, or null when the snapshot has no value. */
  remaining: number | null | undefined;
  /** The free plan's monthly question allowance. */
  monthly: number;
}

export function questionCountCeiling(input: QuestionCountLimit): number | undefined {
  // Before hydration, `aiSettings` is still the default without the saved key.
  // Clamping here would turn a configured own-key run into one question before
  // the key has had a chance to load.
  if (!input.hydrated) return undefined;
  if (!input.enforced || input.paid || input.byo) return undefined;
  return Math.max(1, input.remaining ?? input.monthly);
}

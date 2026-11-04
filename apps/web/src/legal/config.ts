/**
 * Operator details for the Privacy Policy and the Terms of Service.
 *
 * Everything here is deliberately centralised: the documents are served twice
 * (as SPA routes and as standalone HTML for app-store review), and a wrong
 * date, version or contact in one copy is exactly the kind of inconsistency a
 * reviewer rejects. Change the values here and rebuild.
 */

/** Bumped whenever the wording of either document changes materially. */
export const LEGAL_VERSION = '1.2';

/** ISO date the current wording took effect. Shown as-is in both documents. */
export const LEGAL_UPDATED = '2026-11-04';

/**
 * Support and privacy mailbox. Published on purpose: it is the address an app
 * store reviewer and a learner both write to, and the one account-deletion
 * requests fall back to when the in-app flow cannot be used.
 */
export const CONTACT_EMAIL = 'mengyinqwq@gmail.com';

export interface LegalContext {
  /** Trading name shown as the data controller. */
  operator: string;
  /** Support/privacy mailbox. */
  contactEmail: string;
  /** Public origin, used for canonical links inside the documents. */
  origin: string;
  updated: string;
  version: string;
}

interface LegalEnv {
  VITE_LEGAL_OPERATOR?: string;
  VITE_LEGAL_CONTACT_EMAIL?: string;
  VITE_PUBLIC_ORIGIN?: string;
}

export function legalContext(overrides: Partial<LegalContext> = {}): LegalContext {
  return {
    operator: 'MengYin Study',
    contactEmail: CONTACT_EMAIL,
    origin: '',
    updated: LEGAL_UPDATED,
    version: LEGAL_VERSION,
    ...overrides,
  };
}

/**
 * Browser-side context. `origin` falls back to the page itself so the
 * documents can name their own address without a hard-coded domain.
 */
export function browserLegalContext(): LegalContext {
  const env = (import.meta.env ?? {}) as LegalEnv;
  const origin =
    env.VITE_PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') ||
    (typeof window === 'undefined' ? '' : window.location.origin);
  const overrides: Partial<LegalContext> = { origin };
  const operator = env.VITE_LEGAL_OPERATOR?.trim();
  if (operator) overrides.operator = operator;
  const contactEmail = env.VITE_LEGAL_CONTACT_EMAIL?.trim();
  if (contactEmail) overrides.contactEmail = contactEmail;
  return legalContext(overrides);
}

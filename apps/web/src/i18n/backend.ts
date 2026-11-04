import type { BackendError, BackendErrorCode } from '@/services/errors';
import type { MessageKey, Translate } from './messages';

const KEYS: Partial<Record<BackendErrorCode, MessageKey>> = {
  unconfigured: 'auth.error.unconfigured',
  'not-ready': 'auth.error.notReady',
  network: 'auth.error.network',
  server: 'auth.error.server',
  unauthorized: 'auth.error.unauthorized',
  forbidden: 'auth.error.forbidden',
  'invalid-credentials': 'auth.error.invalidCredentials',
  'email-unconfirmed': 'auth.error.emailUnconfirmed',
  'email-taken': 'auth.error.emailTaken',
  'weak-password': 'auth.error.weakPassword',
  'same-password': 'auth.error.samePassword',
  'rate-limited': 'auth.error.rateLimited',
  'link-expired': 'auth.error.linkExpired',
  'provider-disabled': 'auth.error.providerDisabled',
  'signup-disabled': 'auth.error.signupDisabled',
  'profile-missing': 'auth.error.profileMissing',
  'invalid-data': 'auth.error.invalidData',
};

export function backendErrorKey(error: BackendError): MessageKey | null {
  return KEYS[error.code] ?? null;
}

/**
 * A translated sentence for a service error. Server messages are a fallback,
 * never the primary text, because they are English and leak implementation
 * details.
 */
export function describeBackendError(error: BackendError, t: Translate): string {
  const key = backendErrorKey(error);
  if (key) return t(key);
  return error.message;
}

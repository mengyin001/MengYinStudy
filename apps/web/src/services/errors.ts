/**
 * Language-neutral backend errors.
 *
 * Services never return Supabase objects or i18n keys to the UI. They return a
 * `BackendError` with a stable code; `i18n/backend.ts` maps the code to a
 * translated sentence and falls back to the server message.
 */

export type BackendErrorCode =
  | 'unconfigured'
  | 'not-ready'
  | 'network'
  | 'server'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-credentials'
  | 'email-unconfirmed'
  | 'email-taken'
  | 'weak-password'
  | 'same-password'
  | 'rate-limited'
  | 'link-expired'
  | 'provider-disabled'
  | 'signup-disabled'
  | 'profile-missing'
  | 'invalid-data'
  | 'quota'
  | 'unknown';

export class BackendError extends Error {
  readonly code: BackendErrorCode;
  readonly details: string | null;

  constructor(code: BackendErrorCode, message: string, options: { details?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'BackendError';
    this.code = code;
    this.details = options.details ?? null;
  }
}

export type ServiceResult<T = void> = { ok: true; value: T } | { ok: false; error: BackendError };

export function ok<T = void>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: BackendError): ServiceResult<T> {
  return { ok: false, error };
}

export function isBackendError(error: unknown): error is BackendError {
  return error instanceof BackendError;
}

interface ErrorShape {
  name?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
}

function asShape(error: unknown): ErrorShape {
  if (typeof error !== 'object' || error === null) return {};
  return error as ErrorShape;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** Translate a Supabase auth/PostgREST/fetch failure into our stable codes. */
export function toBackendError(error: unknown): BackendError {
  if (isBackendError(error)) return error;

  const shape = asShape(error);
  const code = stringOrNull(shape.code);
  const message = stringOrNull(shape.message) ?? (error instanceof Error ? error.message : String(error));
  const status = typeof shape.status === 'number' ? shape.status : null;
  const details = stringOrNull(shape.details) ?? stringOrNull(shape.hint);

  // Supabase auth error codes (GoTrue).
  switch (code) {
    case 'invalid_credentials':
    case 'invalid_grant':
      return new BackendError('invalid-credentials', message, { details: details ?? undefined });
    case 'email_not_confirmed':
      return new BackendError('email-unconfirmed', message);
    case 'user_already_exists':
    case 'email_exists':
      return new BackendError('email-taken', message);
    case 'weak_password':
      return new BackendError('weak-password', message);
    case 'same_password':
      return new BackendError('same-password', message);
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
    case 'over_sms_send_rate_limit':
      return new BackendError('rate-limited', message);
    case 'otp_expired':
    case 'flow_state_expired':
    case 'flow_state_not_found':
    case 'bad_code_verifier':
      return new BackendError('link-expired', message);
    case 'provider_disabled':
      return new BackendError('provider-disabled', message);
    case 'signup_disabled':
      return new BackendError('signup-disabled', message);
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'invalid_token':
    case 'bad_jwt':
      return new BackendError('unauthorized', message);
    case 'user_not_found':
      // GoTrue returns this when the JWT is valid but its account is gone
      // (`delete_account` on another device). Treat it as an expired session.
      return new BackendError('unauthorized', message);
    case 'email_address_invalid':
      return new BackendError('invalid-data', message);
    case 'validation_failed':
      if (/provider is not enabled|unsupported provider/i.test(message)) {
        return new BackendError('provider-disabled', message);
      }
      return new BackendError('invalid-data', message);
    case 'PGRST205':
    case 'PGRST202':
    case '42P01':
      return new BackendError('not-ready', message, { details: details ?? undefined });
    case 'PGRST116':
      return new BackendError('not-ready', message, { details: details ?? undefined });
    case 'PGRST301':
    case 'PGRST302':
      return new BackendError('unauthorized', message);
    case '42501':
      return new BackendError('forbidden', message, { details: details ?? undefined });
    case '23505':
      return new BackendError('invalid-data', message, { details: details ?? undefined });
    case '23514':
      return new BackendError('invalid-data', message, { details: details ?? undefined });
    default:
      break;
  }

  if (error instanceof TypeError && /fetch|network|load failed/i.test(error.message)) {
    return new BackendError('network', message, { details: details ?? undefined });
  }
  if (status === 0) return new BackendError('network', message);
  // GoTrue says this when the JWT is valid but its account no longer exists,
  // even on older servers that omit `error_code` from the body.
  if (/user from sub claim|user not found/i.test(message)) {
    return new BackendError('unauthorized', message);
  }
  if (status === 401) return new BackendError('unauthorized', message);
  if (status === 403) return new BackendError('forbidden', message);
  if (status === 429) return new BackendError('rate-limited', message);
  if (status !== null && status >= 500) return new BackendError('server', message);
  if (/provider is not enabled|unsupported provider/i.test(message)) {
    return new BackendError('provider-disabled', message);
  }
  if (/email not confirmed/i.test(message)) {
    return new BackendError('email-unconfirmed', message);
  }
  if (/invalid login credentials/i.test(message)) {
    return new BackendError('invalid-credentials', message);
  }
  if (/user_(media|storage)_quota_exceeded|quota exceeded/i.test(message)) {
    return new BackendError(
      'quota',
      'Cloud storage is full (30 MB per account including deck text and images). Delete an old deck or remove images.',
    );
  }

  return new BackendError('unknown', message, { details: details ?? undefined, cause: error });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

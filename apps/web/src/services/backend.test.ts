import { describe, expect, it } from 'vitest';
import { parseBackendConfig } from './config';
import { BackendError, toBackendError } from './errors';

describe('backend config', () => {
  it('accepts a publishable key and normalises the URL', () => {
    const config = parseBackendConfig('https://example.supabase.co/', 'sb_publishable_x', '10');
    expect(config.configured).toBe(true);
    expect(config.url).toBe('https://example.supabase.co');
    expect(config.syncMinutes).toBe(10);
    expect(config.reason).toBeNull();
  });

  it('is disabled when either variable is missing', () => {
    expect(parseBackendConfig('', 'key').status).toBe('missing');
    expect(parseBackendConfig('https://example.supabase.co', '').status).toBe('missing');
  });

  it('refuses to bundle a secret key', () => {
    const config = parseBackendConfig(
      'https://example.supabase.co',
      'sb_secret_do-not-ship',
    );
    expect(config.configured).toBe(false);
    expect(config.status).toBe('secret-key');
    expect(config.key).toBe('');
  });

  it('rejects a malformed URL', () => {
    expect(parseBackendConfig('not a url', 'sb_publishable_x').status).toBe('invalid-url');
  });

  it('clamps the sync interval', () => {
    expect(parseBackendConfig('https://example.supabase.co', 'k', '0').syncMinutes).toBe(15);
    expect(parseBackendConfig('https://example.supabase.co', 'k', '99999').syncMinutes).toBe(1440);
  });
});

describe('backend errors', () => {
  it('maps Supabase auth codes', () => {
    expect(toBackendError({ code: 'invalid_credentials', message: 'nope' }).code).toBe(
      'invalid-credentials',
    );
    expect(toBackendError({ code: 'email_not_confirmed', message: 'nope' }).code).toBe(
      'email-unconfirmed',
    );
    expect(toBackendError({ code: 'over_email_send_rate_limit', message: 'nope' }).code).toBe(
      'rate-limited',
    );
  });

  it('maps a disabled OAuth provider to provider-disabled', () => {
    const error = toBackendError({
      code: 'validation_failed',
      message: 'Unsupported provider: provider is not enabled',
    });
    expect(error.code).toBe('provider-disabled');
  });

  it('maps a missing table to not-ready', () => {
    const error = toBackendError({
      code: 'PGRST205',
      message: "Could not find the table 'public.official_packs'",
    });
    expect(error.code).toBe('not-ready');
  });

  it('maps HTTP statuses when no code is present', () => {
    expect(toBackendError({ status: 403, message: 'denied' }).code).toBe('forbidden');
    expect(toBackendError({ status: 500, message: 'boom' }).code).toBe('server');
    expect(toBackendError({ status: 0, message: 'offline' }).code).toBe('network');
  });

  it('preserves an existing BackendError', () => {
    const original = new BackendError('unknown', 'x');
    expect(toBackendError(original)).toBe(original);
  });
});

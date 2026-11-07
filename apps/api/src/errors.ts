import type { AiErrorCode } from '@mengyin/ai-contract';

/** An error that should be returned to the client with a specific status. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: AiErrorCode;

  constructor(status: number, code: AiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): ApiError {
  return new ApiError(400, 'invalid_request', message);
}

export function unauthorized(message = 'Sign in to use AI question generation.'): ApiError {
  return new ApiError(401, 'unauthorized', message);
}

export function notFound(message = 'Not found'): ApiError {
  return new ApiError(404, 'not_found', message);
}

export function payloadTooLarge(message: string): ApiError {
  return new ApiError(413, 'payload_too_large', message);
}

export function rateLimited(message: string): ApiError {
  return new ApiError(429, 'rate_limited', message);
}

export function quotaExceeded(message: string): ApiError {
  return new ApiError(429, 'quota_exceeded', message);
}

/** The account is known but its plan or balance does not allow this action. */
export function paymentRequired(message: string): ApiError {
  return new ApiError(402, 'quota_exceeded', message);
}

export function forbidden(message: string): ApiError {
  return new ApiError(403, 'forbidden', message);
}

export function unconfigured(message: string): ApiError {
  return new ApiError(503, 'ai_unconfigured', message);
}

export function imagesUnavailable(message: string): ApiError {
  return new ApiError(503, 'images_unavailable', message);
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

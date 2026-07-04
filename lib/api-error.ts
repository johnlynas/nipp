import { NextResponse } from 'next/server';

/**
 * Standardized API error responses for Route Handlers.
 */

export type ErrorSeverity = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'internal';

export interface ApiErrorOptions {
  message: string;
  severity?: ErrorSeverity;
  details?: Record<string, unknown>;
}

/**
 * Create a standardized JSON error response.
 */
export function apiError(options: ApiErrorOptions): NextResponse {
  const { message, severity = 'internal', details } = options;

  const statusMap: Record<ErrorSeverity, number> = {
    bad_request: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    internal: 500,
  };

  const body: Record<string, unknown> = {
    error: true,
    message,
    severity,
  };

  if (details) {
    body.details = details;
  }

  return NextResponse.json(body, { status: statusMap[severity] });
}

/**
 * Convenience functions for common error types.
 */
export function badRequest(message: string, details?: Record<string, unknown>) {
  return apiError({ message, severity: 'bad_request', details });
}

export function unauthorized(message = 'Unauthorized') {
  return apiError({ message, severity: 'unauthorized' });
}

export function forbidden(message = 'Forbidden') {
  return apiError({ message, severity: 'forbidden' });
}

export function notFound(message = 'Resource not found') {
  return apiError({ message, severity: 'not_found' });
}

export function conflict(message: string) {
  return apiError({ message, severity: 'conflict' });
}

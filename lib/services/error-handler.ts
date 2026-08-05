/**
 * Shared error→HTTP-response mapper for API routes.
 *
 * Maps service-layer typed errors to standardized HTTP responses so that
 * every refactored API route doesn't reimplement the same logic.
 */

import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from './types';

/**
 * Maps a service-layer error to an appropriate HTTP response.
 * Falls back to 500 for unexpected errors.
 */
export function handleServiceError(error: unknown): ReturnType<typeof NextResponse.json> {
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  // Fallback for unexpected errors
  logger.error({ err: error }, 'Unhandled service error');
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 },
  );
}

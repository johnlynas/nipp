/**
 * Unit tests for the shared error→HTTP-response mapper.
 */

import { describe, it, expect, vi } from 'vitest';
import { handleServiceError } from '@/lib/services/error-handler';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@/lib/services/types';

// Mock logger to suppress output
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn() },
}));

describe('handleServiceError', () => {
  it('returns 400 for ValidationError', () => {
    const response = handleServiceError(new ValidationError('Invalid input'));
    expect(response.status).toBe(400);
  });

  it('returns 401 for UnauthorizedError', () => {
    const response = handleServiceError(new UnauthorizedError('Not authenticated'));
    expect(response.status).toBe(401);
  });

  it('returns 403 for ForbiddenError', () => {
    const response = handleServiceError(new ForbiddenError('Access denied'));
    expect(response.status).toBe(403);
  });

  it('returns 404 for NotFoundError', () => {
    const response = handleServiceError(new NotFoundError('Not found'));
    expect(response.status).toBe(404);
  });

  it('returns 409 for ConflictError', () => {
    const response = handleServiceError(new ConflictError('Conflict'));
    expect(response.status).toBe(409);
  });

  it('returns 500 for unexpected errors', () => {
    const response = handleServiceError(new Error('Something went wrong'));
    expect(response.status).toBe(500);
  });

  it('returns 500 for null', () => {
    const response = handleServiceError(null as unknown as Error);
    expect(response.status).toBe(500);
  });

  it('returns 500 for undefined', () => {
    const response = handleServiceError(undefined as unknown as Error);
    expect(response.status).toBe(500);
  });

  it('returns correct JSON body with error message for ValidationError', async () => {
    const response = handleServiceError(new ValidationError('Field is required'));
    const body = await response.json();
    expect(body).toEqual({ error: 'Field is required' });
  });

  it('returns correct JSON body with error message for ForbiddenError', async () => {
    const response = handleServiceError(new ForbiddenError('Access denied'));
    const body = await response.json();
    expect(body).toEqual({ error: 'Access denied' });
  });

  it('returns fallback message for unexpected errors', async () => {
    const response = handleServiceError(new Error('Unknown error'));
    const body = await response.json();
    expect(body).toEqual({ error: 'Internal server error' });
  });
});

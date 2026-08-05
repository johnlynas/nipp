/**
 * Unit tests for service-layer error classes.
 */

import { describe, it, expect } from 'vitest';
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
} from '@/lib/services/types';

describe('Service Error Classes', () => {
  describe('ValidationError', () => {
    it('has correct code, status, and name properties', () => {
      const err = new ValidationError('Invalid input');
      expect(err.code).toBe('VALIDATION_ERROR');
      expect(err.status).toBe(400);
      expect(err.name).toBe('ValidationError');
    });

    it('preserves the error message', () => {
      const err = new ValidationError('Field is required');
      expect(err.message).toBe('Field is required');
    });

    it('is an instance of Error', () => {
      const err = new ValidationError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('UnauthorizedError', () => {
    it('has correct code, status, and name properties', () => {
      const err = new UnauthorizedError('Not authenticated');
      expect(err.code).toBe('UNAUTHORIZED');
      expect(err.status).toBe(401);
      expect(err.name).toBe('UnauthorizedError');
    });

    it('preserves the error message', () => {
      const err = new UnauthorizedError('Missing session');
      expect(err.message).toBe('Missing session');
    });

    it('is an instance of Error', () => {
      const err = new UnauthorizedError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ForbiddenError', () => {
    it('has correct code, status, and name properties', () => {
      const err = new ForbiddenError('Access denied');
      expect(err.code).toBe('FORBIDDEN');
      expect(err.status).toBe(403);
      expect(err.name).toBe('ForbiddenError');
    });

    it('preserves the error message', () => {
      const err = new ForbiddenError('Not enough permissions');
      expect(err.message).toBe('Not enough permissions');
    });

    it('is an instance of Error', () => {
      const err = new ForbiddenError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('NotFoundError', () => {
    it('has correct code, status, and name properties', () => {
      const err = new NotFoundError('Not found');
      expect(err.code).toBe('NOT_FOUND');
      expect(err.status).toBe(404);
      expect(err.name).toBe('NotFoundError');
    });

    it('preserves the error message', () => {
      const err = new NotFoundError('User not found');
      expect(err.message).toBe('User not found');
    });

    it('is an instance of Error', () => {
      const err = new NotFoundError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('ConflictError', () => {
    it('has correct code, status, and name properties', () => {
      const err = new ConflictError('Conflict');
      expect(err.code).toBe('CONFLICT');
      expect(err.status).toBe(409);
      expect(err.name).toBe('ConflictError');
    });

    it('preserves the error message', () => {
      const err = new ConflictError('Duplicate entry');
      expect(err.message).toBe('Duplicate entry');
    });

    it('is an instance of Error', () => {
      const err = new ConflictError('test');
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe('instanceof checks', () => {
    it('ValidationError is not an instance of other error types', () => {
      const err = new ValidationError('test');
      expect(err).not.toBeInstanceOf(UnauthorizedError);
      expect(err).not.toBeInstanceOf(ForbiddenError);
      expect(err).not.toBeInstanceOf(NotFoundError);
      expect(err).not.toBeInstanceOf(ConflictError);
    });

    it('ForbiddenError is not an instance of other error types', () => {
      const err = new ForbiddenError('test');
      expect(err).not.toBeInstanceOf(ValidationError);
      expect(err).not.toBeInstanceOf(UnauthorizedError);
      expect(err).not.toBeInstanceOf(NotFoundError);
      expect(err).not.toBeInstanceOf(ConflictError);
    });

    it('ConflictError is not an instance of other error types', () => {
      const err = new ConflictError('test');
      expect(err).not.toBeInstanceOf(ValidationError);
      expect(err).not.toBeInstanceOf(UnauthorizedError);
      expect(err).not.toBeInstanceOf(ForbiddenError);
      expect(err).not.toBeInstanceOf(NotFoundError);
    });
  });
});

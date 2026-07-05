/**
 * Unit tests for login form validation (Zod schema).
 */

import { describe, it, expect } from 'vitest';
import { loginSchema } from '@/lib/schemas/auth.schema';

describe('loginSchema', () => {
  it('should accept a valid email and password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'securepass123',
    });
    expect(result.success).toBe(true);
  });

  it('should reject an invalid email', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'securepass123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a missing password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject a missing email', () => {
    const result = loginSchema.safeParse({
      email: '',
      password: 'securepass123',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty input object', () => {
    const result = loginSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject null/undefined values', () => {
    const result1 = loginSchema.safeParse({ email: null, password: 'pass' });
    const result2 = loginSchema.safeParse({ email: 'user@example.com', password: null });
    expect(result1.success).toBe(false);
    expect(result2.success).toBe(false);
  });
});

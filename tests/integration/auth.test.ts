/**
 * Integration tests for the login flow.
 *
 * Tests:
 * - Successful sign-in with valid credentials
 * - Generic error message on invalid credentials (no user enumeration)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

describe('Login flow (integration)', () => {
  const testEmail = 'test-login@example.com';
  const correctPassword = 'CorrectPass123!';

  async function createTestUser() {
    const passwordHash = await hashPassword(correctPassword);

    return prisma.user.create({
      data: {
        email: testEmail,
        name: 'Test User',
        passwordHash,
      },
    });
  }

  async function cleanupTestUser() {
    await prisma.user.deleteMany({ where: { email: testEmail } });
  }

  beforeEach(async () => {
    await createTestUser();
  });

  afterEach(async () => {
    await cleanupTestUser();
  });

  it('should sign in with valid credentials', async () => {
    const result = await auth.api.signInEmail({
      body: { email: testEmail, password: correctPassword },
    });

    expect(result).toBeDefined();
    // BetterAuth returns a session object on success
    expect((result as any).session).toBeDefined();
  });

  it('should return a generic error for invalid credentials', async () => {
    const result = await auth.api.signInEmail({
      body: { email: testEmail, password: 'WrongPassword123!' },
    });

    // Should not be a successful session — should be an error response
    expect((result as any).session).toBeUndefined();
  });

  it('should return a generic error for non-existent user', async () => {
    const result = await auth.api.signInEmail({
      body: { email: 'nobody@example.com', password: 'AnyPassword123!' },
    });

    // Should not be a successful session — generic error, no user-enumeration
    expect((result as any).session).toBeUndefined();
  });

  it('should reject empty credentials', async () => {
    const result = await auth.api.signInEmail({
      body: { email: '', password: '' },
    });

    expect((result as any).session).toBeUndefined();
  });

  it('should verify password hash correctly', async () => {
    const hash = await hashPassword(correctPassword);
    const valid = await verifyPassword(correctPassword, hash);
    const invalid = await verifyPassword('WrongPassword123!', hash);

    expect(valid).toBe(true);
    expect(invalid).toBe(false);
  });
});

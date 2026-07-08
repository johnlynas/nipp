import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { hashPassword } from 'better-auth/crypto';
import { auth } from '@/lib/auth';

describe('Login flow (integration)', () => {
  const testEmail = 'test@example.com';
  const testPassword = 'TestPassword123!';
  let testUserId: string;

  beforeAll(async () => {
    const passwordHash = await hashPassword(testPassword);
    
    const user = await prisma.user.upsert({
      where: { email: testEmail },
      update: {},
      create: {
        email: testEmail,
        name: 'Test User',
      },
    });
    testUserId = user.id;

    await prisma.account.upsert({
      where: {
        providerId_providerAccountId: {
          providerId: 'credential',
          providerAccountId: user.id,
        },
      },
      update: {},
      create: {
        userId: user.id,
        accountId: user.id,
        providerId: 'credential',
        providerAccountId: user.id,
        password: passwordHash,
      },
    });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.account.deleteMany({
        where: { userId: testUserId },
      });
      await prisma.user.delete({
        where: { id: testUserId },
      });
    }
  });

  // Helper to create a proper request with Origin header
  const createAuthRequest = (body: any) => {
    return new Request('http://localhost:3000/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Origin': 'http://localhost:3000',
      },
      body: JSON.stringify(body),
    });
  };

  it('should sign in with valid credentials', async () => {
    const request = createAuthRequest({
      email: testEmail,
      password: testPassword,
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toBeDefined();
  });

  it('should return a generic error for invalid credentials', async () => {
    const request = createAuthRequest({
      email: testEmail,
      password: 'WrongPassword123!',
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.message).toMatch(/invalid/i);
  });

  it('should return a generic error for non-existent user', async () => {
    const request = createAuthRequest({
      email: 'nonexistent@example.com',
      password: testPassword,
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.message).toMatch(/invalid/i);
  });

  it('should reject empty credentials', async () => {
    const request = createAuthRequest({
      email: '',
      password: '',
    });

    const response = await auth.handler(request);
    
    // BetterAuth may return 400 or 401 for empty credentials
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('should verify password hash correctly', async () => {
    const { verifyPassword } = await import('better-auth/crypto');
    const hash = await hashPassword(testPassword);
    const isValid = await verifyPassword({ hash, password: testPassword });
    expect(isValid).toBe(true);
  });
});
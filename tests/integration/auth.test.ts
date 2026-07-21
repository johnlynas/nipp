import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { auth } from '@/lib/auth';
import { createAuthenticatedUser, cleanupUser } from '../utils/factories';
import { testClient } from '../utils/test-client';

describe('Login flow (integration)', () => {
  const testEmail = 'test@example.com';
  const testPassword = 'TestPassword123!';
  let testUser: { id: string; email: string };

  beforeAll(async () => {
    testUser = await createAuthenticatedUser({ 
      email: testEmail,
      name: 'Test User'
    });
  });

  afterAll(async () => {
    await cleanupUser(testUser.id);
  });

  it('should sign in with valid credentials', async () => {
    const request = await testClient.post('/api/auth/sign-in/email', {
      email: testEmail,
      password: testPassword,
    }, {
      'Origin': 'http://localhost:3000',
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toBeDefined();
  });

  it('should return a generic error for invalid credentials', async () => {
    const request = await testClient.post('/api/auth/sign-in/email', {
      email: testEmail,
      password: 'WrongPassword123!',
    }, {
      'Origin': 'http://localhost:3000',
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.message).toMatch(/invalid/i);
  });

  it('should return a generic error for non-existent user', async () => {
    const request = await testClient.post('/api/auth/sign-in/email', {
      email: 'nonexistent@example.com',
      password: testPassword,
    }, {
      'Origin': 'http://localhost:3000',
    });

    const response = await auth.handler(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.message).toMatch(/invalid/i);
  });

  it('should reject empty credentials', async () => {
    const request = await testClient.post('/api/auth/sign-in/email', {
      email: '',
      password: '',
    }, {
      'Origin': 'http://localhost:3000',
    });

    const response = await auth.handler(request);
    
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('should verify password hash correctly', async () => {
    const { verifyPassword, hashPassword } = await import('better-auth/crypto');
    const hash = await hashPassword(testPassword);
    const isValid = await verifyPassword({ hash, password: testPassword });
    expect(isValid).toBe(true);
  });
});

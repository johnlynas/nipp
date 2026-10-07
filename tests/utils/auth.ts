import { auth } from '@/lib/auth';
import { createAuthClient } from 'better-auth/react';

// Create a test client that can be used in integration tests
export const testClient = createAuthClient({
  baseURL: 'http://localhost:3000',
});

// Alternative: If you need to test against the auth instance directly
export const testAuth = auth;

// Helper to create a test user
export async function createTestUser(email: string, password: string) {
  const { hashPassword } = await import('better-auth/crypto');
  const { prisma } = await import('@/lib/db');
  
  const passwordHash = await hashPassword(password);
  
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Test User',
    },
  });

  await prisma.account.upsert({
    where: {
      providerId_accountId: {
        providerId: 'credential',
        accountId: user.id, // BetterAuth identity: accountId = provider sub (user's own id for credentials)
      },
    },
    update: {},
    create: {
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: passwordHash,
    },
  });

  return user;
}

// Helper to clean up test users
export async function cleanupTestUser(userId: string) {
  const { prisma } = await import('@/lib/db');
  
  await prisma.account.deleteMany({
    where: { userId },
  });
  
  await prisma.user.delete({
    where: { id: userId },
  });
}
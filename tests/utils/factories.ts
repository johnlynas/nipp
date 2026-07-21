import { prisma } from '@/lib/db';
import { hashPassword } from 'better-auth/crypto';

export interface UserFactoryOptions {
  email?: string;
  name?: string;
}

export interface AccountFactoryOptions {
  userId: string;
  providerId?: string;
  providerAccountId?: string;
  password?: string;
}

/**
 * Factory for creating Users in the test database.
 */
export async function createUser(options: UserFactoryOptions = {}) {
  const email = options.email ?? `test-${Math.random().toString(36).substring(7)}@example.com`;
  const name = options.name ?? 'Test User';

  return await prisma.user.create({
    data: {
      email,
      name,
    },
  });
}

/**
 * Factory for creating Credential Accounts for a user.
 * Specifically designed for testing authentication flows.
 */
export async function createCredentialAccount(options: AccountFactoryOptions) {
  const password = options.password ?? 'TestPassword123!';
  const passwordHash = await hashPassword(password);

  return await prisma.account.create({
    data: {
      userId: options.userId,
      accountId: options.userId, // Using userId as accountId for simplicity in credential flows
      providerId: options.providerId ?? 'credential',
      providerAccountId: options.providerAccountId ?? options.userId,
      password: passwordHash,
    },
  });
}

/**
 * Helper to clean up a user and all their associated accounts.
 */
export async function cleanupUser(userId: string) {
  await prisma.account.deleteMany({
    where: { userId },
  });
  await prisma.user.delete({
    where: { id: userId },
  });
}

/**
 * High-level helper to create a fully authenticated user.
 */
export async function createAuthenticatedUser(options: UserFactoryOptions = {}) {
  const user = await createUser(options);
  await createCredentialAccount({ userId: user.id });
  return user;
}

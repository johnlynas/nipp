/**
 * User creation and management test helpers.
 */

import { prisma } from '@/lib/db';

/**
 * Create a test user with a specific role.
 */
export async function createTestUser(
  email: string,
  name?: string,
  passwordHash?: string | null
) {
  return prisma.user.create({
    data: {
      name: name || email.split('@')[0],
      email,
      passwordHash,
    },
  });
}

/**
 * Create multiple test users with different roles.
 */
export async function createTestUsers(count = 5) {
  const users = [];
  for (let i = 0; i < count; i++) {
    const user = await createTestUser(`test-user-${i}@example.com`);
    users.push(user);
  }
  return users;
}

/**
 * Organization test helpers.
 */

import { prisma } from '@/lib/db';

/**
 * Create a test organization.
 */
export async function createTestOrganization(name: string, slug?: string) {
  return prisma.organization.create({
    data: {
      name,
      slug: slug || `test-org-${Date.now()}`,
    },
  });
}

/**
 * Add a user to an organization with a specific role.
 */
export async function addMemberToOrganization(
  userId: string,
  orgId: string,
  role = 'member'
) {
  return prisma.member.create({
    data: {
      userId,
      orgId,
      role,
    },
  });
}

/**
 * Create a test invitation.
 */
export async function createTestInvitation(email: string, orgId: string) {
  return prisma.invitation.create({
    data: {
      email,
      orgId,
      token: `test-token-${Date.now()}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });
}

import prisma from '@/lib/db';
import { env } from '@/lib/env';

/**
 * Check if a user has a specific permission in an organization.
 */
export async function hasPermission(
  userId: string,
  orgId: string,
  permission: string
): Promise<boolean> {
  try {
    const { resolvePermissions } = await import('./permissions/resolver');
    const permissions = await resolvePermissions(userId, orgId);
    return permissions.includes(permission);
  } catch {
    return false;
  }
}

/**
 * Check if a user is a Super Admin (member of Platform Organization).
 */
export async function isSuperAdmin(
  userId: string,
  orgId: string | undefined
): Promise<boolean> {
  if (!orgId) return false;
  
  try {
    const platformOrgId = await getPlatformOrgId();
    if (!platformOrgId) return false;
    
    if (orgId === platformOrgId) {
      const member = await prisma.member.findFirst({
        where: {
          userId,
          organization: { id: platformOrgId },
        },
      });
      return !!member;
    }
    
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the Platform Organization ID from environment or database.
 */
export async function getPlatformOrgId(): Promise<string | null> {
  if (env.PLATFORM_ORGANIZATION_ID) {
    return env.PLATFORM_ORGANIZATION_ID;
  }
  
  try {
    const org = await prisma.organization.findFirst({
      where: { name: 'Platform' },
      select: { id: true },
    });
    return org?.id || null;
  } catch {
    return null;
  }
}


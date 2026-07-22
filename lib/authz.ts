import tenantDb from '@/lib/tenant-db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { runWithTenant } from './tenant-context';

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
 * Verify if a user is a Super Admin (member of Platform Organization).
 * Returns a consistent response object with authorization status and optional error.
 */
export async function verifySuperAdmin(
  userId: string,
  orgId?: string // Made optional to support global admin checks
): Promise<{ authorized: boolean; error?: string }> {
  try {
    const platformOrgId = await getPlatformOrgId();
    if (!platformOrgId) {
      logger.error({ userId }, 'Platform organization not found in database');
      return { authorized: false, error: 'Platform organization not found' };
    }

    // If an orgId is provided, ensure it matches the platform org
    if (orgId && orgId !== platformOrgId) {
      return { authorized: false, error: 'Not the platform organization' };
    }

    // Use tenantDb with explicit context for the platform org to satisfy tenant isolation rules
    const member = await runWithTenant(platformOrgId, async () => {
      return tenantDb.member.findFirst({
        where: {
          userId,
          organization: { id: platformOrgId },
        },
      });
    });

    if (!member) {
      logger.warn({ userId, orgId }, 'User is not a member of the platform organization');
      return { authorized: false, error: 'User is not a member of the platform organization' };
    }

    return { authorized: true };
  } catch (error) {
    // Explicitly detect Prisma database connection errors (P1001)
    const isDbError = error instanceof Error && (error.message.includes('Can\'t reach database server') || error.message.includes('P1001'));
    const logMessage = isDbError 
      ? 'Database unavailable during super admin verification' 
      : 'Error verifying super admin status';
    
    logger.error({ userId, orgId, err: error }, logMessage);
    
    return { 
      authorized: false, 
      error: isDbError ? 'Database unavailable, authorization cannot be verified' : 'Internal server error during authorization' 
    };
  }
}

/**
 * Check if a user is a Super Admin (member of Platform Organization).
 * Returns a boolean.
 */
export async function isSuperAdmin(userId: string, orgId?: string): Promise<boolean> {
  const { authorized } = await verifySuperAdmin(userId, orgId);
  return authorized;
}

/**
 * Get the Platform Organization ID from environment or database.
 */
export async function getPlatformOrgId(): Promise<string | null> {
  if (env.PLATFORM_ORGANIZATION_ID) {
    return env.PLATFORM_ORGANIZATION_ID;
  }
  try {
    // Organization is not tenant-scoped, so we can query it directly with tenantDb
    const org = await tenantDb.organization.findFirst({
      where: { name: 'Platform' },
      select: { id: true },
    });
    return org?.id || null;
  } catch (error) {
    const isDbError = error instanceof Error && (error.message.includes('Can\'t reach database server') || error.message.includes('P1001'));
    logger.error({ err: error }, isDbError ? 'Database unavailable fetching platform organization ID' : 'Error fetching platform organization ID');
    return null;
  }
}

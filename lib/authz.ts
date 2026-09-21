import tenantDb from '@/lib/tenant-db';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { withPlatformContext } from './platform-db';

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

    // Access-resolution read: must run with a bound RLS context on one pinned
    // connection. The app connects as nipp_app (non-owner), so an unscoped or
    // GUC-less Member query is invisible to Postgres (fail-closed) — only the
    // verified platform flag exposes the platform-org membership row.
    const member = await withPlatformContext(userId, async () => {
      return tenantDb.member.findFirst({
        where: {
          userId,
          orgId: platformOrgId,
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
 * Get the Platform Organization ID from environment (primary) or database.
 * NOTE: the DB fallback runs unscoped by design — under the non-owner nipp_app
 * connection an RLS-scoped Organization query with no context is invisible
 * (fail-closed), so this returns null → callers map it to a 503, not a silent
 * auth decision. PLATFORM_ORGANIZATION_ID in env is therefore REQUIRED.
 */
export async function getPlatformOrgId(): Promise<string | null> {
  if (env.PLATFORM_ORGANIZATION_ID) {
    return env.PLATFORM_ORGANIZATION_ID;
  }
  try {
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

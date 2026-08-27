/**
 * Shared authorization helper for org-scoped API routes.
 *
 * Resolves the effective ServiceContext for a request against an organization:
 *   - Org members get their membership role (TENANT_ADMIN / MEMBER).
 *   - Super Admins (Platform Organization members) may operate on ANY tenant
 *     organization and act as PLATFORM_ADMIN within it, even when they do not
 *     hold a membership in that org — e.g. editing another tenant's calendar.
 *
 * Returns `null` when the caller has no access at all:
 *   - unauthenticated (401) or database errors, which fail CLOSED (503)
 *   - plain members of a different organization (403)
 */

import type { NextRequest } from 'next/server';
import globalDb from '@/lib/global-db';
import { superAdminStorage } from '@/lib/global-db-guard';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';
import type { ServiceContext } from '@/lib/services/types';

export type TenantAccess =
  | { ok: true; ctx: ServiceContext }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * Resolve membership OR super-admin access for an org-scoped request.
 */
export async function resolveTenantAccess(
  req: NextRequest,
  userId: string,
  orgId: string
): Promise<TenantAccess> {
  // Membership lookup needs the unscoped client — this is a short-lived read
  // inside the same request as the guarded operation; wrapped so the Async
  // LocalStorage context (S7) does not leak to subsequent operations.
  const membership = await superAdminStorage.run(true, async () => {
    return globalDb.member.findFirst({
      where: { userId, orgId },
      select: { role: true },
    });
  });

  if (membership) {
    const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
    return { ok: true, ctx: { userId, role, organizationId: orgId } };
  }

  // Not a member — check for super admin (Platform Organization member).
  const { authorized, error } = await verifySuperAdmin(userId);
  if (!authorized) {
    const status: 403 | 503 =
      error && (error.includes('Database unavailable') || error.includes('Platform organization not found'))
        ? 503
        : 403;

    logger.warn(
      { userId, orgId, error, status },
      'Tenant access denied: no membership and super admin verification failed'
    );
    return { ok: false, status, error: error || 'Forbidden' };
  }

  logger.info({ userId, orgId }, 'Super Admin accessing tenant organization');
  return { ok: true, ctx: { userId, role: 'PLATFORM_ADMIN', organizationId: orgId } };
}

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
import tenantDb from '@/lib/tenant-db';
import { buildPlatformContext } from '@/lib/platform-db';
import { withExplicitRLS } from '@/lib/rls-transaction';
import { verifySuperAdmin } from '@/lib/authz';
import { logger } from '@/lib/logger';
import type { ServiceContext } from '@/lib/services/types';
import type { TenantContextObject } from '@/lib/tenant-context';

export type TenantAccess =
  | { ok: true; ctx: ServiceContext }
  | { ok: false; status: 401 | 403 | 503; error: string };

/**
 * Read a membership row with the RLS flag bound (platform-admin visible).
 * This is the ACCESS RESOLUTION read itself — server-side, before any context
 * exists; binding it under the verified platform context keeps the unscoped
 * bypass client (deleted in Phase 3) out of the critical path entirely.
 */
async function readMembershipForAccessCheck(userId: string, orgId: string) {
  const ctx = { ...buildPlatformContext(userId), orgId };
  return withExplicitRLS(ctx, () =>
    tenantDb.member.findFirst({ where: { userId, orgId }, select: { role: true } })
  );
}

/**
 * Resolve membership OR super-admin access for an org-scoped request.
 */
export async function resolveTenantAccess(
  req: NextRequest,
  userId: string,
  orgId: string
): Promise<TenantAccess> {
  const membership = await readMembershipForAccessCheck(userId, orgId);

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

/**
 * Build the verified RLS context object (RLS plan Phase 1D) from a resolved
 * TenantAccess + session user id. No extra lookups: isPlatformAdmin mirrors
 * the authoritative decision already made by resolveTenantAccess.
 */
export function toTenantContext(
  access: Extract<TenantAccess, { ok: true }>,
  sessionUserId: string
): TenantContextObject {
  if (!sessionUserId) throw new Error('toTenantContext: sessionUserId required (fail-closed)');
  const orgId = access.ctx.organizationId;
  if (!orgId) throw new Error('toTenantContext: organizationId missing (fail-closed)');
  return {
    userId: sessionUserId,
    orgId,
    isPlatformAdmin: access.ctx.role === 'PLATFORM_ADMIN',
  };
}

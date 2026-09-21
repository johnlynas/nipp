/**
 * PATCH /api/admin/organizations/:id/status
 *
 * Super Admin only — change organization status with state machine validation.
 * Wrapped with wrapPiiRoute for payload encryption.
 *
 * State machine: PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED (terminal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
// RLS Phase 3: org status transitions (incl. member ban/unban + session
// invalidation) run under one verified target-org context.
import tenantDb from '@/lib/tenant-db';
import { withTenantAdminContext } from '@/lib/platform-db';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { logger } from '@/lib/logger';
import { wrapPiiRoute, PiiRouteParams } from '@/lib/payload-middleware';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { notifyOrganizationSuspension, notifyOrganizationArchival, notifyOrganizationReactivation } from '@/lib/notification-push';

export const runtime = 'nodejs';
export const revalidate = 0;
export const dynamic = 'force-dynamic';

/**
 * Valid state transitions.
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [], // Terminal — no transitions allowed
};

/**
 * PATCH — Change organization status (wrapped with payload encryption).
 */
export const PATCH = wrapPiiRoute(async (request, decryptedBody, params) => {
  // Auth check — wrapPiiRoute handles encryption, not authorization
  const authResult = await requireSuperAdmin(request.headers);
  if (!authResult.authorized) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: authResult.status });
  }

  const session = authResult.session!;

  // Rate limit admin write operations by session
  if (!checkAdminRateLimit(session.user.id)) {
    logger.warn({ userId: session.user.id }, 'Admin write rate limited');
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    logger.info('[ORG_STATUS_API] PATCH request received');

    // Get body from decrypted payload or parse JSON
    let body: { status?: string };
    if (decryptedBody && typeof decryptedBody === 'object') {
      body = decryptedBody as { status?: string };
    } else {
      const contentType = request.headers.get('Content-Type') || '';
      if (contentType.includes('application/octet-stream')) {
        return NextResponse.json(
          { error: 'Payload encryption is enabled on the client but disabled on the server. Set PAYLOAD_ENCRYPTION_MODE=permissive or enforce.' },
          { status: 400 },
        );
      }
      try {
        body = await request.json();
      } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
      }
    }

    const { status: newStatus } = body;

    if (!newStatus || !VALID_TRANSITIONS[newStatus]) {
      return NextResponse.json(
        { error: 'Invalid status value' },
        { status: 400 }
      );
    }

    // Extract orgId from route params (provided by wrapPiiRoute)
    const orgId = params?.orgId;

    if (!orgId) {
      return NextResponse.json({ error: 'Organization ID required' }, { status: 400 });
    }

    try {
      // RLS: one verified target-org context wraps org read/update + member ban/unban
      return await withTenantAdminContext(session.user.id, orgId, async () => {
        const org = await tenantDb.organization.findUnique({
          where: { id: orgId },
          select: { status: true, name: true },
        });

        if (!org) {
          logger.warn({ orgId }, '[ORG_STATUS_API] Organization not found');
          return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
        }

        // Validate transition
        const allowed = VALID_TRANSITIONS[org.status];
        if (!allowed.includes(newStatus)) {
          return NextResponse.json(
            {
              error: `Invalid transition from ${org.status} to ${newStatus}`,
              current: org.status,
              allowedTransitions: allowed,
            },
            { status: 400 }
          );
        }

        const updated = await tenantDb.organization.update({
          where: { id: orgId },
          data: { status: newStatus as 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED' },
          select: { id: true, name: true, status: true },
        });

        // Ban all users in the org when suspending or archiving
        let userCount = 0;
        if (newStatus === 'SUSPENDED' || newStatus === 'ARCHIVED') {
          const actionLabel = newStatus === 'SUSPENDED' ? 'suspend' : 'archive';
          logger.warn({
            userId: session.user.id,
            userName: (session.user as { name?: string }).name ?? undefined,
            orgId,
            orgName: org.name,
            fromStatus: org.status,
            toStatus: newStatus,
          }, `[ORG_STATUS_API] ${actionLabel} organization — banning all member users`);

          userCount = await banOrgUsers(orgId, org.name, session.user.id, newStatus);
        } else if (org.status === 'SUSPENDED' && newStatus === 'ACTIVE') {
          logger.info({
            userId: session.user.id,
            userName: (session.user as { name?: string }).name ?? undefined,
            orgId,
            orgName: org.name,
            fromStatus: org.status,
            toStatus: newStatus,
          }, `[ORG_STATUS_API] Reactivating organization — unbanning all member users`);

          userCount = await unbanOrgUsers(orgId, session.user.id);
        }

        // Push SSE notifications for org lifecycle events (after ban/unban)
        if (newStatus === 'SUSPENDED' && userCount > 0) {
          await notifyOrganizationSuspension(
            orgId,
            org.name,
            userCount,
            (session.user as { name?: string }).name ?? undefined,
          );
          logger.info({ userId: session.user.id, orgId, userCount }, '[ORG_STATUS_API] SSE notification dispatched — organization suspended');
        } else if (newStatus === 'ARCHIVED' && userCount > 0) {
          await notifyOrganizationArchival(
            orgId,
            org.name,
            userCount,
            (session.user as { name?: string }).name ?? undefined,
          );
          logger.info({ userId: session.user.id, orgId, userCount }, '[ORG_STATUS_API] SSE notification dispatched — organization archived');
        } else if (org.status === 'SUSPENDED' && newStatus === 'ACTIVE' && userCount > 0) {
          await notifyOrganizationReactivation(
            orgId,
            org.name,
            userCount,
            (session.user as { name?: string }).name ?? undefined,
          );
          logger.info({ userId: session.user.id, orgId, userCount }, '[ORG_STATUS_API] SSE notification dispatched — organization reactivated');
        } else if (userCount === 0) {
          logger.info({ userId: session.user.id, orgId, newStatus }, '[ORG_STATUS_API] No members to ban/unban — skipping SSE notification');
        }

        // Invalidate sessions if suspending or archiving
        if (newStatus === 'SUSPENDED' || newStatus === 'ARCHIVED') {
          await invalidateOrgSessions(orgId);
        }

        // P7: Invalidate cached org details on status change
        revalidateTag('org');

        logger.info({ userId: session.user.id, orgId, newStatus }, '[ORG_STATUS_API] Organization status updated');

        // Record audit log for status change
        await recordAuditLog({
          userId: session.user.id,
          userName: (session.user as { name?: string }).name ?? undefined,
          action: 'organization.status_changed',
          resourceType: 'Organization',
          resourceId: orgId,
          organizationId: orgId,
          metadata: { fromStatus: org.status, toStatus: newStatus },
          success: true,
        }).catch((err) => logger.error({ err }, 'Failed to record audit log for status change'));

        return NextResponse.json({ organization: updated });
      });
    } catch (error) {
      logger.error({ err: error }, '[ORG_STATUS_API] Failed to update status');
      return NextResponse.json(
        { error: 'Failed to update organization status' },
        { status: 500 }
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[ORG_STATUS_API] PATCH error');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

/**
 * Invalidate all sessions for members of an organization.
 * Uses batch Redis DEL (O(1)) instead of sequential deletes (O(n)).
 */
async function invalidateOrgSessions(orgId: string) {
  try {
    // Runs inside a verified target-org context (caller wraps with withTenantAdminContext).
    // Member is RLS-scoped (platform pass-through); Session has no RLS.
    const members = await tenantDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const sessionIds = members.map((m) => `session:${m.userId}`);

    // Invalidate in Redis cache using batch DEL (O(1) instead of O(n))
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (redis && sessionIds.length > 0) {
      await redis.del(...sessionIds);
    }

    // Invalidate database sessions
    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      await tenantDb.session.deleteMany({
        where: { userId: { in: userIds } },
      });
    }

    logger.info(`[ORG_STATUS_API] Invalidated sessions for ${members.length} members of org ${orgId}`);
  } catch (error) {
    logger.error({ err: error }, '[ORG_STATUS_API] Failed to invalidate sessions');
    // Don't fail the status change if session invalidation fails
  }
}

/**
 * Ban all users who are members of an organization.
 * Returns the number of users banned.
 */
async function banOrgUsers(orgId: string, orgName: string, adminUserId: string, newStatus: string): Promise<number> {
  try {
    // Runs inside a verified target-org context; Member rows are RLS-scoped.
    const members = await tenantDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      // User has no RLS — the update is global-scope.
      await tenantDb.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          banned: true,
          banReason: `Banned due to organization "${orgName}" being ${newStatus === 'SUSPENDED' ? 'suspended' : 'archived'}.`,
          banExpires: null, // permanent ban until org is reactivated
        },
      });

      logger.info({ userIds, count: userIds.length }, `[ORG_STATUS_API] Banned all users of org ${orgId}`);
      return userIds.length;
    } else {
      logger.info({ orgId }, '[ORG_STATUS_API] No members found to ban for org');
      return 0;
    }
  } catch (error) {
    logger.error({ err: error }, '[ORG_STATUS_API] Failed to ban org users');
    // Don't fail the status change if user banning fails
    return 0;
  }
}

/**
 * Unban all users who are members of an organization (on reactivation).
 * Returns the number of users unbanned.
 */
async function unbanOrgUsers(orgId: string, adminUserId: string): Promise<number> {
  try {
    // Runs inside a verified target-org context; Member rows are RLS-scoped.
    const members = await tenantDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      // User has no RLS — the update is global-scope.
      await tenantDb.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
        },
      });

      logger.info({ userIds, count: userIds.length }, `[ORG_STATUS_API] Unbanned all users of org ${orgId}`);
      return userIds.length;
    } else {
      logger.info({ orgId }, '[ORG_STATUS_API] No members found to unban for org');
      return 0;
    }
  } catch (error) {
    logger.error({ err: error }, '[ORG_STATUS_API] Failed to unban org users');
    // Don't fail the status change if user unbanning fails
    return 0;
  }
}

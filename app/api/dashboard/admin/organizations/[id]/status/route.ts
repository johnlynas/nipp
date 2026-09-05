import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';

import { OrganizationService } from '@/services/organization-service';
import type { ServiceContext } from '@/lib/services/types';
import { notifyOrganizationOperation, notifyOrganizationSuspension, notifyOrganizationArchival, notifyOrganizationReactivation } from '@/lib/notification-push';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

/**
 * PATCH /api/dashboard/admin/organizations/[id]/status
 * Update organization status (suspend/reactivate/archive).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const ctx: ServiceContext = {
    userId: auth.session!.user.id,
    role: 'PLATFORM_ADMIN',
  };
  const id = (await params).id;

  // Rate limit write operations by session
  if (!checkAdminRateLimit(ctx.userId)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.status) {
    return NextResponse.json({ error: 'Status is required' }, { status: 400 });
  }

  const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const;
  const newStatus = body.status as (typeof validStatuses)[number];
  if (!validStatuses.includes(newStatus)) {
    return NextResponse.json({ error: 'Invalid status value' }, { status: 400 });
  }

  // Archiving is the terminal removal for organizations (they cannot be deleted)
  const operation = newStatus === 'ARCHIVED' ? ('archive' as const) : ('update' as const);
  let targetLabel = id; // fallback label for error notifications

  try {
    // Capture the org name for the notification label before it possibly changes
    const org = await globalDb.organization.findUnique({
      where: { id },
      select: { name: true, status: true },
    });

    if (!org) {
      await notifyOrganizationOperation(operation, id, false, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    targetLabel = `Organization "${org.name}" (${id})`;

    // Ban all users in the org when suspending or archiving
    let userCount = 0;
    if (newStatus === 'SUSPENDED' || newStatus === 'ARCHIVED') {
      const actionLabel = newStatus === 'SUSPENDED' ? 'suspend' : 'archive';
      logger.warn({
        userId: ctx.userId,
        orgId: id,
        orgName: org.name,
        fromStatus: org.status,
        toStatus: newStatus,
      }, `[DASHBOARD_ORG_STATUS] ${actionLabel} organization — banning all member users`);

      userCount = await banOrgUsers(id, org.name, ctx.userId, newStatus);
    } else if (org.status === 'SUSPENDED' && newStatus === 'ACTIVE') {
      logger.info({
        userId: ctx.userId,
        orgId: id,
        orgName: org.name,
        fromStatus: org.status,
        toStatus: newStatus,
      }, `[DASHBOARD_ORG_STATUS] Reactivating organization — unbanning all member users`);

      userCount = await unbanOrgUsers(id, ctx.userId);
    }

    // Push SSE notifications for org lifecycle events (after ban/unban)
    if (newStatus === 'SUSPENDED' && userCount > 0) {
      await notifyOrganizationSuspension(
        id,
        org.name,
        userCount,
        auth.session?.user.name ?? undefined,
      );
      logger.info({ userId: ctx.userId, orgId: id, userCount }, '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization suspended');
    } else if (newStatus === 'ARCHIVED' && userCount > 0) {
      await notifyOrganizationArchival(
        id,
        org.name,
        userCount,
        auth.session?.user.name ?? undefined,
      );
      logger.info({ userId: ctx.userId, orgId: id, userCount }, '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization archived');
    } else if (org.status === 'SUSPENDED' && newStatus === 'ACTIVE' && userCount > 0) {
      await notifyOrganizationReactivation(
        id,
        org.name,
        userCount,
        auth.session?.user.name ?? undefined,
      );
      logger.info({ userId: ctx.userId, orgId: id, userCount }, '[DASHBOARD_ORG_STATUS] SSE notification dispatched — organization reactivated');
    } else if (userCount === 0) {
      logger.info({ userId: ctx.userId, orgId: id, newStatus }, '[DASHBOARD_ORG_STATUS] No members to ban/unban — skipping SSE notification');
    }

    // Invalidate sessions if suspending or archiving
    if (newStatus === 'SUSPENDED' || newStatus === 'ARCHIVED') {
      await invalidateOrgSessions(id);
    }

    const result = await OrganizationService.updateOrganization(
      id,
      { status: newStatus },
      ctx
    );

    await notifyOrganizationOperation(operation, targetLabel, true, undefined, id);

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'Organization not found') {
      await notifyOrganizationOperation(operation, id, false, 'Organization not found');
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }
    console.error('Failed to update organization status:', error);
    const message =
      error instanceof Error && error.message ? error.message : 'Failed to update organization status';
    await notifyOrganizationOperation(operation, targetLabel, false, message, id);
    return NextResponse.json({ error: 'Failed to update organization status' }, { status: 500 });
  }
}

/**
 * Ban all users who are members of an organization.
 * Returns the number of users banned.
 */
async function banOrgUsers(orgId: string, orgName: string, adminUserId: string, newStatus: string): Promise<number> {
  try {
    const members = await globalDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      await globalDb.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          banned: true,
          banReason: `Banned due to organization "${orgName}" being ${newStatus === 'SUSPENDED' ? 'suspended' : 'archived'}.`,
          banExpires: null, // permanent ban until org is reactivated
        },
      });

      logger.info({ userIds, count: userIds.length }, `[DASHBOARD_ORG_STATUS] Banned all users of org ${orgId}`);
      return userIds.length;
    } else {
      logger.info({ orgId }, '[DASHBOARD_ORG_STATUS] No members found to ban for org');
      return 0;
    }
  } catch (error) {
    logger.error({ err: error }, '[DASHBOARD_ORG_STATUS] Failed to ban org users');
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
    const members = await globalDb.member.findMany({
      where: { orgId },
      select: { userId: true },
    });

    const userIds = members.map((m) => m.userId);
    if (userIds.length > 0) {
      await globalDb.user.updateMany({
        where: { id: { in: userIds } },
        data: {
          banned: false,
          banReason: null,
          banExpires: null,
        },
      });

      logger.info({ userIds, count: userIds.length }, `[DASHBOARD_ORG_STATUS] Unbanned all users of org ${orgId}`);
      return userIds.length;
    } else {
      logger.info({ orgId }, '[DASHBOARD_ORG_STATUS] No members found to unban for org');
      return 0;
    }
  } catch (error) {
    logger.error({ err: error }, '[DASHBOARD_ORG_STATUS] Failed to unban org users');
    // Don't fail the status change if user unbanning fails
    return 0;
  }
}

/**
 * Invalidate all sessions for members of an organization.
 */
async function invalidateOrgSessions(orgId: string) {
  try {
    const members = await globalDb.member.findMany({
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
      await globalDb.session.deleteMany({
        where: { userId: { in: userIds } },
      });
    }

    logger.info(`[DASHBOARD_ORG_STATUS] Invalidated sessions for ${members.length} members of org ${orgId}`);
  } catch (error) {
    logger.error({ err: error }, '[DASHBOARD_ORG_STATUS] Failed to invalidate sessions');
    // Don't fail the status change if session invalidation fails
  }
}

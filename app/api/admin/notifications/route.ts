/**
 * POST /api/admin/notifications
 * Send notifications via SSE stream.
 * 
 * Admin-scoped: requires super admin authentication.
 * 
 * Scoping rules:
 *   - scope = 'global' + valid orgId → broadcast to ALL subscribers (super admins + all tenants)
 *   - scope = 'org' + valid orgId → delivered only to subscribers in that org (plus super admins)
 *   - scope = 'global' + no valid orgId → REJECTED (super admins must be associated with an org)
 *   - scope = 'org' + no valid orgId → REJECTED (must specify which org)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/require-super-admin';
// RLS Phase 3: notification history + send run under a verified platform context.
import tenantDb from '@/lib/tenant-db';
import { withPlatformContext } from '@/lib/platform-db';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { notifyAdminMessage } from '@/lib/notification-push';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST — Send a notification via SSE stream
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit admin operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const { title, message, scope, organizationId, priority } = body;

    // Validate required fields
    if (!title || !message) {
      return NextResponse.json(
        { error: 'Title and message are required' },
        { status: 400 }
      );
    }

    // Validate scope — must be 'global' or 'org'
    if (!scope || !['global', 'org'].includes(scope)) {
      return NextResponse.json(
        { error: 'Scope must be "global" or "org"' },
        { status: 400 }
      );
    }

    // Validate priority (optional, defaults to INFO). CALENDAR is the
    // "event due to start" reminder priority; JOB is emitted by the job scheduler.
    const validPriorities = ['info', 'warning', 'error', 'critical', 'calendar', 'job'] as const;
    const resolvedPriority = validPriorities.includes(priority) ? priority : 'info';

    // Validate orgId — required for both scopes
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      );
    }

    // Verify the org exists and get its details (verified platform context)
    const organization = await withPlatformContext(auth.session!.user.id, () =>
      tenantDb.organization.findUnique({
        where: { id: organizationId },
        select: { slug: true, name: true },
      }),
    );

    if (!organization) {
      return NextResponse.json(
        { error: 'Organization not found' },
        { status: 404 }
      );
    }

    // Push the notification through SSE (handles filtering by scope internally)
    notifyAdminMessage(
      title,
      message,
      organizationId,
      resolvedPriority as 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'CALENDAR' | 'JOB'
    );

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { error: 'Failed to send notification' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET — Notification history (paginated, filterable)
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit admin operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const url = new URL(request.url);
  let page = 1;
  let pageSize = 50;
  let scope: string | undefined;
  let priority: string | undefined;
  let organizationId: string | undefined;
  let acknowledged: boolean | undefined;
  let searchQuery: string | undefined;

  try {
    page = parseInt(url.searchParams.get('page') || '1', 10);
    pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
    scope = url.searchParams.get('scope') || undefined;
    priority = url.searchParams.get('priority') || undefined;
    organizationId = url.searchParams.get('organizationId') || undefined;
    const acknowledgedParam = url.searchParams.get('acknowledged');
    if (acknowledgedParam !== null) {
      acknowledged = acknowledgedParam === 'true';
    }
    searchQuery = url.searchParams.get('search') || undefined;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (scope) {
      where.scope = scope;
    }
    if (priority) {
      where.priority = priority;
    }
    if (organizationId) {
      where.organizationId = organizationId;
    }
    if (acknowledged !== undefined) {
      where.acknowledged = acknowledged;
    }
    if (searchQuery && searchQuery.trim()) {
      where.OR = [
        { source: { contains: searchQuery, mode: 'insensitive' } },
        { message: { contains: searchQuery, mode: 'insensitive' } },
      ];
    }

    // Verified platform context admits the full notification history (S-rls read)
    const [notifications, total, dashboardCounts, priorityCounts] = await withPlatformContext(
      auth.session!.user.id,
      async () => {
        const [list, count, dash, prio] = await Promise.all([
          tenantDb.notification.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
            include: { organization: { select: { name: true } } },
          }),
          tenantDb.notification.count({ where }),
          Promise.all([
            tenantDb.notification.count(),
            tenantDb.notification.count({ where: { acknowledged: true } }),
            tenantDb.notification.count({ where: { acknowledged: false } }),
          ]),
          Promise.all([
            tenantDb.notification.count({ where: { priority: 'INFO' } }),
            tenantDb.notification.count({ where: { priority: 'WARNING' } }),
            tenantDb.notification.count({ where: { priority: 'ERROR' } }),
            tenantDb.notification.count({ where: { priority: 'CRITICAL' } }),
            tenantDb.notification.count({ where: { priority: 'CALENDAR' } }),
            tenantDb.notification.count({ where: { priority: 'JOB' } }),
          ]),
        ]);
        return [list, count, dash, prio] as const;
      },
    );

    const [totalCount, acknowledgedCount, notAcknowledgedCount] = dashboardCounts;

    return NextResponse.json({
      notifications: notifications.map((n) => ({
        id: n.id,
        title: n.title,
        message: n.message,
        priority: n.priority,
        scope: n.scope,
        organizationId: n.organizationId ?? undefined,
        organizationName: n.organization?.name ?? undefined,
        source: n.source ?? undefined,
        acknowledged: n.acknowledged,
        createdAt: n.createdAt.toISOString(),
       })),
      pagination: { page, pageSize, total },
      counts: {
        totalCount,
        acknowledgedCount,
        notAcknowledgedCount,
        infoCount: priorityCounts[0],
        warningCount: priorityCounts[1],
        errorCount: priorityCounts[2],
        criticalCount: priorityCounts[3],
        calendarCount: priorityCounts[4],
        jobCount: priorityCounts[5],
        },
     });
  } catch (error) {
    logger.error({ err: error, page, pageSize, scope, priority }, 'Failed to fetch notifications');
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete a notification by ID
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit admin operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const url = new URL(request.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return NextResponse.json(
        { error: 'Notification ID is required' },
        { status: 400 }
      );
    }

    // Verified platform context — the Notification DELETE policy admits only flag=1.
    await withPlatformContext(auth.session!.user.id, () =>
      tenantDb.notification.delete({
        where: { id: notificationId },
      }),
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Failed to delete notification');
    return NextResponse.json(
      { error: 'Failed to delete notification' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PATCH — Toggle acknowledged state on a notification
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  const auth = await requireSuperAdmin(request.headers);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Rate limit admin operations by session
  if (!checkAdminRateLimit(auth.session!.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  try {
    const url = new URL(request.url);
    const notificationId = url.searchParams.get('id');

    if (!notificationId) {
      return NextResponse.json(
        { error: 'Notification ID is required' },
        { status: 400 }
      );
    }

    // Verified platform context — the Notification UPDATE policy admits only flag=1.
    const notification = await withPlatformContext(auth.session!.user.id, () =>
      tenantDb.notification.update({
        where: { id: notificationId },
        data: { acknowledged: true },
      }),
    );

    return NextResponse.json({ success: true, acknowledged: notification.acknowledged });
  } catch (error) {
    logger.error({ err: error }, 'Failed to acknowledge notification');
    return NextResponse.json(
      { error: 'Failed to acknowledge notification' },
      { status: 500 }
    );
  }
}

export const revalidate = 0;
export const dynamic = 'force-dynamic';

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
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { notifyAdminMessage } from '@/lib/notification-push';
import globalDb from '@/lib/global-db';
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

    // Validate priority (optional, defaults to INFO)
    const validPriorities = ['info', 'warning', 'error', 'critical'] as const;
    const resolvedPriority = validPriorities.includes(priority) ? priority : 'info';

    // Validate orgId — required for both scopes
    if (!organizationId) {
      return NextResponse.json(
        { error: 'Organization ID is required' },
        { status: 400 }
      );
    }

    // Verify the org exists and get its details
    const organization = await globalDb.organization.findUnique({
      where: { id: organizationId },
      select: { slug: true, name: true },
    });

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
      resolvedPriority as 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
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

  try {
    page = parseInt(url.searchParams.get('page') || '1', 10);
    pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10);
    scope = url.searchParams.get('scope') || undefined;
    priority = url.searchParams.get('priority') || undefined;

    // Build where clause
    const where: Record<string, unknown> = {};
    if (scope) {
      where.scope = scope;
    }
    if (priority) {
      where.priority = priority;
    }

    const [notifications, total] = await Promise.all([
      globalDb.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { organization: { select: { name: true } } },
      }),
      globalDb.notification.count({ where }),
    ]);

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
        createdAt: n.createdAt.toISOString(),
      })),
      pagination: { page, pageSize, total },
    });
  } catch (error) {
    logger.error({ err: error, page, pageSize, scope, priority }, 'Failed to fetch notifications');
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

export const revalidate = 0;
export const dynamic = 'force-dynamic';

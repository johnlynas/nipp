/**
 * Trigger today's event notifications.
 *
 * POST /api/organizations/[orgId]/calendar-notifications/send-today -- Send notifications
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { CalendarNotificationService } from '@/services/calendar-notification-service';
import { isSameSiteRequest } from '@/lib/csrf';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// POST -- Send today's event notifications
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  // SECURITY (S8): Validate CSRF for state-changing requests
  if (!isSameSiteRequest(req.method, req.headers)) {
    return NextResponse.json(
      { error: 'Forbidden: cross-site request blocked' },
      { status: 403 }
    );
  }

  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;

  // Verify membership
  const membership = await globalDb.member.findFirst({
    where: { userId: session.user.id, orgId },
  });

  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }

  const role = membership.role === 'admin' ? ('TENANT_ADMIN' as const) : ('MEMBER' as const);
  const ctx = { userId: session.user.id, role, organizationId: orgId };

  // Only admins can send notifications
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  const body = await req.json();
  const { userId, eventIds, notifyType } = body as {
    userId?: string;
    eventIds?: string[];
    notifyType?: 'TODAY_EVENTS';
  };

  try {
    const results = await CalendarNotificationService.sendTodayEventNotifications(ctx, {
      userId,
      organizationId: orgId,
      eventIds,
      notifyType: notifyType || 'TODAY_EVENTS',
    });

    const sent = results.filter((r) => r.status === 'SENT').length;
    const rateLimited = results.filter((r) => r.status === 'RATE_LIMITED').length;
    const failed = results.filter((r) => r.status === 'FAILED').length;

    return NextResponse.json({
      results,
      summary: { sent, rateLimited, failed },
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Notification delivery history.
 *
 * GET /api/organizations/[orgId]/calendar-notifications/history -- Get notification history
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET -- Get notification history
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
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

  // Only admins can view history
  if (role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Parse query params
  const url = new URL(req.url);
  const eventType = url.searchParams.get('eventType');
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);

  const where: Record<string, unknown> = { organizationId: orgId };
  if (eventType) {
    where.eventType = eventType;
  }

  try {
    const [logs, total] = await Promise.all([
      globalDb.notificationLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      globalDb.notificationLog.count({ where }),
    ]);

    return NextResponse.json({
      logs: logs.map((log) => ({
        id: log.id,
        recipientEmail: log.recipientEmail,
        eventType: log.eventType,
        message: log.message,
        status: log.status,
        timestamp: log.timestamp,
      })),
      pagination: { page, pageSize, total },
    });
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

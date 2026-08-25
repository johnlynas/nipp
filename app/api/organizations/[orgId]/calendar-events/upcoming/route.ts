/**
 * Upcoming calendar events endpoint for sidebar display.
 *
 * GET /api/organizations/[orgId]/calendar-events/upcoming -- Get upcoming events
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { superAdminStorage } from '@/lib/global-db-guard';
import { resolveTenantAccess } from '@/lib/tenant-access';
import { CalendarEventService } from '@/services/calendar-event-service';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET -- Get upcoming events for sidebar
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

  // Membership OR super admin (platform team can view any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const ctx = access.ctx;

  // Parse limit param
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '10', 10);

  try {
    // Scoping globalDb access (S7): required for tenant-org reads by super admins.
    const events = await superAdminStorage.run(true, () =>
      CalendarEventService.getUpcomingEvents(ctx, orgId, limit)
    );
    return NextResponse.json(events);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

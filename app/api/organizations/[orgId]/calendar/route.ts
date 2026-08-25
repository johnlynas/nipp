/**
 * Calendar management endpoints for an organization.
 *
 * GET    /api/organizations/[orgId]/calendar      — List all calendars
 * POST   /api/organizations/[orgId]/calendar      — Create a new calendar
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { superAdminStorage } from '@/lib/global-db-guard';
import { resolveTenantAccess } from '@/lib/tenant-access';
import { CalendarService } from '@/services/calendar-service';
import { isSameSiteRequest } from '@/lib/csrf';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET — List calendars
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

  try {
    // Scoping globalDb access (S7): see note in POST below.
    const calendars = await superAdminStorage.run(true, () =>
      CalendarService.getCalendars(ctx, orgId)
    );
    return NextResponse.json(calendars);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create calendar
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

  // Verify membership or super admin access
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Only admins (tenant admin or platform super admin) can create calendars
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }
  const ctx = access.ctx;

  const body = await req.json();
  const { name, description } = body as { name: string; description?: string | null };

  if (!name) {
    return NextResponse.json({ error: 'Calendar name is required' }, { status: 400 });
  }

  try {
    // Scoping globalDb access (S7): see note in GET above.
    const calendar = await superAdminStorage.run(true, () =>
      CalendarService.createCalendar(ctx, { name, description })
    );
    return NextResponse.json({ calendar }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

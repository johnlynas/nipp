/**
 * Single calendar endpoints.
 *
 * GET    /api/organizations/[orgId]/calendar/[id]      -- Get calendar by ID
 * PATCH  /api/organizations/[orgId]/calendar/[id]      -- Update calendar
 * DELETE /api/organizations/[orgId]/calendar/[id]      -- Delete calendar
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { superAdminStorage } from '@/lib/global-db-guard';
import { resolveTenantAccess } from '@/lib/tenant-access';
import { CalendarService } from '@/services/calendar-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET -- Get calendar by ID
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
) {
  const session = await auth.api.getSession({ headers: req.headers });

  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const orgId = (await params).orgId;
  const calendarId = (await params).id;

  // Membership OR super admin (platform team can view any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const ctx = access.ctx;

  try {
    // Scoping globalDb access (S7): see notes in PATCH/DELETE below.
    const calendar = await superAdminStorage.run(true, () =>
      CalendarService.getCalendarById(ctx, calendarId)
    );
    return NextResponse.json(calendar);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH -- Update calendar
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
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
  const calendarId = (await params).id;

  // Membership OR super admin (platform team can edit any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Only admins (tenant admin or platform super admin) can update calendars
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }
  const ctx = access.ctx;

// Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { name, description, color } = body as {
    name?: string;
    description?: string | null;
    color?: string;
  };

  try {
    // Scoping globalDb access (S7): see note in GET above.
    const calendar = await superAdminStorage.run(true, () =>
      CalendarService.updateCalendar(ctx, calendarId, { name, description, color })
    );
    return NextResponse.json({ calendar });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE -- Delete calendar
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string; id: string }> },
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
  const calendarId = (await params).id;

  // Verify membership or super admin access
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // Only admins (tenant admin or platform super admin) can delete calendars
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }
  const ctx = access.ctx;

  try {
    // Scoping globalDb access (S7) — see note in PATCH above.
    await superAdminStorage.run(true, () => CalendarService.deleteCalendar(ctx, calendarId));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

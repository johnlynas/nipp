/**
 * Calendar management endpoints for an organization.
 *
 * GET    /api/organizations/[orgId]/calendar      — List all calendars
 * POST   /api/organizations/[orgId]/calendar      — Create a new calendar
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
import { withRLSContext } from '@/lib/rls-transaction';
import { CalendarService } from '@/services/calendar-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

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
return withRLSContext(toTenantContext(access, session.user.id), async () => {
  const ctx = access.ctx;

  try {
    const calendars = await CalendarService.getCalendars(ctx, orgId);
    return NextResponse.json(calendars);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
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
return withRLSContext(toTenantContext(access, session.user.id), async () => {

  // Only admins (tenant admin or platform super admin) can create calendars
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }
  const ctx = access.ctx;

// Rate limit write operations
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { name, description } = body as { name: string; description?: string | null };

  if (!name) {
    return NextResponse.json({ error: 'Calendar name is required' }, { status: 400 });
  }

  try {
    const calendar = await CalendarService.createCalendar(ctx, { name, description });
    return NextResponse.json({ calendar }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('already') ? 409 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

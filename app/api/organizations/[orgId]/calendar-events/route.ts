/**
 * Calendar event management endpoints for an organization.
 *
 * GET    /api/organizations/[orgId]/calendar-events      -- List events (with date range)
 * POST   /api/organizations/[orgId]/calendar-events      -- Create event
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
import { withRLSContext } from '@/lib/rls-transaction';
import { CalendarEventService } from '@/services/calendar-event-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET -- List events with date range query params
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

  // Parse query params
  const url = new URL(req.url);
  const startParam = url.searchParams.get('start');
  const endParam = url.searchParams.get('end');
  const calendarId = url.searchParams.get('calendarId');

  if (!startParam || !endParam) {
    return NextResponse.json({ error: 'Start and end date parameters are required' }, { status: 400 });
  }

  const startDate = new Date(startParam);
  const endDate = new Date(endParam);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format. Use ISO 8601 format.' }, { status: 400 });
  }

  try {
    const events = await CalendarEventService.getEventsWithRecurrences(ctx, {
        startDate,
        endDate,
        calendarId: calendarId || undefined,
      });
    return NextResponse.json(events);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

// ---------------------------------------------------------------------------
// POST -- Create event
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

  // Membership OR super admin (platform team can edit any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
return withRLSContext(toTenantContext(access, session.user.id), async () => {
  const ctx = access.ctx;

  // Only admins (tenant admin or platform super admin) can create events
  if (ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit calendar write operations by session
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const body = await req.json();
  const { title, description, startDate, endDate, calendarId, eventType, color, propertyId, recurrence } = body as {
    title: string;
    description?: string | null;
    startDate: string;
    endDate: string;
    calendarId: string;
    eventType?: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
    color?: string | null;
    propertyId?: string | null;
    recurrence?: {
      frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
      interval?: number;
      endDate?: string;
      count?: number;
      byDay?: string | null;
      byMonthDay?: number | null;
      excludedDates?: string[];
    } | null;
  };

  if (!title || !startDate || !endDate || !calendarId) {
    return NextResponse.json({ error: 'Title, startDate, endDate, and calendarId are required' }, { status: 400 });
  }

  try {
    const event = await CalendarEventService.createEvent(ctx, {
      title,
      description,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      calendarId,
      eventType,
      color,
      propertyId,
      recurrence: recurrence ? {
        frequency: recurrence.frequency,
        interval: parseInt(String(recurrence.interval ?? 1), 10) || 1,
        endDate: recurrence.endDate ? new Date(recurrence.endDate) : undefined,
        count: recurrence.count != null ? parseInt(String(recurrence.count), 10) || undefined : undefined,
        byDay: recurrence.byDay ?? null,
        byMonthDay: recurrence.byMonthDay != null ? parseInt(String(recurrence.byMonthDay), 10) || undefined : undefined,
        excludedDates: recurrence.excludedDates ?? [],
      } : null,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

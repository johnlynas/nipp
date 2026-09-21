/**
 * Single calendar event endpoints.
 *
 * GET    /api/organizations/[orgId]/calendar-events/[id]      -- Get event by ID
 * PATCH  /api/organizations/[orgId]/calendar-events/[id]      -- Update event
 * DELETE /api/organizations/[orgId]/calendar-events/[id]      -- Delete event
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { resolveTenantAccess, toTenantContext } from '@/lib/tenant-access';
// RLS Phase 3: verified-context tenantDb (unscoped globalDb deleted).
import tenantDb from '@/lib/tenant-db';
import { withRLSContext } from '@/lib/rls-transaction';
import { CalendarEventService } from '@/services/calendar-event-service';
import { isSameSiteRequest } from '@/lib/csrf';
import { checkCalendarRateLimit } from '@/lib/rate-limiter';
import {
  applyEditScopeThis,
  applyEditScopeFollowing,
  applyEditScopeAll,
} from '@/lib/recurrence-scopes';

export const runtime = 'nodejs';

// ---------------------------------------------------------------------------
// GET -- Get event by ID
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
  const eventId = (await params).id;

  // Membership OR super admin (platform team can edit any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
return withRLSContext(toTenantContext(access, session.user.id), async () => {
  const ctx = access.ctx;

  try {
    const event = await CalendarEventService.getEventById(ctx, eventId);
    return NextResponse.json(event);
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

// ---------------------------------------------------------------------------
// PATCH -- Update event
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
  const eventId = (await params).id;

  // Membership OR super admin (platform team can edit any tenant's calendar)
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
return withRLSContext(toTenantContext(access, session.user.id), async () => {

  // Only admins (tenant admin or platform super admin) can update events
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit calendar write operations by session
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const ctx = access.ctx;

  const body = await req.json();
  const { title, description, startDate, endDate, eventType, color, propertyId, recurrence, excludedDate, editScope, clickedDate } = body as {
    title?: string;
    description?: string | null;
    startDate?: string;
    endDate?: string;
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
    } | null;
    excludedDate?: string; // Single date to exclude from recurrence expansion (YYYY-MM-DD)
    editScope?: 'this' | 'following' | 'all'; // Edit scope for recurring events
    clickedDate?: string; // The date of the instance being edited (YYYY-MM-DD)
  };

  try {
    return await (async () => {
    // Check if this is a recurring event with an edit scope
    const existingEvent = await tenantDb.calendarEvent.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId! },
    });

    if (!existingEvent) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const hasRecurrence = !!existingEvent.rrule;
    const scope = editScope as 'this' | 'following' | 'all' | undefined;

    if (scope && hasRecurrence) {
      // Apply edit scope handler
      const updates = {
        title,
        description,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        eventType,
        color,
        propertyId,
      };

      if (scope === 'this') {
        const instanceDate = clickedDate ? new Date(clickedDate + 'T00:00:00') : (updates.startDate ?? new Date());
        const result = await applyEditScopeThis(ctx, eventId, instanceDate, updates);
        // Fetch the override event to return
        const overrideEvent = await tenantDb.calendarEvent.findFirst({
          where: { id: result.overrideId, organizationId: ctx.organizationId! },
        });
        return NextResponse.json({ event: overrideEvent, editScope: 'this' });
      } else if (scope === 'following') {
        const instanceDate = clickedDate ? new Date(clickedDate + 'T00:00:00') : (updates.startDate ?? new Date());
        const result = await applyEditScopeFollowing(ctx, eventId, instanceDate, updates);
        // Fetch the new series event to return
        const newSeriesEvent = await tenantDb.calendarEvent.findFirst({
          where: { id: result.newSeriesId, organizationId: ctx.organizationId! },
        });
        return NextResponse.json({ event: newSeriesEvent, editScope: 'following' });
      } else if (scope === 'all') {
        await applyEditScopeAll(ctx, eventId, updates);
        const updatedEvent = await tenantDb.calendarEvent.findFirst({
          where: { id: eventId, organizationId: ctx.organizationId! },
        });
        return NextResponse.json({ event: updatedEvent, editScope: 'all' });
      }
    }

    // No edit scope or not recurring — apply updates in-place (existing behavior)
    const event = await CalendarEventService.updateEvent(ctx, eventId, {
      title,
      description,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      eventType,
      color,
      propertyId,
      excludedDate: excludedDate ?? undefined,
      recurrence: recurrence === null ? null : (recurrence ? {
        frequency: recurrence.frequency,
        interval: parseInt(String(recurrence.interval ?? 1), 10) || 1,
        endDate: recurrence.endDate ? new Date(recurrence.endDate) : undefined,
        count: recurrence.count != null ? parseInt(String(recurrence.count), 10) || undefined : undefined,
        byDay: recurrence.byDay ?? null,
        byMonthDay: recurrence.byMonthDay != null ? parseInt(String(recurrence.byMonthDay), 10) || undefined : undefined,
      } : undefined),
    });
    return NextResponse.json({ event });
    })();
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

// ---------------------------------------------------------------------------
// DELETE -- Delete event
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
  const eventId = (await params).id;

  // Verify membership or super admin access
  const access = await resolveTenantAccess(req, session.user.id, orgId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
return withRLSContext(toTenantContext(access, session.user.id), async () => {

  // Only admins (tenant admin or platform super admin) can delete events
  if (access.ctx.role === 'MEMBER') {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 });
  }

  // Rate limit calendar write operations by session
  if (!checkCalendarRateLimit(session.user.id)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  const ctx = access.ctx;

  try {
    await CalendarEventService.deleteEvent(ctx, eventId);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof Error) {
      const status = error.message.includes('not found') ? 404 : 400;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
  });
}

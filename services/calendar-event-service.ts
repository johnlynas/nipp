/**
 * CalendarEventService — CRUD operations for organization-scoped calendar events.
 *
 * Includes recurrence expansion, date range queries, and upcoming events.
 * Tenant isolation is enforced by the Prisma Extension (lib/tenant-db.ts) + PostgreSQL RLS.
 */

import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import {
  ServiceContext,
  ValidationError,
  NotFoundError,
} from '@/lib/services/types';
import { requireAnyAdmin } from '@/lib/services/base-service';
import { expandRecurrence as _expandRecurrence, RecurrenceRuleWithFilters } from '@/lib/recurrence';

// Re-export for backwards compatibility (tests and other consumers import directly)
export { expandRecurrence } from '@/lib/recurrence';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

export interface CreateEventInput {
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  calendarId: string;
  eventType?: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  propertyId?: string | null;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
    interval?: number;
    endDate?: Date;
    count?: number;
    byDay?: string | null;
    byMonthDay?: number | null;
    excludedDates?: string[];
  } | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  startDate?: Date;
  endDate?: Date;
  eventType?: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  propertyId?: string | null;
  /** Single date to exclude from recurrence expansion (YYYY-MM-DD). Appended to existing excludedDates. */
  excludedDate?: string;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
    interval?: number;
    endDate?: Date;
    count?: number;
    byDay?: string | null;
    byMonthDay?: number | null;
    excludedDates?: string[];
  } | null;
}

export interface GetEventsInput {
  startDate: Date;
  endDate: Date;
  calendarId?: string;
}

export interface CalendarEventRecurrenceDetails extends RecurrenceRuleWithFilters {}

export interface CalendarEventWithDetails {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  calendarId: string;
  recurrenceId?: string | null;
  /** Recurrence rule details (present when the event repeats). */
  recurrence?: CalendarEventRecurrenceDetails | null;
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Map a Prisma CalendarRecurrence relation (or null) to the API output shape.
 */
function mapRecurrence(
  r: {
    frequency: string;
    interval: number;
    endDate?: Date | null;
    count?: number | null;
    byDay?: string | null;
    byMonthDay?: number | null;
    excludedDates?: unknown;
  } | null | undefined,
): CalendarEventRecurrenceDetails | null {
  if (!r) return null;
  const excluded = r.excludedDates;
  const excludedDates: string[] = Array.isArray(excluded) ? (excluded as string[]) : [];
  return {
    frequency: r.frequency as CalendarEventRecurrenceDetails['frequency'],
    interval: r.interval,
    endDate: r.endDate ?? null,
    count: r.count ?? null,
    byDay: r.byDay ?? null,
    byMonthDay: r.byMonthDay ?? null,
    excludedDates,
  };
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

/**
 * Create a new calendar event.
 */
export async function createEvent(
  ctx: ServiceContext,
  input: CreateEventInput,
): Promise<CalendarEventWithDetails> {
  requireAnyAdmin(ctx);

  // Validate date range
  if (input.endDate < input.startDate) {
    throw new ValidationError('End date must be after start date');
  }

  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError('Event title is required');
  }

  // Verify calendar exists in the caller's organization (tenant isolation)
  const calendar = await globalDb.calendar.findFirst({
    where: { id: input.calendarId, organizationId: ctx.organizationId! },
  });

  if (!calendar) {
    throw new NotFoundError(`Calendar with ID "${input.calendarId}" not found`);
  }

  const event = await globalDb.calendarEvent.create({
    data: {
      title: input.title.trim(),
      description: input.description,
      startDate: input.startDate,
      endDate: input.endDate,
      eventType: input.eventType || 'OTHER',
      color: input.color ?? null,
      propertyId: input.propertyId ?? null,
      calendarId: input.calendarId,
      organizationId: ctx.organizationId!,
    },
  });

  // Create recurrence rule if provided
  let recurrenceId: string | null = null;
  let recurrence: {
    id: string;
    frequency: string;
    interval: number;
    endDate?: Date | null;
    count?: number | null;
  } | null = null;
  if (input.recurrence) {
    const recurrenceData: Record<string, unknown> = {
      frequency: input.recurrence.frequency,
      interval: input.recurrence.interval || 1,
      byDay: input.recurrence.byDay ?? null,
      byMonthDay: input.recurrence.byMonthDay ?? null,
    };

    if (input.recurrence.endDate) {
      recurrenceData.endDate = input.recurrence.endDate;
    }

    if (input.recurrence.count !== undefined) {
      recurrenceData.count = input.recurrence.count;
    }

    if (input.recurrence.excludedDates != null && input.recurrence.excludedDates.length > 0) {
      recurrenceData.excludedDates = input.recurrence.excludedDates;
    }

    recurrence = await globalDb.calendarRecurrence.create({
      data: {
        frequency: input.recurrence.frequency,
        interval: input.recurrence.interval || 1,
        byDay: input.recurrence.byDay ?? null,
        byMonthDay: input.recurrence.byMonthDay ?? null,
        endDate: recurrenceData.endDate as Date | undefined,
        count: recurrenceData.count as number | undefined,
        excludedDates: (recurrenceData.excludedDates as string[]) ?? [],
        eventId: event.id,
        organizationId: ctx.organizationId!,
      },
    });

    recurrenceId = recurrence.id;

    // Keep the event's scalar in sync so filters and lookups by recurrenceId work
    await globalDb.calendarEvent.update({
      where: { id: event.id, organizationId: ctx.organizationId! },
      data: { recurrenceId },
    });
  }

  logger.info(
    { userId: ctx.userId, eventId: event.id },
    `Event created: ${event.title}`,
  );

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startDate: event.startDate,
    endDate: event.endDate,
    eventType: event.eventType,
    color: event.color,
    calendarId: event.calendarId,
    recurrenceId,
    recurrence: mapRecurrence(recurrence),
    propertyId: event.propertyId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/**
 * Get events within a date range.
 */
export async function getEvents(
  ctx: ServiceContext,
  input: GetEventsInput,
): Promise<CalendarEventWithDetails[]> {
  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId!,
    startDate: { lte: input.endDate },
    endDate: { gte: input.startDate },
  };

  if (input.calendarId) {
    where.calendarId = input.calendarId;
  }

  const events = await globalDb.calendarEvent.findMany({
    where,
    orderBy: { startDate: 'asc' },
  });

  return events.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventType: e.eventType ,
    color: e.color,
    calendarId: e.calendarId,
    recurrenceId: e.recurrenceId,
    propertyId: e.propertyId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
}

/**
 * Get events within a date range with recurrence expansion.
 */
export async function getEventsWithRecurrences(
  ctx: ServiceContext,
  input: GetEventsInput,
): Promise<CalendarEventWithDetails[]> {
  // Non-recurring events must overlap the range directly. Recurring events are
  // active as long as the series has started by range end — expandRecurrence
  // applies the rule's own end date/count and per-instance overlap check.
  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId!,
    OR: [
      { recurrence: null, startDate: { lte: input.endDate }, endDate: { gte: input.startDate } },
      { recurrence: { isNot: null }, startDate: { lte: input.endDate } },
    ],
  };

  if (input.calendarId) {
    where.calendarId = input.calendarId;
  }

  const events = await globalDb.calendarEvent.findMany({
    where,
    orderBy: { startDate: 'asc' },
    include: { recurrence: true },
  });

  // Expand recurring events and flatten into instances
  const allInstances: CalendarEventWithDetails[] = [];

  for (const event of events) {
    const recurrenceDetails = mapRecurrence(event.recurrence);

    // Build the rule for expandRecurrence (4th arg)
    const rule: RecurrenceRuleWithFilters | null = event.recurrence ? {
      frequency: event.recurrence.frequency as RecurrenceRuleWithFilters['frequency'],
      interval: event.recurrence.interval,
      endDate: event.recurrence.endDate ?? null,
      count: event.recurrence.count ?? null,
      byDay: (event.recurrence as any).byDay ?? null,
      byMonthDay: (event.recurrence as any).byMonthDay ?? null,
      excludedDates: (event.recurrence as any).excludedDates ?? [],
    } : null;

    const expanded = _expandRecurrence(
      { ...event } as CalendarEventWithDetails,
      input.startDate,
      input.endDate,
      rule,
    );

    // Attach recurrence details to each instance so clients can display/edit the rule
    allInstances.push(...expanded.map((instance) => ({ ...instance, recurrence: recurrenceDetails })));
  }

  // Sort by start date and deduplicate (same event may appear in overlapping ranges)
  allInstances.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  return allInstances;
}

/**
 * Get a single event by ID.
 */
export async function getEventById(
  ctx: ServiceContext,
  eventId: string,
): Promise<CalendarEventWithDetails> {
  const event = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
    include: { recurrence: true },
  });

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startDate: event.startDate,
    endDate: event.endDate,
    eventType: event.eventType ,
    color: event.color,
    calendarId: event.calendarId,
    recurrenceId: event.recurrenceId,
    recurrence: mapRecurrence(event.recurrence),
    propertyId: event.propertyId,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/**
 * Update an existing event.
 */
export async function updateEvent(
  ctx: ServiceContext,
  eventId: string,
  input: UpdateEventInput,
): Promise<CalendarEventWithDetails> {
  requireAnyAdmin(ctx);

  const event = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
    include: { recurrence: true },
  });

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

  // Validate date range if dates are being updated
  const newStartDate = input.startDate ?? event.startDate;
  const newEndDate = input.endDate ?? event.endDate;

  if (newEndDate < newStartDate) {
    throw new ValidationError('End date must be after start date');
  }

  const updateData: Record<string, unknown> = {};

  if (input.title !== undefined) {
    if (input.title.trim().length === 0) {
      throw new ValidationError('Event title cannot be empty');
    }
    updateData.title = input.title.trim();
  }

  if (input.description !== undefined) {
    updateData.description = input.description;
  }

  if (input.startDate !== undefined) {
    updateData.startDate = input.startDate;
  }

  if (input.endDate !== undefined) {
    updateData.endDate = input.endDate;
  }

  if (input.eventType !== undefined) {
    updateData.eventType = input.eventType;
  }

  if (input.color !== undefined) {
    updateData.color = input.color;
  }

  if (input.propertyId !== undefined) {
    updateData.propertyId = input.propertyId;
  }

  // Handle recurrence changes — branch on the relation (robust even if the
  // event's recurrenceId scalar is stale from legacy rows)
  if (input.recurrence !== undefined || input.excludedDate !== undefined) {
    // Handle excludedDate (top-level single-date exclusion for drag-and-drop)
    if (input.excludedDate !== undefined && event.recurrence) {
      const existingExcluded = (event.recurrence as any).excludedDates ?? [];
      if (!existingExcluded.includes(input.excludedDate)) {
        await globalDb.calendarRecurrence.update({
          where: { id: event.recurrence.id, organizationId: ctx.organizationId! },
          data: { excludedDates: [...existingExcluded, input.excludedDate] },
        });
      }
    }

    if (input.recurrence !== undefined) {
      if (input.recurrence === null) {
        // Remove recurrence — delete the rule and set recurrenceId to null
        if (event.recurrence) {
          await globalDb.calendarRecurrence.delete({
            where: { id: event.recurrence.id, organizationId: ctx.organizationId! },
          });
        }
        updateData.recurrenceId = null;
      } else {
        // Update or create recurrence rule
        const recurrenceData: Record<string, unknown> = {
          frequency: input.recurrence.frequency,
          interval: input.recurrence.interval || 1,
          byDay: input.recurrence.byDay ?? null,
          byMonthDay: input.recurrence.byMonthDay ?? null,
        };

        if (input.recurrence.endDate) {
          recurrenceData.endDate = input.recurrence.endDate;
        }

        if (input.recurrence.count !== undefined) {
          recurrenceData.count = input.recurrence.count;
        }

        if (event.recurrence) {
          // Update existing recurrence rule — append excludedDates to existing ones
          if (input.recurrence?.excludedDates != null && input.recurrence.excludedDates.length > 0) {
            const existingExcluded = (event.recurrence as any).excludedDates ?? [];
            const merged = Array.from(new Set([...existingExcluded, ...input.recurrence.excludedDates]));
            (recurrenceData as Record<string, unknown>).excludedDates = merged;
          }

          await globalDb.calendarRecurrence.update({
            where: { id: event.recurrence.id, organizationId: ctx.organizationId! },
            data: recurrenceData,
          });
        } else {
        // Create new recurrence rule
        const recurrence = await globalDb.calendarRecurrence.create({
          data: {
            frequency: input.recurrence!.frequency,
            interval: input.recurrence!.interval || 1,
            byDay: input.recurrence!.byDay ?? null,
            byMonthDay: input.recurrence!.byMonthDay ?? null,
            endDate: recurrenceData.endDate as Date | undefined,
            count: recurrenceData.count as number | undefined,
            eventId,
            organizationId: ctx.organizationId!,
          },
        });
        updateData.recurrenceId = recurrence.id;
      }}
    }
  }

  const updated = await globalDb.calendarEvent.update({
    where: { id: eventId, organizationId: ctx.organizationId! },
    data: updateData,
    include: { recurrence: true },
  });

  logger.info(
    { userId: ctx.userId, eventId: updated.id },
    `Event updated: ${updated.title}`,
  );

  return {
    id: updated.id,
    title: updated.title,
    description: updated.description,
    startDate: updated.startDate,
    endDate: updated.endDate,
    eventType: updated.eventType ,
    color: updated.color,
    calendarId: updated.calendarId,
    recurrenceId: updated.recurrenceId,
    recurrence: mapRecurrence(updated.recurrence),
    propertyId: updated.propertyId,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  };
}

/**
 * Delete an event (including its recurrence rule if applicable).
 */
export async function deleteEvent(
  ctx: ServiceContext,
  eventId: string,
): Promise<void> {
  requireAnyAdmin(ctx);

  const event = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
    include: { recurrence: true },
  });

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

  // Delete recurrence rule if it exists (the relation is Restrict, so the
  // child row must go first — use the relation id, not just the scalar)
  if (event.recurrence) {
    await globalDb.calendarRecurrence.delete({
      where: { id: event.recurrence.id, organizationId: ctx.organizationId! },
    });
  }

  await globalDb.calendarEvent.delete({
    where: { id: eventId, organizationId: ctx.organizationId! },
  });

  logger.info(
    { userId: ctx.userId, eventId },
    `Event deleted`,
  );
}

/**
 * Get upcoming events for the sidebar (after today, sorted by date).
 */
export async function getUpcomingEvents(
  ctx: ServiceContext,
  orgId?: string,
  limit: number = 10,
): Promise<CalendarEventWithDetails[]> {
  const targetOrgId = orgId ?? ctx.organizationId;

  if (!targetOrgId) {
    throw new ValidationError('Organization context is required');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingWindowEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  // Get non-recurring upcoming events (exclude recurring ones — they are
  // expanded below, which would otherwise double-count them)
  const singleEvents = await globalDb.calendarEvent.findMany({
    where: {
      organizationId: targetOrgId,
      recurrence: null,
      startDate: { gte: today },
    },
    orderBy: { startDate: 'asc' },
    take: limit,
  });

  // Get recurring events and expand for upcoming window (next 30 days).
  // A series is active if it has started by the end of the window; expansion
  // applies the rule's own end date/count and per-instance overlap check.
  const recurringEvents = await globalDb.calendarEvent.findMany({
    where: {
      organizationId: targetOrgId,
      recurrence: { isNot: null },
      startDate: { lte: upcomingWindowEnd },
    },
    include: { recurrence: true },
  });

  const recurringInstances: CalendarEventWithDetails[] = [];

  for (const event of recurringEvents) {
    const rule: RecurrenceRuleWithFilters | null = event.recurrence ? {
      frequency: event.recurrence.frequency as RecurrenceRuleWithFilters['frequency'],
      interval: event.recurrence.interval,
      endDate: event.recurrence.endDate ?? null,
      count: event.recurrence.count ?? null,
      byDay: (event.recurrence as any).byDay ?? null,
      byMonthDay: (event.recurrence as any).byMonthDay ?? null,
      excludedDates: (event.recurrence as any).excludedDates ?? [],
    } : null;

    const expanded = _expandRecurrence(
      { ...event } as CalendarEventWithDetails,
      today,
      upcomingWindowEnd,
      rule,
    );

    recurringInstances.push(...expanded);
  }

  // Combine and sort, then limit
  const allEvents = [...singleEvents.map(mapEvent), ...recurringInstances];
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  return allEvents.slice(0, limit);
}

function mapEvent(e: {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  calendarId: string;
  recurrenceId?: string | null;
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CalendarEventWithDetails {
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventType: e.eventType ,
    color: e.color,
    calendarId: e.calendarId,
    recurrenceId: e.recurrenceId,
    propertyId: e.propertyId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

/**
 * CalendarEventService — full CRUD with recurrence expansion and upcoming events.
 */
export const CalendarEventService = {
  createEvent,
  getEvents,
  getEventsWithRecurrences,
  getEventById,
  updateEvent,
  deleteEvent,
  getUpcomingEvents,
};

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
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
    interval?: number;
    endDate?: Date;
    count?: number;
    byDay?: string | null;
    byMonthDay?: number | null;
  } | null;
}

export interface GetEventsInput {
  startDate: Date;
  endDate: Date;
  calendarId?: string;
}

export interface CalendarEventRecurrenceDetails {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
  interval: number;
  endDate?: Date | null;
  count?: number | null;
}

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
  } | null | undefined,
): CalendarEventRecurrenceDetails | null {
  if (!r) return null;
  return {
    frequency: r.frequency as CalendarEventRecurrenceDetails['frequency'],
    interval: r.interval,
    endDate: r.endDate ?? null,
    count: r.count ?? null,
  };
}

// ---------------------------------------------------------------------------
// Recurrence expansion (pure function)
// ---------------------------------------------------------------------------

/**
 * Expand a recurring event into individual instances within the given date range.
 */
export function expandRecurrence(
  event: CalendarEventWithDetails,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEventWithDetails[] {
  const instances: CalendarEventWithDetails[] = [];

  if (!event.recurrence) {
    // Single event — check if it overlaps the range
    if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
      instances.push({ ...event });
    }
    return instances;
  }

  const { frequency, interval: freqInterval, endDate, count } = event.recurrence;
  let current = new Date(event.startDate);
  const maxOccurrences = 52 * 12; // Cap at ~10 years of weekly events
  let occurrenceCount = 0;

  // Each instance keeps the base event's duration (end - start)
  const durationMs = event.endDate.getTime() - event.startDate.getTime();

  while (current <= rangeEnd && occurrenceCount < maxOccurrences) {
    // Stop if past recurrence end date or count limit
    if (endDate && current > endDate) break;
    if (count != null && occurrenceCount >= count) break;

    // Check overlap with range — the instance end is shifted by duration so
    // later occurrences are not compared against the base event's absolute end
    const instanceEnd = new Date(current.getTime() + durationMs);
    if (current <= rangeEnd && instanceEnd >= rangeStart) {
      instances.push({ ...event, startDate: new Date(current), endDate: instanceEnd });
      console.log(`[CAL-DEBUG] expandRecurrence: event=${event.id} occ#${occurrenceCount} start=${current.toISOString()} end=${instanceEnd.toISOString()}`);
    }

    // Advance by frequency + interval
    current = advanceDate(current, frequency, freqInterval);
    occurrenceCount++;
  }

  // [CAL-DEBUG] detect duplicate instances produced by expansion itself
  {
    const keys = new Map<string, number>();
    for (const i of instances) {
      const k = `${i.id}:${new Date(i.startDate).toISOString()}`;
      keys.set(k, (keys.get(k) || 0) + 1);
    }
    const dups = [...keys.entries()].filter(([, n]) => n > 1);
    if (dups.length) console.log(`[CAL-DEBUG] expandRecurrence: DUPLICATE instances for event=${event.id}:`, dups);
  }

  return instances;
}

/**
 * Advance a date by the given frequency and interval.
 */
function advanceDate(date: Date, frequency: string, interval: number): Date {
  const result = new Date(date);

  switch (frequency) {
    case 'DAILY':
      result.setDate(result.getDate() + interval);
      break;
    case 'WEEKLY':
      result.setDate(result.getDate() + interval * 7);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + interval);
      break;
    case 'QUARTERLY':
      result.setMonth(result.getMonth() + interval * 3);
      break;
    case 'SEMI_ANNUALLY':
      result.setMonth(result.getMonth() + interval * 6);
      break;
    case 'ANNUALLY':
      result.setFullYear(result.getFullYear() + interval);
      break;
    default:
      result.setDate(result.getDate() + 1);
  }

  return result;
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

    recurrence = await globalDb.calendarRecurrence.create({
      data: {
        frequency: input.recurrence.frequency,
        interval: input.recurrence.interval || 1,
        byDay: input.recurrence.byDay ?? null,
        byMonthDay: input.recurrence.byMonthDay ?? null,
        endDate: recurrenceData.endDate as Date | undefined,
        count: recurrenceData.count as number | undefined,
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

  console.log('[CalendarService] getEventsWithRecurrences: fetched', events.length, 'base events for range:', input.startDate.toISOString(), '-', input.endDate.toISOString());

  for (const event of events) {
    const recurrenceDetails = mapRecurrence(event.recurrence);

    console.log('[CalendarService] Expanding event:', event.id, event.title, 'recurrence:', recurrenceDetails ? JSON.stringify(recurrenceDetails) : 'none');

    const expanded = expandRecurrence(
      { ...event, recurrence: event.recurrence ? {
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        endDate: event.recurrence.endDate ?? undefined,
        count: event.recurrence.count ?? undefined,
      } : undefined },
      input.startDate,
      input.endDate,
    );

    console.log('[CalendarService] Expanded to', expanded.length, 'instances:', JSON.stringify(expanded.map(i => ({ id: i.id, startDate: i.startDate }))));

    // Attach recurrence details to each instance so clients can display/edit the rule
    allInstances.push(...expanded.map((instance) => ({ ...instance, recurrence: recurrenceDetails })));
  }

  // Sort by start date and deduplicate (same event may appear in overlapping ranges)
  allInstances.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  // [CAL-DEBUG] detect duplicates in the final list returned to the client
  {
    const keys = new Map<string, number>();
    for (const i of allInstances) {
      const k = `${i.id}:${new Date(i.startDate).toISOString()}`;
      keys.set(k, (keys.get(k) || 0) + 1);
    }
    const dups = [...keys.entries()].filter(([, n]) => n > 1);
    console.log(`[CAL-DEBUG] getEventsWithRecurrences: returning ${allInstances.length} instances, duplicates=${dups.length ? JSON.stringify(dups) : 'none'}`);
  }

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
        // Update existing recurrence rule
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
      }
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
    const expanded = expandRecurrence(
      { ...event, recurrence: event.recurrence ? {
        frequency: event.recurrence.frequency,
        interval: event.recurrence.interval,
        endDate: event.recurrence.endDate ?? undefined,
        count: event.recurrence.count ?? undefined,
      } : undefined },
      today,
      upcomingWindowEnd,
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

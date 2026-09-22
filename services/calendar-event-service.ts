/**
 * CalendarEventService — CRUD operations for organization-scoped calendar events.
 *
 * Recurrence is stored as rrule JSON (RFC 5545) on CalendarEvent.rrule.
 * Tenant isolation is enforced by the Prisma Extension (lib/tenant-db.ts) + PostgreSQL RLS.
 */

// RLS plan Phase 3: tenantDb (scoped) replaces the unscoped globalDb; each
// operation runs inside runWithTenant(orgId) so the Prisma extension resolves a context.
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { logger } from '@/lib/logger';
import {
  ServiceContext,
  ValidationError,
  NotFoundError,
} from '@/lib/services/types';
import { requireAnyAdmin } from '@/lib/services/base-service';
import { expandRecurrenceWithRrule, RruleJson } from '@/lib/recurrence-rrule';
import { RecurrenceRuleWithFilters } from '@/lib/recurrence';

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

export type CalendarEventRecurrenceDetails = RecurrenceRuleWithFilters;

export interface CalendarEventWithDetails {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  calendarId: string;
  /** Recurrence rule details (present when the event repeats). */
  recurrence?: CalendarEventRecurrenceDetails | null;
  /** RFC 5545 rrule JSON (raw, for API consumers that need it). */
  rrule?: unknown;
  /** Excluded dates from expansion. */
  exdates?: string[];
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown; // Allow arbitrary extra fields (passed through expansion)
}

/**
 * Map rrule JSON to the API output shape.
 */
function mapRecurrenceFromRrule(rruleJson: RruleJson | null): CalendarEventRecurrenceDetails | null {
  if (!rruleJson) return null;

  // Map rrule freq back to our frequency enum values
  const freqMap: Record<string, string> = {
    DAILY: 'DAILY',
    WEEKLY: 'WEEKLY',
    MONTHLY: 'MONTHLY',
    QUARTERLY: 'QUARTERLY',
    SEMI_ANNUALLY: 'SEMI_ANNUALLY',
    YEARLY: 'ANNUALLY', // rrule stores as YEARLY, our enum uses ANNUALLY
  };

  // Reverse the QUARTERLY/SEMI_ANNUALLY mapping for display
  let frequency = freqMap[rruleJson.freq] ?? 'DAILY';
  let interval = rruleJson.interval;

  if (frequency === 'MONTHLY' && rruleJson.freq === 'QUARTERLY') {
    frequency = 'QUARTERLY';
    interval = Math.round(rruleJson.interval / 3);
  } else if (frequency === 'MONTHLY' && rruleJson.freq === 'SEMI_ANNUALLY') {
    frequency = 'SEMI_ANNUALLY';
    interval = Math.round(rruleJson.interval / 6);
  }

  // Map byweekday array back to comma-separated string
  const byDay = rruleJson.byweekday && rruleJson.byweekday.length > 0
    ? rruleJson.byweekday.join(',')
    : null;

  // Map bymonthday array back to single value (legacy only supports one)
  const byMonthDay = rruleJson.bymonthday && rruleJson.bymonthday.length > 0
    ? rruleJson.bymonthday[0]
    : null;

  return {
    frequency: frequency as CalendarEventRecurrenceDetails['frequency'],
    interval,
    endDate: rruleJson.until,
    count: rruleJson.count,
    byDay,
    byMonthDay,
    excludedDates: [], // exdates are stored on the event, not in recurrence details
  };
}

/** Helper: parse rrule JSON field from a Prisma event row. */
function getRruleJson(event: { rrule?: unknown }): RruleJson | null {
  if (!event.rrule) return null;
  const raw = event.rrule;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as RruleJson; } catch { return null; }
  }
  if (typeof raw === 'object') return raw as RruleJson;
  return null;
}

/** Helper: parse exdates JSON field from a Prisma event row. */
function getExdates(event: { exdates?: unknown }): string[] {
  if (!event.exdates) return [];
  const raw = event.exdates;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as string[]; } catch { return []; }
  }
  if (Array.isArray(raw)) return raw as string[];
  return [];
}

/** Helper: build rrule JSON from CreateEventInput recurrence. */
function buildRruleJson(inputRecurrence: NonNullable<CreateEventInput['recurrence']>, startDate: Date): RruleJson {
  let rruleFreq = inputRecurrence.frequency;
  let rruleInterval = inputRecurrence.interval || 1;

  if (inputRecurrence.frequency === 'QUARTERLY') {
    rruleFreq = 'MONTHLY';
    rruleInterval = (inputRecurrence.interval || 1) * 3;
  } else if (inputRecurrence.frequency === 'SEMI_ANNUALLY') {
    rruleFreq = 'MONTHLY';
    rruleInterval = (inputRecurrence.interval || 1) * 6;
  }

  return {
    freq: rruleFreq as RruleJson['freq'],
    interval: rruleInterval,
    dtstart: startDate,
    until: inputRecurrence.endDate ?? null,
    count: inputRecurrence.count ?? null,
    byweekday: inputRecurrence.byDay ? inputRecurrence.byDay.split(',').map((d) => d.trim().toUpperCase()) : null,
    bymonthday: inputRecurrence.byMonthDay != null ? [inputRecurrence.byMonthDay] : null,
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

  if (input.endDate < input.startDate) {
    throw new ValidationError('End date must be after start date');
  }

  if (!input.title || input.title.trim().length === 0) {
    throw new ValidationError('Event title is required');
  }

  const calendar = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendar.findFirst({
      where: { id: input.calendarId, organizationId: ctx.organizationId! },
    }),
  );

  if (!calendar) {
    throw new NotFoundError(`Calendar with ID "${input.calendarId}" not found`);
  }

  const eventData: Record<string, unknown> = {
    title: input.title.trim(),
    description: input.description,
    startDate: input.startDate,
    endDate: input.endDate,
    eventType: input.eventType || 'OTHER',
    color: input.color ?? null,
    propertyId: input.propertyId ?? null,
    calendarId: input.calendarId,
    organizationId: ctx.organizationId!,
  };

  if (input.recurrence) {
    const rruleJson = buildRruleJson(input.recurrence, input.startDate);
    eventData.rrule = rruleJson as unknown as string;

    if (input.recurrence.excludedDates != null && input.recurrence.excludedDates.length > 0) {
      eventData.exdates = input.recurrence.excludedDates as unknown as string;
    }
  }

  const event = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.create({ data: eventData as unknown as Parameters<typeof tenantDb.calendarEvent.create>[0]['data'] }),
  );

  logger.info(
    { userId: ctx.userId, eventId: event.id },
    `Event created: ${event.title}`,
  );

  // Build recurrence details from the rrule JSON we just wrote
  let recurrenceDetails: CalendarEventRecurrenceDetails | null = null;
  if (input.recurrence) {
    const rruleJson = buildRruleJson(input.recurrence, input.startDate);
    recurrenceDetails = mapRecurrenceFromRrule(rruleJson);
  }

  const exdates = input.recurrence?.excludedDates ?? [];

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startDate: event.startDate,
    endDate: event.endDate,
    eventType: event.eventType,
    color: event.color,
    calendarId: event.calendarId,
    recurrence: recurrenceDetails,
    rrule: input.recurrence ? buildRruleJson(input.recurrence, input.startDate) : null,
    exdates: exdates.length > 0 ? exdates : undefined,
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

  const events = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.findMany({
      where,
      orderBy: { startDate: 'asc' },
    }),
  );

  return events.map((e) => mapEventToDetails(e));
}

/**
 * Get events within a date range with recurrence expansion.
 */
export async function getEventsWithRecurrences(
  ctx: ServiceContext,
  input: GetEventsInput,
): Promise<CalendarEventWithDetails[]> {
  // Prisma Json columns can't be filtered with { not: null } in the query,
  // so we fetch all events that could match and filter in code.
  const where: Record<string, unknown> = {
    organizationId: ctx.organizationId!,
    startDate: { lte: input.endDate },
  };

  if (input.calendarId) {
    where.calendarId = input.calendarId;
  }

  const events = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.findMany({
      where,
      orderBy: { startDate: 'asc' },
    }),
  );

  // Filter non-recurring events for actual date-range overlap.
  // Recurring events are included as long as the series started by rangeEnd —
  // expansion handles per-instance overlap via the rule's own end date/count.
  const candidates = events.filter((event) => {
    if (getRruleJson(event)) return true; // recurring — expansion handles overlap
    const eEnd = new Date(event.endDate);
    return eEnd >= input.startDate; // non-recurring must overlap range
  });

  const allInstances: CalendarEventWithDetails[] = [];

  for (const event of candidates) {
    const rruleJson = getRruleJson(event);
    const exdates = getExdates(event);

    if (rruleJson) {
      // Recurring event: expand using rrule JSON
      const recurrenceDetails = mapRecurrenceFromRrule(rruleJson);

      const expanded = expandRecurrenceWithRrule(
        { ...event } as CalendarEventWithDetails,
        input.startDate,
        input.endDate,
        rruleJson,
        exdates.length > 0 ? exdates : undefined,
      );

      allInstances.push(...(expanded.map((instance) => ({ ...instance, recurrence: recurrenceDetails })) as CalendarEventWithDetails[]));
    } else {
      // Non-recurring event — include as-is
      allInstances.push(mapEventToDetails(event));
    }
  }

  // Sort by start date and deduplicate
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
  const event = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId! },
    }),
  );

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

  return mapEventToDetails(event);
}

/** Map a Prisma event row to CalendarEventWithDetails (non-expanded). */
function mapEventToDetails(e: {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: string;
  color?: string | null;
  calendarId: string;
  rrule?: unknown;
  exdates?: unknown;
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}): CalendarEventWithDetails {
  const rruleJson = getRruleJson(e);
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startDate: e.startDate,
    endDate: e.endDate,
    eventType: e.eventType as CalendarEventWithDetails['eventType'],
    color: e.color,
    calendarId: e.calendarId,
    recurrence: mapRecurrenceFromRrule(rruleJson),
    rrule: e.rrule,
    exdates: getExdates(e),
    propertyId: e.propertyId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
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

  const event = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId! },
    }),
  );

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

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

  // Handle recurrence changes — write to rrule JSON only
  if (input.recurrence !== undefined || input.excludedDate !== undefined) {
    // Handle excludedDate (top-level single-date exclusion for drag-and-drop)
    if (input.excludedDate !== undefined) {
      const existingExdates = getExdates(event);
      if (!existingExdates.includes(input.excludedDate)) {
        updateData.exdates = [...existingExdates, input.excludedDate] as unknown as string;
      }
    }

    if (input.recurrence !== undefined) {
      if (input.recurrence === null) {
        // Remove recurrence — clear rrule JSON and exdates
        updateData.rrule = null;
        updateData.exdates = [] as unknown as string;
      } else {
        // Build rrule JSON for the new format
        const useStartDate = input.startDate ?? event.startDate;
        const rruleJson = buildRruleJson(input.recurrence, useStartDate);
        updateData.rrule = rruleJson as unknown as string;

        // Merge exdates if provided
        if (input.recurrence.excludedDates != null && input.recurrence.excludedDates.length > 0) {
          const existingExdates = getExdates(event);
          const mergedExdates = Array.from(new Set([...existingExdates, ...input.recurrence.excludedDates]));
          updateData.exdates = mergedExdates as unknown as string;
        }
      }
    }
  }

  const updated = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.update({
      where: { id: eventId, organizationId: ctx.organizationId! },
      data: updateData,
    }),
  );

  logger.info(
    { userId: ctx.userId, eventId: updated.id },
    `Event updated: ${updated.title}`,
  );

  return mapEventToDetails(updated);
}

/**
 * Delete an event.
 */
export async function deleteEvent(
  ctx: ServiceContext,
  eventId: string,
): Promise<void> {
  requireAnyAdmin(ctx);

  const event = await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.findFirst({
      where: { id: eventId, organizationId: ctx.organizationId! },
    }),
  );

  if (!event) {
    throw new NotFoundError(`Event with ID "${eventId}" not found`);
  }

  await runWithTenant(ctx.organizationId!, () =>
    tenantDb.calendarEvent.delete({
      where: { id: eventId, organizationId: ctx.organizationId! },
    }),
  );

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

  // Get non-recurring upcoming events (filter rrule presence in code since Json columns can't be null-filtered easily)
  const allUpcomingEvents = await runWithTenant(targetOrgId, () =>
    tenantDb.calendarEvent.findMany({
      where: {
        organizationId: targetOrgId,
        startDate: { gte: today },
      },
      orderBy: { startDate: 'asc' },
    }),
  );

  const singleEvents = allUpcomingEvents.filter((e) => getRruleJson(e) === null).slice(0, limit);

  // Get recurring events and expand for upcoming window (next 30 days)
  const recurringEvents = await runWithTenant(targetOrgId, () =>
    tenantDb.calendarEvent.findMany({
      where: {
        organizationId: targetOrgId,
        startDate: { lte: upcomingWindowEnd },
      },
    }),
  );

  const recurringInstances: CalendarEventWithDetails[] = [];

  for (const event of recurringEvents) {
    const rruleJson = getRruleJson(event);
    const exdates = getExdates(event);

    if (rruleJson) {
      const expanded = expandRecurrenceWithRrule(
        { ...event } as CalendarEventWithDetails,
        today,
        upcomingWindowEnd,
        rruleJson,
        exdates.length > 0 ? exdates : undefined,
      );
      recurringInstances.push(...(expanded as CalendarEventWithDetails[]));
    }
  }

  // Combine and sort, then limit
  const allEvents = [...singleEvents.map(mapEventToDetails), ...recurringInstances];
  allEvents.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

  return allEvents.slice(0, limit);
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

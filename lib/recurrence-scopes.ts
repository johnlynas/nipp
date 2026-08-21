/**
 * Recurrence edit scope handlers.
 *
 * Implements Google Calendar-style "this / this & following / all" edit scopes
 * for recurring events. Each handler modifies the base event's rrule and/or creates
 * detached override events as needed.
 *
 * These functions operate directly on the Prisma database and are called from the
 * PATCH endpoint when an `editScope` field is present in the request body.
 */

import globalDb from '@/lib/global-db';
import { ServiceContext } from '@/lib/services/types';
import { RruleJson } from './recurrence-rrule';
import type { CalendarEventType } from '@/components/calendar/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditScope = 'this' | 'following' | 'all';

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  startDate?: Date;
  endDate?: Date;
  eventType?: CalendarEventType;
  color?: string | null;
  propertyId?: string | null;
  recurrence?: RruleJson | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date as YYYY-MM-DD (local). */
function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Get the rrule JSON from an event (handles both legacy and new formats). */
async function getEventRrule(ctx: ServiceContext, eventId: string): Promise<RruleJson | null> {
  const event = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
  });

  if (!event) throw new Error(`Event with ID "${eventId}" not found`);
  if (!event.rrule) return null;

  // Prisma returns Json as unknown — cast to RruleJson
  return event.rrule as unknown as RruleJson;
}

/** Update the rrule JSON on an event. */
async function updateEventRrule(ctx: ServiceContext, eventId: string, rruleJson: RruleJson): Promise<void> {
  await globalDb.calendarEvent.update({
    where: { id: eventId, organizationId: ctx.organizationId! },
    data: { rrule: rruleJson as unknown as string },
  });
}

/** Add a date to the exdates array on an event. */
async function addExdate(ctx: ServiceContext, eventId: string, dateStr: string): Promise<void> {
  const event = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
  });

  if (!event) throw new Error(`Event with ID "${eventId}" not found`);

  const currentExdates = ((event.exdates as string[]) ?? []) as string[];
  if (currentExdates.includes(dateStr)) return; // Already excluded

  await globalDb.calendarEvent.update({
    where: { id: eventId, organizationId: ctx.organizationId! },
    data: { exdates: [...currentExdates, dateStr] as unknown as string },
  });
}

/** Create a detached override event (a single instance that differs from the base series). */
async function createOverrideEvent(
  ctx: ServiceContext,
  baseEventId: string,
  overrides: {
    startDate: Date;
    endDate: Date;
    title?: string;
    description?: string | null;
    eventType?: string;
    color?: string | null;
    propertyId?: string | null;
  },
): Promise<string> {
  const baseEvent = await globalDb.calendarEvent.findFirst({
    where: { id: baseEventId, organizationId: ctx.organizationId! },
  });

  if (!baseEvent) throw new Error(`Base event with ID "${baseEventId}" not found`);

  const override = await globalDb.calendarEvent.create({
    data: {
      title: overrides.title ?? baseEvent.title,
      description: overrides.description !== undefined ? overrides.description : baseEvent.description,
      startDate: overrides.startDate,
      endDate: overrides.endDate,
      eventType: (overrides.eventType ?? baseEvent.eventType) as unknown as string,
      color: overrides.color ?? baseEvent.color,
      propertyId: overrides.propertyId ?? baseEvent.propertyId,
      calendarId: baseEvent.calendarId,
      organizationId: ctx.organizationId!,
    } as unknown as Parameters<typeof globalDb.calendarEvent.create>[0]['data'],
  });

  return override.id;
}

// ---------------------------------------------------------------------------
// Scope Handlers
// ---------------------------------------------------------------------------

/**
 * "this" scope — EXDATE the clicked instance + create a detached override.
 *
 * The base series remains unchanged except that the clicked date is excluded from
 * future expansions. A new event is created with the updated details, linked to the
 * base series (expanded instances share the same event id as the base).
 */
export async function applyEditScopeThis(
  ctx: ServiceContext,
  eventId: string,
  clickedDate: Date,
  updates: UpdateEventInput,
): Promise<{ overrideId: string }> {
  const rruleJson = await getEventRrule(ctx, eventId);
  if (!rruleJson) {
    // Not a recurring event — just update in place
    await globalDb.calendarEvent.update({
      where: { id: eventId, organizationId: ctx.organizationId! },
      data: {
        ...(updates.title !== undefined && { title: updates.title }),
        ...(updates.description !== undefined && { description: updates.description }),
        ...(updates.startDate !== undefined && { startDate: updates.startDate }),
        ...(updates.endDate !== undefined && { endDate: updates.endDate }),
        ...(updates.eventType !== undefined && { eventType: updates.eventType as unknown as string }),
        ...(updates.color !== undefined && { color: updates.color }),
        ...(updates.propertyId !== undefined && { propertyId: updates.propertyId }),
      } as unknown as Parameters<typeof globalDb.calendarEvent.update>[0]['data'],
    });
    return { overrideId: eventId };
  }

  const clickedDateStr = formatDateInput(clickedDate);

  // Add the clicked date to exdates on the base event
  await addExdate(ctx, eventId, clickedDateStr);

  // Calculate override duration from updates or base event
  const baseEvent = await globalDb.calendarEvent.findFirst({
    where: { id: eventId, organizationId: ctx.organizationId! },
  });

  let baseDurationMs = 3600000; // default 1 hour
  if (baseEvent) {
    const baseStart = new Date(baseEvent.startDate);
    const baseEnd = updates.endDate ?? new Date(baseEvent.endDate);
    const start = updates.startDate ?? baseStart;
    baseDurationMs = baseEnd.getTime() - start.getTime();
  }

  const overrideStartDate = updates.startDate ?? clickedDate;
  const overrideEndDate = updates.endDate ?? new Date(overrideStartDate.getTime() + baseDurationMs);

  // Create override with updated details
  const overrideId = await createOverrideEvent(ctx, eventId, {
    startDate: overrideStartDate,
    endDate: overrideEndDate,
    title: updates.title ?? baseEvent?.title,
    description: updates.description !== undefined ? updates.description : baseEvent?.description,
    eventType: (updates.eventType ?? baseEvent?.eventType) as string,
    color: updates.color ?? baseEvent?.color,
    propertyId: updates.propertyId ?? baseEvent?.propertyId,
  });

  return { overrideId };
}

/**
 * "following" scope — UNTIL-terminate the base series + create a new series from clicked date.
 *
 * The base event's rrule UNTIL is set to the day before the clicked date. A new
 * series event is created starting from the clicked date with the full recurrence rule
 * and the requested updates applied.
 */
export async function applyEditScopeFollowing(
  ctx: ServiceContext,
  eventId: string,
  clickedDate: Date,
  updates: UpdateEventInput,
): Promise<{ baseId: string; newSeriesId: string }> {
  const rruleJson = await getEventRrule(ctx, eventId);
  if (!rruleJson) {
    // Not recurring — just update in place
    await globalDb.calendarEvent.update({
      where: { id: eventId, organizationId: ctx.organizationId! },
      data: updates as unknown as Parameters<typeof globalDb.calendarEvent.update>[0]['data'],
    });
    return { baseId: eventId, newSeriesId: eventId };
  }

  // Set UNTIL on base to the day before clicked date
  const untilDate = new Date(clickedDate);
  untilDate.setDate(untilDate.getDate() - 1);
  untilDate.setHours(23, 59, 59, 999);

  const updatedBaseRrule = {
    ...rruleJson,
    until: untilDate,
  };

  await updateEventRrule(ctx, eventId, updatedBaseRrule);

  // Create new series starting from clicked date
  const durationMs = (updates.endDate ? updates.endDate.getTime() : 0) - (updates.startDate ? updates.startDate.getTime() : 0);
  const newSeriesStartDate = updates.startDate ?? clickedDate;

  const newRrule: RruleJson = {
    ...rruleJson,
    dtstart: newSeriesStartDate,
    until: rruleJson.count !== null ? null : rruleJson.until, // Reset UNTIL for new series (keep count if set)
  };

  const baseEvent = await globalDb.calendarEvent.findFirst({ where: { id: eventId, organizationId: ctx.organizationId! } });
  const newSeries = await globalDb.calendarEvent.create({
    data: {
      title: (updates.title ?? baseEvent?.title) || '',
      description: updates.description,
      startDate: newSeriesStartDate,
      endDate: new Date(newSeriesStartDate.getTime() + (durationMs || 3600000)),
      eventType: updates.eventType as unknown as string | undefined,
      color: updates.color,
      propertyId: updates.propertyId,
      calendarId: baseEvent?.calendarId || '',
      rrule: newRrule as unknown as string,
      organizationId: ctx.organizationId!,
    } as unknown as Parameters<typeof globalDb.calendarEvent.create>[0]['data'],
  });

  return { baseId: eventId, newSeriesId: newSeries.id };
}

/**
 * "all" scope — Reset base recurrence (remove UNTIL), clear all EXDATEs, apply updates.
 *
 * The base event's rrule UNTIL is cleared (no end). All exdates are removed. Updates
 * are applied directly to the base event.
 */
export async function applyEditScopeAll(
  ctx: ServiceContext,
  eventId: string,
  updates: UpdateEventInput,
): Promise<{ baseId: string }> {
  const rruleJson = await getEventRrule(ctx, eventId);

  if (!rruleJson) {
    // Not recurring — just update in place
    await globalDb.calendarEvent.update({
      where: { id: eventId, organizationId: ctx.organizationId! },
      data: updates as unknown as Parameters<typeof globalDb.calendarEvent.update>[0]['data'],
    });
    return { baseId: eventId };
  }

  // Reset rrule: clear UNTIL (no end), keep count if set
  const resetRrule: RruleJson = {
    ...rruleJson,
    until: null,
  };

  await updateEventRrule(ctx, eventId, resetRrule);

  // Clear all exdates
  await globalDb.calendarEvent.update({
    where: { id: eventId, organizationId: ctx.organizationId! },
    data: { exdates: [] as unknown as string },
  });

  // Apply updates to base event
  await globalDb.calendarEvent.update({
    where: { id: eventId, organizationId: ctx.organizationId! },
    data: {
      ...(updates.title !== undefined && { title: updates.title }),
      ...(updates.description !== undefined && { description: updates.description }),
      ...(updates.startDate !== undefined && { startDate: updates.startDate }),
      ...(updates.endDate !== undefined && { endDate: updates.endDate }),
      ...(updates.eventType !== undefined && { eventType: updates.eventType as unknown as string }),
      ...(updates.color !== undefined && { color: updates.color }),
      ...(updates.propertyId !== undefined && { propertyId: updates.propertyId }),
    } as unknown as Parameters<typeof globalDb.calendarEvent.update>[0]['data'],
  });

  return { baseId: eventId };
}

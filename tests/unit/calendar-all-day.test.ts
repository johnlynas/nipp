/**
 * Unit tests for first-class "All day" calendar events.
 *
 * Covers: lib/all-day.ts helpers (normalisation + detection), service create/
 * update normalisation and flag persistence, the SSE due-to-start scanner's
 * all-day exclusion, today-events notification display, and rrule expansion
 * of recurring all-day series (duration preserved per instance).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { normalizeAllDayDates, isAllDayEvent } from '@/lib/all-day';
import { CalendarEventService } from '@/services/calendar-event-service';
import { buildTodayEventsMessage } from '@/services/calendar-notification-service';
import { findDueToStartEvents, stopCalendarEventScheduler } from '@/lib/calendar-event-scheduler';
import { expandRecurrenceWithRrule } from '@/lib/recurrence-rrule';
import { generateYearMonths } from '@/components/calendar/calendar-utils';
import { ServiceContext, ValidationError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks (same shape as the existing calendar service/scheduler unit tests)
// ---------------------------------------------------------------------------

vi.mock('@/lib/tenant-db', () => ({
  default: {
    calendar: { findFirst: vi.fn() },
    calendarEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

vi.mock('@/lib/notification-push', () => ({ pushNotification: vi.fn().mockResolvedValue(undefined) }));

// withEnvPlatformContext would otherwise open a REAL Prisma interactive tx.
vi.mock('@/lib/rls-transaction', () => ({
  withEnvPlatformContext: (op: () => unknown) => op(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCtx = (role: 'TENANT_ADMIN' | 'MEMBER' = 'TENANT_ADMIN', orgId = 'org-1'): ServiceContext => ({
  userId: 'user-1', role, organizationId: orgId,
});

const makeDbEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1', title: 'Test Event', description: null,
  startDate: new Date('2026-08-17T10:00:00'), endDate: new Date('2026-08-17T11:00:00'),
  allDay: false,
  eventType: 'OTHER', color: null, calendarId: 'cal-1',
  propertyId: null, organizationId: 'org-1', rrule: null, exdates: [],
  createdAt: new Date('2026-01-01T00:00:00'), updatedAt: new Date('2026-01-01T00:00:00'),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  // The scheduler module starts its scan interval on import — stop it so the
  // test process stays quiet (mirrors calendar-event-scheduler.test.ts).
  stopCalendarEventScheduler();
});

// ---------------------------------------------------------------------------
// lib/all-day.ts — normalisation + detection
// ---------------------------------------------------------------------------

describe('normalizeAllDayDates', () => {
  it('clamps all-day dates to day boundaries (midnight → 23:59:59.999)', () => {
    const result = normalizeAllDayDates(
      new Date(2026, 10, 5, 9, 30),
      new Date(2026, 10, 7, 14, 0),
      true,
    );
    expect(result.startDate).toEqual(new Date(2026, 10, 5, 0, 0, 0, 0));
    expect(result.endDate).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
  });

  it('preserves multi-day spans (both days clamped independently)', () => {
    const result = normalizeAllDayDates(
      new Date(2026, 10, 5, 0, 0, 0, 0),
      new Date(2026, 10, 7, 0, 0, 0, 0),
      true,
    );
    expect(result.startDate).toEqual(new Date(2026, 10, 5, 0, 0, 0, 0));
    expect(result.endDate).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
  });

  it('passes timed events through untouched', () => {
    const start = new Date(2026, 10, 5, 9, 30);
    const end = new Date(2026, 10, 7, 14, 0);
    const result = normalizeAllDayDates(start, end, false);
    expect(result.startDate).toBe(start);
    expect(result.endDate).toBe(end);
  });
});

describe('isAllDayEvent', () => {
  it('returns true for the explicit flag', () => {
    expect(isAllDayEvent({
      allDay: true,
      startDate: new Date(2026, 10, 5, 9, 0),
      endDate: new Date(2026, 10, 5, 17, 0),
    })).toBe(true);
  });

  it('returns true for legacy midnight→23:59:59.999 same-day rows without the flag', () => {
    expect(isAllDayEvent({
      allDay: false,
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
      endDate: new Date(2026, 10, 5, 23, 59, 59, 999),
    })).toBe(true);
  });

  it('returns false for timed events', () => {
    expect(isAllDayEvent({
      allDay: false,
      startDate: new Date(2026, 10, 5, 9, 0),
      endDate: new Date(2026, 10, 5, 17, 0),
    })).toBe(false);
  });

  it('returns false for multi-day midnight→23:59 spans (not a legacy all-day row)', () => {
    expect(isAllDayEvent({
      allDay: false,
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
      endDate: new Date(2026, 10, 7, 23, 59, 59, 999),
    })).toBe(false);
  });

  it('returns false for invalid dates', () => {
    expect(isAllDayEvent({
      allDay: false,
      startDate: new Date('not a date'),
      endDate: new Date(2026, 10, 5, 23, 59, 59, 999),
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service — createEvent / updateEvent normalisation + flag persistence
// ---------------------------------------------------------------------------

describe('createEvent (all-day)', () => {
  it('stores all-day events at day boundaries with allDay=true', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent({
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
      endDate: new Date(2026, 10, 7, 23, 59, 59, 999),
      allDay: true,
    }) as never);

    const result = await CalendarEventService.createEvent(mockCtx(), {
      title: 'Site handover',
      startDate: new Date(2026, 10, 5, 9, 30), // arbitrary times — must be clamped
      endDate: new Date(2026, 10, 7, 14, 0),
      allDay: true,
      calendarId: 'cal-1',
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    expect(createCall.data.startDate).toEqual(new Date(2026, 10, 5, 0, 0, 0, 0));
    expect(createCall.data.endDate).toEqual(new Date(2026, 10, 7, 23, 59, 59, 999));
    expect(createCall.data.allDay).toBe(true);
    expect(result.allDay).toBe(true);
  });

  it('stores timed events with allDay=false and untouched dates', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx(), {
      title: 'Viewing',
      startDate: new Date(2026, 10, 5, 9, 30),
      endDate: new Date(2026, 10, 5, 10, 30),
      calendarId: 'cal-1',
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    expect(createCall.data.startDate).toEqual(new Date(2026, 10, 5, 9, 30));
    expect(createCall.data.endDate).toEqual(new Date(2026, 10, 5, 10, 30));
    expect(createCall.data.allDay).toBe(false);
  });

  it('uses the normalised midnight start as rrule dtstart for recurring all-day series', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx(), {
      title: 'Weekly Monday all-day',
      startDate: new Date(2026, 10, 5, 9, 30),
      endDate: new Date(2026, 10, 5, 17, 0),
      allDay: true,
      calendarId: 'cal-1',
      recurrence: { frequency: 'WEEKLY' },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(new Date(rrule.dtstart)).toEqual(new Date(2026, 10, 5, 0, 0, 0, 0));
  });

  it('still rejects end-before-start for all-day events', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);

    await expect(
      CalendarEventService.createEvent(mockCtx(), {
        title: 'Bad span',
        startDate: new Date(2026, 10, 7),
        endDate: new Date(2026, 10, 5),
        allDay: true,
        calendarId: 'cal-1',
      })
    ).rejects.toThrow(ValidationError);
  });
});

describe('updateEvent (all-day)', () => {
  it('normalises dates to day boundaries when toggling timed → all-day', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
      endDate: new Date(2026, 10, 5, 23, 59, 59, 999),
      allDay: true,
    }) as never);

    const result = await CalendarEventService.updateEvent(mockCtx(), 'event-1', {
      startDate: new Date(2026, 10, 5, 9, 30),
      endDate: new Date(2026, 10, 5, 17, 0),
      allDay: true,
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.startDate).toEqual(new Date(2026, 10, 5, 0, 0, 0, 0));
    expect(updateCall.data.endDate).toEqual(new Date(2026, 10, 5, 23, 59, 59, 999));
    expect(updateCall.data.allDay).toBe(true);
    expect(result.allDay).toBe(true);
  });

  it('re-normalises to timed boundaries when toggling all-day → timed', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent({
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
      endDate: new Date(2026, 10, 5, 23, 59, 59, 999),
      allDay: true,
    }) as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.updateEvent(mockCtx(), 'event-1', {
      startDate: new Date(2026, 10, 5, 9, 0),
      endDate: new Date(2026, 10, 5, 17, 0),
      allDay: false,
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.startDate).toEqual(new Date(2026, 10, 5, 9, 0));
    expect(updateCall.data.endDate).toEqual(new Date(2026, 10, 5, 17, 0));
    expect(updateCall.data.allDay).toBe(false);
  });

  it('clamps an all-day event to day boundaries even when only the flag is sent', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ allDay: true }) as never);

    await CalendarEventService.updateEvent(mockCtx(), 'event-1', { allDay: true });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.startDate).toEqual(new Date(2026, 7, 17, 0, 0, 0, 0));
    expect(updateCall.data.endDate).toEqual(new Date(2026, 7, 17, 23, 59, 59, 999));
    expect(updateCall.data.allDay).toBe(true);
  });

  it('leaves timed dates untouched when allDay is not sent', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.updateEvent(mockCtx(), 'event-1', { title: 'Renamed' });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.startDate).toEqual(new Date(2026, 7, 17, 10, 0));
    expect(updateCall.data.endDate).toEqual(new Date(2026, 7, 17, 11, 0));
    expect(updateCall.data.allDay).toBeUndefined();
  });

  it('carries allDay through mapEventToDetails on read', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent({ allDay: true }) as never);

    const result = await CalendarEventService.getEventById(mockCtx(), 'event-1');
    expect(result.allDay).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SSE scheduler — all-day events are excluded from due-to-start discovery
// ---------------------------------------------------------------------------

describe('findDueToStartEvents (all-day exclusion)', () => {
  it('queries the DB with an allDay: false filter', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    await findDueToStartEvents(new Date('2026-09-08T10:30:00'));

    const where = (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    expect(where.allDay).toBe(false);
  });

  it('skips all-day rows even if they leak past the DB filter (defensive)', async () => {
    const now = new Date('2026-09-08T10:30:00');
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent({ allDay: true, startDate: new Date('2026-09-08T10:45:00') })])
      .mockResolvedValueOnce([]);

    const result = await findDueToStartEvents(now);
    expect(result).toHaveLength(0);
  });

  it('skips recurring all-day series (no start time to alert on)', async () => {
    const now = new Date('2026-09-08T10:30:00');
    const base = new Date(now.getTime() + 5 * 60 * 1000);
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeDbEvent({
        id: 'series-allday',
        allDay: true,
        startDate: base,
        endDate: new Date(base.getTime() + 60 * 60 * 1000),
        rrule: JSON.stringify({ freq: 'DAILY', interval: 1, dtstart: base.toISOString(), until: null, count: null }),
      })]);

    const result = await findDueToStartEvents(now);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Today-events notifications — "All day" display
// ---------------------------------------------------------------------------

describe('buildTodayEventsMessage (all-day display)', () => {
  const baseEvent = {
    id: 'event-1',
    title: 'Site handover',
    description: null,
    startDate: new Date(2026, 10, 5, 0, 0, 0, 0),
    endDate: new Date(2026, 10, 5, 23, 59, 59, 999),
    eventType: 'OTHER' as const,
    color: null,
  };

  it('renders "All day" in the HTML email for all-day events', () => {
    const { html } = buildTodayEventsMessage([{ ...baseEvent, allDay: true }], 'Test');
    expect(html).toContain('All day');
    expect(html).not.toMatch(/00:00/);
  });

  it('renders "All day" in the plain-text message for all-day events', () => {
    const { text } = buildTodayEventsMessage([{ ...baseEvent, allDay: true }], 'Test');
    expect(text).toContain('All day');
  });

  it('keeps HH:mm – HH:mm for timed events', () => {
    const { text } = buildTodayEventsMessage([{
      ...baseEvent,
      allDay: false,
      startDate: new Date(2026, 10, 5, 9, 30),
      endDate: new Date(2026, 10, 5, 17, 0),
    }], 'Test');
    expect(text).toContain('09:30');
    expect(text).not.toContain('All day');
  });
});

// ---------------------------------------------------------------------------
// rrule expansion — recurring all-day series preserve their span per instance
// ---------------------------------------------------------------------------

describe('expandRecurrenceWithRrule (all-day series)', () => {
  it('expands a weekly all-day event into full-day spans and carries the flag', () => {
    const base = makeDbEvent({
      id: 'series-allday',
      allDay: true,
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0), // Mon midnight
      endDate: new Date(2026, 10, 7, 23, 59, 59, 999), // Wed end (3-day span)
    });

    const rruleJson = {
      freq: 'WEEKLY' as const,
      interval: 1,
      dtstart: new Date(2026, 10, 5, 0, 0, 0, 0),
      until: null,
      count: 3,
    };

    const instances = expandRecurrenceWithRrule(base, new Date(2026, 9, 1), new Date(2026, 12, 31), rruleJson);

    expect(instances).toHaveLength(3);
    for (const instance of instances) {
      // Every occurrence keeps the 3-day midnight→23:59:59.999 shape.
      expect(instance.startDate.getHours()).toBe(0);
      expect(instance.endDate.getHours()).toBe(23);
      expect(instance.endDate.getMinutes()).toBe(59);
      expect(instance.allDay).toBe(true);
      const spanDays = Math.round(
        (Date.UTC(instance.endDate.getFullYear(), instance.endDate.getMonth(), instance.endDate.getDate()) -
          Date.UTC(instance.startDate.getFullYear(), instance.startDate.getMonth(), instance.startDate.getDate())) / 86400000,
      ) + 1;
      expect(spanDays).toBe(3);
    }
    // Occurrences land on successive Mondays.
    expect(instances[0].startDate.toDateString()).toBe(new Date(2026, 10, 5).toDateString());
    expect(instances[1].startDate.toDateString()).toBe(new Date(2026, 10, 12).toDateString());
    expect(instances[2].startDate.toDateString()).toBe(new Date(2026, 10, 19).toDateString());
  });
});

// ---------------------------------------------------------------------------
// Year view — multi-day all-day events register on every day they span
// ---------------------------------------------------------------------------

describe('generateYearMonths (all-day spans)', () => {
  it('counts a multi-day all-day event on each spanned day', () => {
    const summaries = generateYearMonths(2026, [{
      id: 'allday-span',
      title: 'Site handover',
      description: null,
      startDate: new Date(2026, 10, 5, 0, 0, 0, 0),   // Nov 5
      endDate: new Date(2026, 10, 7, 23, 59, 59, 999), // Nov 7 (3 days)
      allDay: true,
      eventType: 'OTHER',
      color: null,
      calendarId: 'cal-1',
      propertyId: null,
      createdAt: new Date('2026-01-01T00:00:00'),
      updatedAt: new Date('2026-01-01T00:00:00'),
    }]);

    const nov = summaries[10]; // November (0-based)
    expect(nov.eventsByDay.get(5)?.map((e) => e.id)).toContain('allday-span');
    expect(nov.eventsByDay.get(6)?.map((e) => e.id)).toContain('allday-span');
    expect(nov.eventsByDay.get(7)?.map((e) => e.id)).toContain('allday-span');
    // Not on the day after the span ends.
    expect(nov.eventsByDay.get(8)).toBeUndefined();
    expect(nov.totalEvents).toBe(1);
  });
});

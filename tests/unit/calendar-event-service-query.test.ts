/**
 * Unit tests for CalendarEventService query methods: getEvents, getEventsWithRecurrences, getEventById.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, NotFoundError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/global-db', () => ({
  default: {
    calendarEvent: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn() } }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCtx = (role: 'TENANT_ADMIN' | 'MEMBER', orgId = 'org-1'): ServiceContext => ({
  userId: 'user-1', role, organizationId: orgId,
});

const makeDbEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1', title: 'Test Event', description: null,
  startDate: new Date('2026-08-17T10:00:00'), endDate: new Date('2026-08-17T11:00:00'),
  eventType: 'OTHER', color: null, calendarId: 'cal-1',
  propertyId: null, organizationId: 'org-1', rrule: null, exdates: [],
  createdAt: new Date('2026-01-01T00:00:00'), updatedAt: new Date('2026-01-01T00:00:00'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns events mapped to the detail shape', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([makeDbEvent()] as never);

    const result = await CalendarEventService.getEvents(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('event-1');

    const call = (globalDb.calendarEvent.findMany as any).mock.calls[0][0];
    expect(call.where.organizationId).toBe('org-1');
  });

  it('passes the calendarId filter through', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getEvents(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
      calendarId: 'cal-2',
    });

    const call = (globalDb.calendarEvent.findMany as any).mock.calls[0][0];
    expect(call.where.calendarId).toBe('cal-2');
  });
});

describe('getEventsWithRecurrences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('queries with startDate filter and post-fetch rrule separation', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
    });

    const call = (globalDb.calendarEvent.findMany as any).mock.calls[0][0];
    expect(call.where.startDate).toEqual({ lte: new Date('2026-08-31T23:59:59') });
    expect(call.where.OR).toBeUndefined(); // rrule filtering moved to post-fetch code
  });

  it('returns non-recurring events with recurrence: null', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([makeDbEvent()] as never);

    const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].recurrence).toBeNull();
  });

  it('expands recurring events into instances with shifted dates and rule details', async () => {
    const recurringEvent = makeDbEvent({
      id: 'series-1',
      startDate: new Date('2026-05-18T10:00:00'),
      endDate: new Date('2026-05-18T11:30:00'),
      rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1, dtstart: new Date('2026-05-18T10:00:00').toISOString(), until: null, count: null }),
      exdates: [],
    });

    (globalDb.calendarEvent.findMany as any).mockResolvedValue([recurringEvent] as never);

    const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-17T00:00:00'), endDate: new Date('2026-08-23T23:59:59'),
    });

    expect(result).toHaveLength(1);
    expect(result[0].startDate.toISOString()).toBe('2026-08-17T10:00:00.000Z');
    expect(result[0].endDate.toISOString()).toBe('2026-08-17T11:30:00.000Z');
    expect(result[0].recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
  });

  it('sorts instances by start date', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([
      makeDbEvent({ id: 'b', startDate: new Date('2026-08-20T10:00:00'), endDate: new Date('2026-08-20T11:00:00') }),
      makeDbEvent({ id: 'a', startDate: new Date('2026-08-18T10:00:00'), endDate: new Date('2026-08-18T11:00:00') }),
    ] as never);

    const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
    });

    expect(result.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('handles exdates filtering during expansion', async () => {
    const recurringEvent = makeDbEvent({
      id: 'series-1',
      startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'),
      rrule: JSON.stringify({ freq: 'DAILY', interval: 1, dtstart: new Date('2026-08-17T10:00:00').toISOString(), until: null, count: 5 }),
      exdates: ['2026-08-18', '2026-08-19'],
    });

    (globalDb.calendarEvent.findMany as any).mockResolvedValue([recurringEvent] as never);

    const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-17T00:00:00'), endDate: new Date('2026-08-25T23:59:59'),
    });

    // 5 occurrences minus 2 excluded = 3 instances
    expect(result).toHaveLength(3);
    const dates = result.map((i) => i.startDate.toISOString().slice(0, 10));
    expect(dates).not.toContain('2026-08-18');
    expect(dates).not.toContain('2026-08-19');
  });

  it('passes the calendarId filter through', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
      startDate: new Date('2026-08-01T00:00:00'), endDate: new Date('2026-08-31T23:59:59'),
      calendarId: 'cal-2',
    });

    const call = (globalDb.calendarEvent.findMany as any).mock.calls[0][0];
    expect(call.where.calendarId).toBe('cal-2');
  });
});

describe('getEventById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundError for a missing event', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(null);

    await expect(CalendarEventService.getEventById(mockCtx('MEMBER'), 'missing')).rejects.toThrow(NotFoundError);
  });

  it('includes recurrence details when rrule JSON is present', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1, dtstart: new Date('2026-08-17T10:00:00').toISOString(), until: null, count: null }) } as never)
    );

    const result = await CalendarEventService.getEventById(mockCtx('MEMBER'), 'event-1');

    expect(result.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
  });

  it('returns recurrence: null when rrule is absent', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);

    const result = await CalendarEventService.getEventById(mockCtx('MEMBER'), 'event-1');

    expect(result.recurrence).toBeNull();
  });
});

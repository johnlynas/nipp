/**
 * Unit tests for CalendarEventService — CRUD, recurrence expansion, and upcoming events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { CalendarEventService, expandRecurrence } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// Mock dependencies
vi.mock('@/lib/global-db', () => ({
  default: {
    calendar: {
      findFirst: vi.fn(),
    },
    calendarEvent: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    calendarRecurrence: {
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId = 'org-1'): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const makeEvent = (overrides: Partial<CalendarEventWithDetails> = {}): CalendarEventWithDetails => ({
  id: 'event-1',
  title: 'Test Event',
  description: null,
  startDate: new Date('2026-08-17T10:00:00'),
  endDate: new Date('2026-08-17T11:00:00'),
  eventType: 'OTHER',
  color: null,
  calendarId: 'cal-1',
  recurrenceId: null,
  recurrence: null,
  propertyId: null,
  createdAt: new Date('2026-01-01T00:00:00'),
  updatedAt: new Date('2026-01-01T00:00:00'),
  ...overrides,
});

const makeDbEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  title: 'Test Event',
  description: null,
  startDate: new Date('2026-08-17T10:00:00'),
  endDate: new Date('2026-08-17T11:00:00'),
  eventType: 'OTHER',
  color: null,
  calendarId: 'cal-1',
  recurrenceId: null,
  propertyId: null,
  organizationId: 'org-1',
  createdAt: new Date('2026-01-01T00:00:00'),
  updatedAt: new Date('2026-01-01T00:00:00'),
  ...overrides,
});

const makeRecurrenceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  frequency: 'WEEKLY',
  interval: 1,
  endDate: null,
  count: null,
  byDay: null,
  byMonthDay: null,
  eventId: 'event-1',
  organizationId: 'org-1',
  ...overrides,
});

describe('CalendarEventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // expandRecurrence (pure function)
  // -------------------------------------------------------------------------

  describe('expandRecurrence', () => {
    it('returns the event itself when non-recurring and overlapping the range', () => {
      const event = makeEvent();
      const instances = expandRecurrence(event, new Date('2026-08-01T00:00:00'), new Date('2026-08-31T23:59:59'));

      expect(instances).toHaveLength(1);
      expect(instances[0].id).toBe('event-1');
    });

    it('returns nothing for a non-recurring event outside the range', () => {
      const event = makeEvent();
      const instances = expandRecurrence(event, new Date('2026-09-01T00:00:00'), new Date('2026-09-30T23:59:59'));

      expect(instances).toHaveLength(0);
    });

    it('expands a daily series with the base duration preserved on every instance', () => {
      const event = makeEvent({
        startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:30:00'),
        recurrence: { frequency: 'DAILY', interval: 1, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-08-19T23:59:59'));

      expect(instances).toHaveLength(3);
      for (const instance of instances) {
        const duration = instance.endDate.getTime() - instance.startDate.getTime();
        expect(duration).toBe(90 * 60 * 1000); // 90 minutes on every occurrence
      }
      expect(instances[1].startDate.toISOString()).toBe('2026-08-18T10:00:00.000Z');
      expect(instances[2].startDate.toISOString()).toBe('2026-08-19T10:00:00.000Z');
    });

    it('expands a daily series with interval 2 (every other day)', () => {
      const event = makeEvent({
        recurrence: { frequency: 'DAILY', interval: 2, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-08-24T23:59:59'));

      expect(instances.map((i) => i.startDate.toISOString())).toEqual([
        '2026-08-17T10:00:00.000Z',
        '2026-08-19T10:00:00.000Z',
        '2026-08-21T10:00:00.000Z',
        '2026-08-23T10:00:00.000Z',
      ]);
    });

    it('expands a weekly series into occurrences months after the base date', () => {
      // Regression: later occurrences must appear even when the base event's
      // own date range does not overlap the queried range.
      const event = makeEvent({
        startDate: new Date('2026-05-18T10:00:00'),
        endDate: new Date('2026-05-18T11:00:00'),
        recurrence: { frequency: 'WEEKLY', interval: 1, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-08-23T23:59:59'));

      expect(instances).toHaveLength(1);
      expect(instances[0].startDate.toISOString()).toBe('2026-08-17T10:00:00.000Z');
      expect(instances[0].endDate.toISOString()).toBe('2026-08-17T11:00:00.000Z');
    });

    it('expands a weekly series with interval 2 (every two weeks)', () => {
      const event = makeEvent({
        recurrence: { frequency: 'WEEKLY', interval: 2, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-09-14T23:59:59'));

      expect(instances.map((i) => i.startDate.toISOString())).toEqual([
        '2026-08-17T10:00:00.000Z',
        '2026-08-31T10:00:00.000Z',
        '2026-09-14T10:00:00.000Z',
      ]);
    });

    it('expands a monthly series across month boundaries (day overflow clamps)', () => {
      // Jan 31 + 1 month -> Feb 28 (non-leap year)
      const event = makeEvent({
        startDate: new Date('2027-01-31T09:00:00'),
        endDate: new Date('2027-01-31T10:00:00'),
        recurrence: { frequency: 'MONTHLY', interval: 1, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2027-01-01T00:00:00'), new Date('2027-04-30T23:59:59'));

      expect(instances.map((i) => i.startDate.toISOString())).toEqual([
        '2027-01-31T09:00:00.000Z',
        '2027-03-03T09:00:00.000Z', // Jan 31 + 1mo overflows Feb (28 days) -> Mar 3
        '2027-04-03T09:00:00.000Z',
      ]);
    });

    it('expands quarterly, semi-annually and annually series', () => {
      const base = makeEvent({
        startDate: new Date('2026-01-15T10:00:00'),
        endDate: new Date('2026-01-15T11:00:00'),
      });

      const quarterly = expandRecurrence(
        { ...base, recurrence: { frequency: 'QUARTERLY', interval: 1, endDate: null, count: undefined } } as never,
        new Date('2026-01-01T00:00:00'),
        new Date('2027-12-31T23:59:59'),
      );
      expect(quarterly.map((i) => i.startDate.toISOString())).toEqual([
        '2026-01-15T10:00:00.000Z',
        '2026-04-15T10:00:00.000Z',
        '2026-07-15T10:00:00.000Z',
        '2026-10-15T10:00:00.000Z',
        '2027-01-15T10:00:00.000Z',
        '2027-04-15T10:00:00.000Z',
        '2027-07-15T10:00:00.000Z',
        '2027-10-15T10:00:00.000Z',
      ]);

      const semiAnnual = expandRecurrence(
        { ...base, recurrence: { frequency: 'SEMI_ANNUALLY', interval: 1, endDate: null, count: undefined } } as never,
        new Date('2026-01-01T00:00:00'),
        new Date('2027-12-31T23:59:59'),
      );
      expect(semiAnnual.map((i) => i.startDate.toISOString())).toEqual([
        '2026-01-15T10:00:00.000Z',
        '2026-07-15T10:00:00.000Z',
        '2027-01-15T10:00:00.000Z',
        '2027-07-15T10:00:00.000Z',
      ]);

      const annual = expandRecurrence(
        { ...base, recurrence: { frequency: 'ANNUALLY', interval: 1, endDate: null, count: undefined } } as never,
        new Date('2026-01-01T00:00:00'),
        new Date('2029-12-31T23:59:59'),
      );
      expect(annual.map((i) => i.startDate.toISOString())).toEqual([
        '2026-01-15T10:00:00.000Z',
        '2027-01-15T10:00:00.000Z',
        '2028-01-15T10:00:00.000Z',
        '2029-01-15T10:00:00.000Z',
      ]);
    });

    it('stops after the configured occurrence count (count includes the first)', () => {
      const event = makeEvent({
        recurrence: { frequency: 'DAILY', interval: 1, endDate: null, count: 3 },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-09-30T23:59:59'));

      expect(instances).toHaveLength(3);
    });

    it('stops when the recurrence end date is passed', () => {
      const event = makeEvent({
        recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59'), count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T00:00:00'), new Date('2026-09-30T23:59:59'));

      expect(instances.map((i) => i.startDate.toISOString())).toEqual([
        '2026-08-17T10:00:00.000Z',
        '2026-08-18T10:00:00.000Z',
        '2026-08-19T10:00:00.000Z',
      ]);
    });

    it('includes instances that start exactly at the range boundary', () => {
      const event = makeEvent({
        recurrence: { frequency: 'DAILY', interval: 1, endDate: null, count: undefined },
      });

      const instances = expandRecurrence(event as never, new Date('2026-08-17T10:00:00'), new Date('2026-08-17T23:59:59'));

      expect(instances).toHaveLength(1);
    });

    it('caps expansion at a bounded number of occurrences', () => {
      const event = makeEvent({
        startDate: new Date('2000-01-01T10:00:00'),
        endDate: new Date('2000-01-01T11:00:00'),
        recurrence: { frequency: 'DAILY', interval: 1, endDate: null, count: undefined },
      });

      // Range spanning decades — must terminate and stay under the cap (52*12)
      const instances = expandRecurrence(event as never, new Date('2000-01-01T00:00:00'), new Date('2035-01-01T00:00:00'));

      expect(instances.length).toBeLessThanOrEqual(52 * 12);
    });
  });

  // -------------------------------------------------------------------------
  // createEvent
  // -------------------------------------------------------------------------

  describe('createEvent', () => {
    it('throws ForbiddenError for MEMBER role', async () => {
      await expect(
        CalendarEventService.createEvent(mockCtx('MEMBER'), {
          title: 'Test',
          startDate: new Date('2026-08-17T10:00:00'),
          endDate: new Date('2026-08-17T11:00:00'),
          calendarId: 'cal-1',
        })
      ).rejects.toThrow(ForbiddenError);

      expect(globalDb.calendarEvent.create).not.toHaveBeenCalled();
    });

    it('throws ValidationError for an empty title', async () => {
      await expect(
        CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
          title: '   ',
          startDate: new Date('2026-08-17T10:00:00'),
          endDate: new Date('2026-08-17T11:00:00'),
          calendarId: 'cal-1',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when end date is before start date', async () => {
      await expect(
        CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
          title: 'Test',
          startDate: new Date('2026-08-17T11:00:00'),
          endDate: new Date('2026-08-17T10:00:00'),
          calendarId: 'cal-1',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('throws NotFoundError when the calendar does not exist', async () => {
      vi.mocked(globalDb.calendar.findFirst).mockResolvedValue(null);

      await expect(
        CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
          title: 'Test',
          startDate: new Date('2026-08-17T10:00:00'),
          endDate: new Date('2026-08-17T11:00:00'),
          calendarId: 'missing-cal',
        })
      ).rejects.toThrow(NotFoundError);

      expect(globalDb.calendarEvent.create).not.toHaveBeenCalled();
    });

    it('creates a non-recurring event without touching the recurrence table', async () => {
      vi.mocked(globalDb.calendar.findFirst).mockResolvedValue({ id: 'cal-1' } as never);
      vi.mocked(globalDb.calendarEvent.create).mockResolvedValue(makeDbEvent() as never);

      const result = await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'),
        calendarId: 'cal-1',
      });

      expect(globalDb.calendarRecurrence.create).not.toHaveBeenCalled();
      expect(result.id).toBe('event-1');
      expect(result.recurrenceId).toBeNull();
      expect(result.recurrence).toBeNull();
    });

    it('creates a recurring event, persists the recurrenceId scalar, and returns rule details', async () => {
      vi.mocked(globalDb.calendar.findFirst).mockResolvedValue({ id: 'cal-1' } as never);
      vi.mocked(globalDb.calendarEvent.create).mockResolvedValue(makeDbEvent() as never);
      // The DB echoes back the rule it persisted (interval 2, matching input)
      vi.mocked(globalDb.calendarRecurrence.create).mockResolvedValue(makeRecurrenceRow({ interval: 2 }) as never);

      const result = await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'),
        calendarId: 'cal-1',
        recurrence: { frequency: 'WEEKLY', interval: 2 },
      });

      // Recurrence row created with the event id and normalized interval
      expect(globalDb.calendarRecurrence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frequency: 'WEEKLY',
            interval: 2,
            eventId: 'event-1',
          }),
        })
      );

      // Regression: the event row's recurrenceId scalar must be persisted so
      // later updates/deletes can find the rule via the event row.
      expect(globalDb.calendarEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1', organizationId: 'org-1' },
        data: { recurrenceId: 'rec-1' },
      });

      expect(result.recurrenceId).toBe('rec-1');
      expect(result.recurrence).toEqual({ frequency: 'WEEKLY', interval: 2, endDate: null, count: null });
    });

    it('stores the recurrence end date and count when provided', async () => {
      vi.mocked(globalDb.calendar.findFirst).mockResolvedValue({ id: 'cal-1' } as never);
      vi.mocked(globalDb.calendarEvent.create).mockResolvedValue(makeDbEvent() as never);
      vi.mocked(globalDb.calendarRecurrence.create).mockResolvedValue(
        makeRecurrenceRow({ endDate: new Date('2026-12-31T00:00:00'), count: 5 }) as never
      );

      await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: 'Bounded series',
        startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'),
        calendarId: 'cal-1',
        recurrence: { frequency: 'MONTHLY', interval: 1, endDate: new Date('2026-12-31T00:00:00'), count: 5 },
      });

      expect(globalDb.calendarRecurrence.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            frequency: 'MONTHLY',
            endDate: new Date('2026-12-31T00:00:00'),
            count: 5,
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // getEvents / getEventsWithRecurrences
  // -------------------------------------------------------------------------

  describe('getEvents', () => {
    it('returns events mapped to the detail shape', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([makeDbEvent()] as never);

      const result = await CalendarEventService.getEvents(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00'),
        endDate: new Date('2026-08-31T23:59:59'),
      });

      expect(globalDb.calendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', startDate: { lte: new Date('2026-08-31T23:59:59') }, endDate: { gte: new Date('2026-08-01T00:00:00') } },
        })
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('event-1');
    });

    it('passes the calendarId filter through', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([]);

      await CalendarEventService.getEvents(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00'),
        endDate: new Date('2026-08-31T23:59:59'),
        calendarId: 'cal-2',
      });

      expect(globalDb.calendarEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ calendarId: 'cal-2', organizationId: 'org-1' }) })
      );
    });
  });

  describe('getEventsWithRecurrences', () => {
    it('queries with an OR of non-recurring overlap and active recurring series', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([]);

      await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00'),
        endDate: new Date('2026-08-31T23:59:59'),
      });

      const call = vi.mocked(globalDb.calendarEvent.findMany).mock.calls[0][0];
      expect(call?.where?.OR).toEqual([
        { recurrence: null, startDate: { lte: new Date('2026-08-31T23:59:59') }, endDate: { gte: new Date('2026-08-01T00:00:00') } },
        { recurrence: { isNot: null }, startDate: { lte: new Date('2026-08-31T23:59:59') } },
      ]);
    });

    it('returns non-recurring events with recurrence: null', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([makeDbEvent({ recurrence: null })] as never);

      const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00'),
        endDate: new Date('2026-08-31T23:59:59'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].recurrence).toBeNull();
    });

    it('expands recurring events into instances with shifted end dates and rule details', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([
        makeDbEvent({
          id: 'series-1',
          startDate: new Date('2026-05-18T10:00:00'),
          endDate: new Date('2026-05-18T11:30:00'),
          recurrence: makeRecurrenceRow({ id: 'rec-1', eventId: 'series-1' }),
        }),
      ] as never);

      const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00'),
        endDate: new Date('2026-08-23T23:59:59'),
      });

      expect(result).toHaveLength(1);
      expect(result[0].startDate.toISOString()).toBe('2026-08-17T10:00:00.000Z');
      expect(result[0].endDate.toISOString()).toBe('2026-08-17T11:30:00.000Z');
      expect(result[0].recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null });
    });

    it('sorts instances by start date', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([
        makeDbEvent({ id: 'b', startDate: new Date('2026-08-20T10:00:00'), endDate: new Date('2026-08-20T11:00:00') }),
        makeDbEvent({ id: 'a', startDate: new Date('2026-08-18T10:00:00'), endDate: new Date('2026-08-18T11:00:00') }),
      ] as never);

      const result = await CalendarEventService.getEventsWithRecurrences(mockCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00'),
        endDate: new Date('2026-08-31T23:59:59'),
      });

      expect(result.map((e) => e.id)).toEqual(['a', 'b']);
    });
  });

  // -------------------------------------------------------------------------
  // getEventById
  // -------------------------------------------------------------------------

  describe('getEventById', () => {
    it('throws NotFoundError for a missing event', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(null);

      await expect(CalendarEventService.getEventById(mockCtx('MEMBER'), 'missing')).rejects.toThrow(NotFoundError);
    });

    it('includes recurrence details when the rule exists', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(
        makeDbEvent({ recurrence: makeRecurrenceRow() }) as never
      );

      const result = await CalendarEventService.getEventById(mockCtx('MEMBER'), 'event-1');

      expect(result.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null });
    });

    it('returns recurrence: null when the rule does not exist', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      const result = await CalendarEventService.getEventById(mockCtx('MEMBER'), 'event-1');

      expect(result.recurrence).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // updateEvent
  // -------------------------------------------------------------------------

  describe('updateEvent', () => {
    it('throws ForbiddenError for MEMBER role', async () => {
      await expect(
        CalendarEventService.updateEvent(mockCtx('MEMBER'), 'event-1', { title: 'Nope' })
      ).rejects.toThrow(ForbiddenError);

      expect(globalDb.calendarEvent.findFirst).not.toHaveBeenCalled();
    });

    it('throws NotFoundError for a missing event', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(null);

      await expect(
        CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'missing', { title: 'X' })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError for an empty title', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      await expect(
        CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', { title: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when the updated end date precedes the start date', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      await expect(
        CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
          startDate: new Date('2026-08-17T12:00:00'),
          endDate: new Date('2026-08-17T10:00:00'),
        })
      ).rejects.toThrow(ValidationError);
    });

    it('updates scalar fields without touching the recurrence rule', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);
      vi.mocked(globalDb.calendarEvent.update).mockResolvedValue(makeDbEvent({ title: 'Renamed' }) as never);

      const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
        title: 'Renamed',
        eventType: 'MAINTENANCE',
      });

      expect(globalDb.calendarRecurrence.create).not.toHaveBeenCalled();
      expect(globalDb.calendarRecurrence.update).not.toHaveBeenCalled();
      expect(globalDb.calendarRecurrence.delete).not.toHaveBeenCalled();
      expect(result.title).toBe('Renamed');
    });

    it('adds a new recurrence rule to an event that had none', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);
      vi.mocked(globalDb.calendarRecurrence.create).mockResolvedValue(makeRecurrenceRow() as never);
      vi.mocked(globalDb.calendarEvent.update).mockResolvedValue(makeDbEvent({ recurrenceId: 'rec-1' }) as never);

      await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
        recurrence: { frequency: 'MONTHLY', interval: 1 },
      });

      expect(globalDb.calendarRecurrence.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ frequency: 'MONTHLY', eventId: 'event-1' }) })
      );
      expect(globalDb.calendarEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ recurrenceId: 'rec-1' }) })
      );
    });

    it('updates the existing rule in place when the event already recurs', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(
        makeDbEvent({ recurrence: makeRecurrenceRow() }) as never
      );
      vi.mocked(globalDb.calendarEvent.update).mockResolvedValue(
        makeDbEvent({ recurrence: makeRecurrenceRow() }) as never
      );

      await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
        recurrence: { frequency: 'ANNUALLY', interval: 1 },
      });

      expect(globalDb.calendarRecurrence.update).toHaveBeenCalledWith({
        where: { id: 'rec-1', organizationId: 'org-1' },
        data: expect.objectContaining({ frequency: 'ANNUALLY', interval: 1 }),
      });
      expect(globalDb.calendarRecurrence.create).not.toHaveBeenCalled();
    });

    it('clears the recurrence when null is passed', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(
        makeDbEvent({ recurrenceId: 'rec-1', recurrence: makeRecurrenceRow() }) as never
      );
      vi.mocked(globalDb.calendarEvent.update).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
        recurrence: null,
      });

      expect(globalDb.calendarRecurrence.delete).toHaveBeenCalledWith({ where: { id: 'rec-1', organizationId: 'org-1' } });
      expect(result.recurrence).toBeNull();
    });

    it('handles clearing recurrence on a legacy row whose scalar is null but relation exists', async () => {
      // Regression: rows created before the scalar-sync fix have recurrenceId = null
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(
        makeDbEvent({ recurrenceId: null, recurrence: makeRecurrenceRow() }) as never
      );
      vi.mocked(globalDb.calendarEvent.update).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', { recurrence: null });

      expect(globalDb.calendarRecurrence.delete).toHaveBeenCalledWith({ where: { id: 'rec-1', organizationId: 'org-1' } });
    });
  });

  // -------------------------------------------------------------------------
  // deleteEvent
  // -------------------------------------------------------------------------

  describe('deleteEvent', () => {
    it('throws ForbiddenError for MEMBER role', async () => {
      await expect(CalendarEventService.deleteEvent(mockCtx('MEMBER'), 'event-1')).rejects.toThrow(ForbiddenError);
    });

    it('throws NotFoundError for a missing event', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(null);

      await expect(CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'missing')).rejects.toThrow(NotFoundError);
    });

    it('deletes the recurrence rule before the event for recurring events', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(
        makeDbEvent({ recurrenceId: 'rec-1', recurrence: makeRecurrenceRow() }) as never
      );

      await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

      expect(globalDb.calendarRecurrence.delete).toHaveBeenCalledWith({ where: { id: 'rec-1', organizationId: 'org-1' } });
      expect(globalDb.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1', organizationId: 'org-1' } });

      // The child row must be removed first (the relation is Restrict)
      const deleteOrder = [
        vi.mocked(globalDb.calendarRecurrence.delete).mock.invocationCallOrder[0],
        vi.mocked(globalDb.calendarEvent.delete).mock.invocationCallOrder[0],
      ];
      expect(deleteOrder[0]).toBeLessThan(deleteOrder[1]);
    });

    it('deletes a non-recurring event without touching the recurrence table', async () => {
      vi.mocked(globalDb.calendarEvent.findFirst).mockResolvedValue(makeDbEvent({ recurrence: null }) as never);

      await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

      expect(globalDb.calendarRecurrence.delete).not.toHaveBeenCalled();
      expect(globalDb.calendarEvent.delete).toHaveBeenCalledWith({ where: { id: 'event-1', organizationId: 'org-1' } });
    });
  });

  // -------------------------------------------------------------------------
  // getUpcomingEvents
  // -------------------------------------------------------------------------

  describe('getUpcomingEvents', () => {
    it('throws ValidationError without an organization context', async () => {
      await expect(CalendarEventService.getUpcomingEvents({ userId: 'user-1', role: 'TENANT_ADMIN' })).rejects.toThrow(
        ValidationError
      );
    });

    it('excludes recurring events from the single-event query to avoid double counting', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([]);

      await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'));

      // First call is the single-events query
      const singleCall = vi.mocked(globalDb.calendarEvent.findMany).mock.calls[0][0];
      expect(singleCall?.where).toEqual(expect.objectContaining({ recurrence: null }));

      // Second call is the recurring-series query
      const recurringCall = vi.mocked(globalDb.calendarEvent.findMany).mock.calls[1][0];
      expect(recurringCall?.where).toEqual(expect.objectContaining({ recurrence: { isNot: null } }));
    });

    it('combines single and recurring instances, sorted and limited', async () => {
      // Dates relative to now so the test stays valid over time
      const inTwoDays = new Date();
      inTwoDays.setDate(inTwoDays.getDate() + 2);
      const inFiveDays = new Date();
      inFiveDays.setDate(inFiveDays.getDate() + 5);
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      vi.mocked(globalDb.calendarEvent.findMany)
        .mockResolvedValueOnce([
          makeDbEvent({ id: 'single-1', startDate: inTwoDays, endDate: inTwoDays }),
          makeDbEvent({ id: 'single-2', startDate: inFiveDays, endDate: inFiveDays }),
        ] as never)
        .mockResolvedValueOnce([
          makeDbEvent({
            id: 'series-1',
            startDate: tenDaysAgo,
            endDate: new Date(tenDaysAgo.getTime() + 60 * 60 * 1000),
            recurrence: makeRecurrenceRow({ frequency: 'DAILY', eventId: 'series-1' }),
          }),
        ] as never);

      const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 10);

      // The single events plus daily instances of the series within the 30-day window
      expect(result.length).toBeGreaterThan(1);

      // No duplicate *instances* — recurring instances legitimately share the
      // base event id, so dedupe by id + start date (the instance key).
      const keys = result.map((e) => `${e.id}:${e.startDate.getTime()}`);
      expect(new Set(keys).size).toBe(keys.length); // no duplicates

      // Sorted ascending by start date
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startDate.getTime()).toBeGreaterThanOrEqual(result[i - 1].startDate.getTime());
      }

      // Each non-recurring event is present exactly once (no double counting)
      const ids = result.map((e) => e.id);
      expect(ids.filter((id) => id === 'single-1')).toHaveLength(1);
      expect(ids.filter((id) => id === 'single-2')).toHaveLength(1);
    });

    it('respects the limit', async () => {
      vi.mocked(globalDb.calendarEvent.findMany).mockResolvedValue([]);

      const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 3);

      expect(result.length).toBeLessThanOrEqual(3);
    });
  });
});

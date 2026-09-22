/**
 * Unit tests for CalendarEventService.createEvent — validation, calendar lookup, rrule JSON write.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/tenant-db', () => ({
  default: {
    calendar: { findFirst: vi.fn() },
    calendarEvent: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));

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

describe('createEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Authorization ---

  it('throws ForbiddenError for MEMBER role', async () => {
    await expect(
      CalendarEventService.createEvent(mockCtx('MEMBER'), {
        title: 'Test', startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      })
    ).rejects.toThrow(ForbiddenError);
    expect(globalDb.calendarEvent.create).not.toHaveBeenCalled();
  });

  // --- Validation ---

  it('throws ValidationError for an empty title', async () => {
    await expect(
      CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: '   ', startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when end date is before start date', async () => {
    await expect(
      CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: 'Test', startDate: new Date('2026-08-17T11:00:00'),
        endDate: new Date('2026-08-17T10:00:00'), calendarId: 'cal-1',
      })
    ).rejects.toThrow(ValidationError);
  });

  // --- Calendar lookup ---

  it('throws NotFoundError when the calendar does not exist', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue(null);

    await expect(
      CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
        title: 'Test', startDate: new Date('2026-08-17T10:00:00'),
        endDate: new Date('2026-08-17T11:00:00'), calendarId: 'missing-cal',
      })
    ).rejects.toThrow(NotFoundError);
    expect(globalDb.calendarEvent.create).not.toHaveBeenCalled();
  });

  // --- Non-recurring events ---

  it('creates a non-recurring event without rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    const result = await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'One-off', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
    });

    expect(result.id).toBe('event-1');
    expect(result.recurrence).toBeNull();
  });

  // --- Recurring events — rrule JSON write ---

  it('creates a recurring event and writes rrule JSON on the event row', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Weekly inspection', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'WEEKLY', interval: 2 },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.freq).toBe('WEEKLY');
    expect(rrule.interval).toBe(2);
  });

  it('maps QUARTERLY to MONTHLY interval=3 in rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Quarterly review', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'QUARTERLY' },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.freq).toBe('MONTHLY');
    expect(rrule.interval).toBe(3);
  });

  it('maps SEMI_ANNUALLY to MONTHLY interval=6 in rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Semi-annual audit', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'SEMI_ANNUALLY' },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.freq).toBe('MONTHLY');
    expect(rrule.interval).toBe(6);
  });

  it('stores byDay as byweekday array in rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Bi-weekly Tue/Thu', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'WEEKLY', interval: 2, byDay: 'TU,TH' },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.byweekday).toEqual(['TU', 'TH']);
  });

  it('stores byMonthDay as bymonthday array in rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: '15th of month', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'MONTHLY', byMonthDay: 15 },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.bymonthday).toEqual([15]);
  });

  it('stores count and endDate in rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Bounded series', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'MONTHLY', endDate: new Date('2026-12-31T00:00:00'), count: 5 },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    const rrule = typeof createCall.data.rrule === 'string' ? JSON.parse(createCall.data.rrule) : createCall.data.rrule;
    expect(rrule.count).toBe(5);
    expect(rrule.until).toEqual(new Date('2026-12-31T00:00:00'));
  });

  it('stores excluded dates in exdates on the event row', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Weekly with exclusions', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'WEEKLY', excludedDates: ['2026-08-24'] },
    });

    const createCall = (globalDb.calendarEvent.create as any).mock.calls[0][0];
    expect(createCall.data.exdates).toEqual(['2026-08-24']);
  });

  it('returns recurrence details derived from the rrule JSON', async () => {
    (globalDb.calendar.findFirst as any).mockResolvedValue({ id: 'cal-1' } as never);
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeDbEvent() as never);

    const result = await CalendarEventService.createEvent(mockCtx('TENANT_ADMIN'), {
      title: 'Weekly', startDate: new Date('2026-08-17T10:00:00'),
      endDate: new Date('2026-08-17T11:00:00'), calendarId: 'cal-1',
      recurrence: { frequency: 'WEEKLY', interval: 2 },
    });

    expect(result.recurrence).toEqual({
      frequency: 'WEEKLY', interval: 2, endDate: null, count: null,
      byDay: null, byMonthDay: null, excludedDates: [],
    });
  });
});

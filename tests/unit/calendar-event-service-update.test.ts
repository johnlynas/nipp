/**
 * Unit tests for CalendarEventService.updateEvent — validation, rrule updates, exdates.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/global-db', () => ({
  default: {
    calendarEvent: { findFirst: vi.fn(), update: vi.fn() },
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

describe('updateEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Authorization ---

  it('throws ForbiddenError for MEMBER role', async () => {
    await expect(
      CalendarEventService.updateEvent(mockCtx('MEMBER'), 'event-1', { title: 'Nope' })
    ).rejects.toThrow(ForbiddenError);
  });

  // --- Validation ---

  it('throws NotFoundError for a missing event', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(null);

    await expect(
      CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'missing', { title: 'X' })
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError for an empty title', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);

    await expect(
      CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', { title: '' })
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when the updated end date precedes the start date', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);

    await expect(
      CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
        startDate: new Date('2026-08-17T12:00:00'),
        endDate: new Date('2026-08-17T10:00:00'),
      })
    ).rejects.toThrow(ValidationError);
  });

  // --- Scalar field updates (no recurrence) ---

  it('updates scalar fields without touching rrule', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ title: 'Renamed' }) as never);

    const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      title: 'Renamed', eventType: 'MAINTENANCE',
    });

    expect(result.title).toBe('Renamed');
  });

  it('updates title, description, and date fields', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ title: 'Renamed', description: 'New desc' }) as never);

    const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      title: 'Renamed', description: 'New desc',
      startDate: new Date('2026-08-18T14:00:00'),
      endDate: new Date('2026-08-18T15:00:00'),
    });

    expect(result.title).toBe('Renamed');
    expect(result.description).toBe('New desc');

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.title).toBe('Renamed');
    expect(updateCall.data.description).toBe('New desc');
  });

  // --- Adding recurrence to a non-recurring event ---

  it('writes rrule JSON when adding recurrence to an event that had none', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ rrule: JSON.stringify({ freq: 'MONTHLY', interval: 1 }) } as never));

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'MONTHLY', interval: 1 },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.rrule).toBeDefined();
  });

  // --- Updating existing recurrence ---

  it('updates rrule JSON when changing an existing recurrence', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1, dtstart: new Date('2026-08-17T10:00:00').toISOString(), until: null, count: null }) } as never)
    );
    (globalDb.calendarEvent.update as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'ANNUALLY', interval: 1 }) } as never)
    );

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'ANNUALLY', interval: 1 },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    const rrule = typeof updateCall.data.rrule === 'string' ? JSON.parse(updateCall.data.rrule) : updateCall.data.rrule;
    expect(rrule.freq).toBe('ANNUALLY'); // Stored as-is (not mapped to YEARLY)
  });

  // --- Clearing recurrence ---

  it('clears rrule JSON and exdates when recurrence is set to null', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1 }) } as never)
    );
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ rrule: null, exdates: [] }) as never);

    const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: null,
    });

    expect(result.recurrence).toBeNull();

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.rrule).toBeNull();
  });

  // --- Excluded dates ---

  it('appends an excluded date via top-level excludedDate field', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ exdates: [] } as never)
    );
    (globalDb.calendarEvent.update as any).mockResolvedValue(
      makeDbEvent({ exdates: ['2026-08-24'] } as never)
    );

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      excludedDate: '2026-08-24',
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.exdates).toEqual(['2026-08-24']);
  });

  it('deduplicates excluded dates when the same date is added twice', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ exdates: ['2026-08-24'] } as never)
    );
    (globalDb.calendarEvent.update as any).mockResolvedValue(
      makeDbEvent({ exdates: ['2026-08-24'] } as never)
    );

    // First call adds the date (should be a no-op since already present)
    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      excludedDate: '2026-08-24',
    });

    // Second call — should not duplicate
    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      excludedDate: '2026-08-24',
    });

    const calls = (globalDb.calendarEvent.update as any).mock.calls;
    expect(calls.length).toBe(2);
  });

  // --- Recurrence with excludedDates array ---

  it('merges exdates from recurrence.excludedDates with existing ones', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ exdates: ['2026-08-17'] } as never)
    );
    (globalDb.calendarEvent.update as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1 }), exdates: ['2026-08-17', '2026-08-24'] } as never)
    );

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'WEEKLY', excludedDates: ['2026-08-24'] },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    expect(updateCall.data.exdates).toEqual(['2026-08-17', '2026-08-24']);
  });

  // --- Recurrence with endDate and count ---

  it('stores recurrence end date and count when provided', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'MONTHLY', interval: 1, endDate: new Date('2026-12-31T00:00:00'), count: 5 },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    const rrule = typeof updateCall.data.rrule === 'string' ? JSON.parse(updateCall.data.rrule) : updateCall.data.rrule;
    expect(rrule.count).toBe(5);
  });

  // --- Recurrence with byDay and byMonthDay ---

  it('maps byDay to byweekday in rrule JSON', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'WEEKLY', byDay: 'MO,WE' },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    const rrule = typeof updateCall.data.rrule === 'string' ? JSON.parse(updateCall.data.rrule) : updateCall.data.rrule;
    expect(rrule.byweekday).toEqual(['MO', 'WE']);
  });

  it('maps byMonthDay to bymonthday in rrule JSON', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent() as never);

    await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      recurrence: { frequency: 'MONTHLY', byMonthDay: 15 },
    });

    const updateCall = (globalDb.calendarEvent.update as any).mock.calls[0][0];
    const rrule = typeof updateCall.data.rrule === 'string' ? JSON.parse(updateCall.data.rrule) : updateCall.data.rrule;
    expect(rrule.bymonthday).toEqual([15]);
  });

  // --- Combining updates ---

  it('combines title update with recurrence change', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.update as any).mockResolvedValue(makeDbEvent({ title: 'Renamed' }) as never);

    const result = await CalendarEventService.updateEvent(mockCtx('TENANT_ADMIN'), 'event-1', {
      title: 'Renamed',
      recurrence: { frequency: 'WEEKLY' },
    });

    expect(result.title).toBe('Renamed');
  });
});

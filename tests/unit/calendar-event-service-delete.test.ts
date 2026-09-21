/**
 * Unit tests for CalendarEventService.deleteEvent — authorization, NotFoundError, single delete.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, ForbiddenError, NotFoundError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/tenant-db', () => ({
  default: {
    calendarEvent: { findFirst: vi.fn(), delete: vi.fn() },
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

describe('deleteEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws ForbiddenError for MEMBER role', async () => {
    await expect(CalendarEventService.deleteEvent(mockCtx('MEMBER'), 'event-1')).rejects.toThrow(ForbiddenError);
    expect(globalDb.calendarEvent.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing event', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(null);

    await expect(CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'missing')).rejects.toThrow(NotFoundError);
    expect(globalDb.calendarEvent.delete).not.toHaveBeenCalled();
  });

  it('deletes a non-recurring event with a single delete call', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent({ rrule: null, exdates: [] }) as never);

    await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

    expect(globalDb.calendarEvent.delete).toHaveBeenCalledWith({
      where: { id: 'event-1', organizationId: 'org-1' },
    });
  });

  it('deletes a recurring event with rrule JSON (no CalendarRecurrence)', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1 }) } as never)
    );

    await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

    // Only one delete call — the event itself. The rrule JSON is removed with it.
    expect(globalDb.calendarEvent.delete).toHaveBeenCalledWith({
      where: { id: 'event-1', organizationId: 'org-1' },
    });
  });

  it('logs the deletion', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(makeDbEvent() as never);
    (globalDb.calendarEvent.delete as any).mockResolvedValue({ id: 'event-1' });

    await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

    // Should not throw — the service logs before deleting
    expect(globalDb.calendarEvent.delete).toHaveBeenCalled();
  });

  it('deletes the event even when exdates are present', async () => {
    (globalDb.calendarEvent.findFirst as any).mockResolvedValue(
      makeDbEvent({ rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1 }), exdates: ['2026-08-24'] } as never)
    );

    await CalendarEventService.deleteEvent(mockCtx('TENANT_ADMIN'), 'event-1');

    expect(globalDb.calendarEvent.delete).toHaveBeenCalledWith({
      where: { id: 'event-1', organizationId: 'org-1' },
    });
  });
});

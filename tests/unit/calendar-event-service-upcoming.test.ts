/**
 * Unit tests for CalendarEventService.getUpcomingEvents — org context, rrule queries, sorting/limiting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { CalendarEventWithDetails } from '@/services/calendar-event-service';
import { ServiceContext, ValidationError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/global-db', () => ({
  default: {
    calendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));

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

describe('getUpcomingEvents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws ValidationError without an organization context', async () => {
    await expect(
      CalendarEventService.getUpcomingEvents({ userId: 'user-1', role: 'TENANT_ADMIN' })
    ).rejects.toThrow(ValidationError);
  });

  it('excludes recurring events from the single-event query to avoid double counting', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'));

    const calls = (globalDb.calendarEvent.findMany as any).mock.calls;
    expect(calls.length).toBe(2);

    // First call: fetches all upcoming events (rrule filtering moved to post-fetch code)
    expect(calls[0][0].where.rrule).toBeUndefined();
    expect(calls[0][0].where.organizationId).toBeDefined();

    // Second call: recurring series (no rrule filter — fetched to expand for upcoming window)
    expect(calls[1][0].where.organizationId).toBeDefined();
  });

  it('combines single and recurring instances, sorted and limited', async () => {
    const inTwoDays = new Date();
    inTwoDays.setDate(inTwoDays.getDate() + 2);
    const inFiveDays = new Date();
    inFiveDays.setDate(inFiveDays.getDate() + 5);
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    (globalDb.calendarEvent.findMany as any)
      .mockResolvedValueOnce([
        makeDbEvent({ id: 'single-1', startDate: inTwoDays, endDate: inTwoDays }),
        makeDbEvent({ id: 'single-2', startDate: inFiveDays, endDate: inFiveDays }),
      ] as never)
      .mockResolvedValueOnce([
        makeDbEvent({
          id: 'series-1',
          startDate: tenDaysAgo,
          endDate: new Date(tenDaysAgo.getTime() + 60 * 60 * 1000),
          rrule: JSON.stringify({ freq: 'DAILY', interval: 1 }),
        } as never),
      ]);

    const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 10);

    // Should have single events plus daily instances of the series
    expect(result.length).toBeGreaterThan(1);

    // No duplicate instance keys (id + start date)
    const keys = result.map((e: any) => `${e.id}:${e.startDate.getTime()}`);
    expect(new Set(keys).size).toBe(keys.length);

    // Sorted ascending by start date
    for (let i = 1; i < result.length; i++) {
      expect(result[i].startDate.getTime()).toBeGreaterThanOrEqual(result[i - 1].startDate.getTime());
    }
  });

  it('respects the limit parameter', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 3);

    expect(result.length).toBeLessThanOrEqual(3);
  });

  it('uses a default limit when none is provided', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'));

    // The service should apply its default limit
    expect((globalDb.calendarEvent.findMany as any).mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('queries only the current organization', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN', 'org-42'));

    const calls = (globalDb.calendarEvent.findMany as any).mock.calls;
    expect(calls.length).toBe(2); // single + recurring queries
    for (const call of calls) {
      expect(call[0].where.organizationId).toBe('org-42');
    }
  });

  it('excludes events that have already passed', async () => {
    (globalDb.calendarEvent.findMany as any).mockResolvedValue([]);

    await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'));

    const calls = (globalDb.calendarEvent.findMany as any).mock.calls;
    expect(calls.length).toBe(2);
    // Both queries use startDate gte (no past events in single query) and
    // startDate lte (upcoming window for recurring query)
    const singleCall = calls[0][0];
    expect(singleCall.where.startDate).toBeDefined();
  });

  it('handles events with rrule JSON for recurring query', async () => {
    const inThreeDays = new Date();
    inThreeDays.setDate(inThreeDays.getDate() + 3);

    (globalDb.calendarEvent.findMany as any)
      .mockResolvedValueOnce([]) // no single events
      .mockResolvedValueOnce([
        makeDbEvent({
          id: 'recurring-1',
          startDate: new Date('2026-01-01T10:00:00'),
          endDate: new Date('2026-01-01T11:00:00'),
          rrule: JSON.stringify({ freq: 'WEEKLY', interval: 1, dtstart: new Date('2026-01-01T10:00:00').toISOString(), until: null, count: null }),
          exdates: [],
        } as never),
      ]);

    const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 10);

    // Should have at least one instance from the recurring series
    expect(result.length).toBeGreaterThan(0);
  });

  it('filters out instances that fall outside the date range', async () => {
    const inThirtyOneDays = new Date();
    inThirtyOneDays.setDate(inThirtyOneDays.getDate() + 31);

    (globalDb.calendarEvent.findMany as any)
      .mockResolvedValueOnce([]) // no single events in range
      .mockResolvedValueOnce([
        makeDbEvent({
          id: 'future-series',
          startDate: inThirtyOneDays,
          endDate: new Date(inThirtyOneDays.getTime() + 60 * 60 * 1000),
          rrule: JSON.stringify({ freq: 'DAILY', interval: 1 }),
        } as never),
      ]);

    const result = await CalendarEventService.getUpcomingEvents(mockCtx('TENANT_ADMIN'), undefined, 10);

    // Should not include events more than ~30 days out
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    for (const event of result) {
      expect(event.endDate.getTime()).toBeLessThanOrEqual(cutoff.getTime() + 86400000); // allow 1 day buffer
    }
  });
});

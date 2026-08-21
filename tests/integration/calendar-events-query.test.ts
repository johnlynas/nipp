/**
 * Integration tests: CalendarEventService.getEventsWithRecurrences and getEventById.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { ServiceContext } from '@/lib/services/types';
import { NotFoundError, ValidationError } from '@/lib/services/types';

describe('Calendar Events Integration — query', () => {
  let testOrgId: string;
  let calendarId: string;
  const createdOrgIds: string[] = [];

  const makeCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'): ServiceContext => ({
    userId: 'user-1', role, organizationId: testOrgId,
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Test Calendar Org', slug: `test-cal-org-query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'ACTIVE' },
    });
    testOrgId = org.id; createdOrgIds.push(org.id);

    const calendar = await prisma.calendar.create({
      data: { name: 'Main Calendar', isDefault: true, organizationId: testOrgId },
    });
    calendarId = calendar.id;
  });

  afterAll(async () => {
    for (const orgId of createdOrgIds) {
      await prisma.calendarEvent.deleteMany({ where: { organizationId: orgId } });
      await prisma.calendar.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });

  // -------------------------------------------------------------------------
  // getEventsWithRecurrences
  // -------------------------------------------------------------------------

  describe('getEventsWithRecurrences', () => {
    it('returns later occurrences of a long-running series with shifted end dates (regression)', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      // Query the week of Aug 17 — months after the base event's own dates.
      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'), endDate: new Date('2026-08-23T23:59:59Z'), calendarId,
      });

      expect(result).toHaveLength(1);
      expect(result[0].startDate.toISOString()).toBe('2026-08-17T10:00:00.000Z');
      expect(result[0].endDate.toISOString()).toBe('2026-08-17T11:30:00.000Z');
      expect(result[0].recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
    });

    it('respects the recurrence count limit', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Three daily standups', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, count: 3 },
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59Z'), calendarId,
      });

      expect(result.map((e) => e.startDate.toISOString())).toEqual([
        '2026-08-17T09:00:00.000Z',
        '2026-08-18T09:00:00.000Z',
        '2026-08-19T09:00:00.000Z',
      ]);
    });

    it('stops expanding after the recurrence end date', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Bounded daily series', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59Z') },
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59Z'), calendarId,
      });

      expect(result.map((e) => e.startDate.toISOString())).toEqual([
        '2026-08-17T09:00:00.000Z',
        '2026-08-18T09:00:00.000Z',
        '2026-08-19T09:00:00.000Z',
      ]);
    });

    it('includes non-recurring events inside the range and excludes those outside', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Inside August', startDate: new Date('2026-08-10T10:00:00Z'),
        endDate: new Date('2026-08-10T11:00:00Z'), calendarId,
      });
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'In September', startDate: new Date('2026-09-15T10:00:00Z'),
        endDate: new Date('2026-09-15T11:00:00Z'), calendarId,
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T23:59:59Z'), calendarId,
      });

      const titles = result.map((e) => e.title);
      expect(titles).toContain('Inside August');
      expect(titles).not.toContain('In September');
    });

    it('sorts instances by start date', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Later event', startDate: new Date('2026-08-20T10:00:00Z'),
        endDate: new Date('2026-08-20T11:00:00Z'), calendarId,
      });
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Earlier event', startDate: new Date('2026-08-18T10:00:00Z'),
        endDate: new Date('2026-08-18T11:00:00Z'), calendarId,
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T23:59:59Z'), calendarId,
      });

      expect(result.map((e) => e.title)).toEqual(['Earlier event', 'Later event']);
    });

    it('handles exdates filtering during expansion', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, count: 5 },
      });

      // Exclude Aug 19 via update
      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), (await prisma.calendarEvent.findFirst({ where: { organizationId: testOrgId } }))!.id, {
        excludedDate: '2026-08-19',
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'), endDate: new Date('2026-08-31T23:59:59Z'), calendarId,
      });

      // 5 occurrences minus 1 excluded = 4 instances
      expect(result).toHaveLength(4);
      const dates = result.map((e) => e.startDate.toISOString().slice(0, 10));
      expect(dates).not.toContain('2026-08-19');
    });

    it('passes the calendarId filter through', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Aug event', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T23:59:59Z'), calendarId,
      });

      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // getEventById
  // -------------------------------------------------------------------------

  describe('getEventById', () => {
    it('includes recurrence details when rrule JSON is present', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Monthly review', startDate: new Date('2026-08-31T14:00:00Z'),
        endDate: new Date('2026-08-31T15:00:00Z'), calendarId,
        recurrence: { frequency: 'MONTHLY', interval: 1 },
      });

      const result = await CalendarEventService.getEventById(makeCtx('MEMBER'), created.id);

      expect(result.recurrence).toEqual({ frequency: 'MONTHLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
    });

    it('returns recurrence: null for non-recurring events', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const result = await CalendarEventService.getEventById(makeCtx('MEMBER'), created.id);
      expect(result.recurrence).toBeNull();
    });

    it('throws NotFoundError for a missing event', async () => {
      await expect(CalendarEventService.getEventById(makeCtx('MEMBER'), 'nonexistent-event-id')).rejects.toThrow(NotFoundError);
    });

    it('returns recurrence details from rrule JSON when present', async () => {
      const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Monthly review', startDate: new Date('2026-08-31T14:00:00Z'),
        endDate: new Date('2026-08-31T15:00:00Z'), calendarId,
        recurrence: { frequency: 'MONTHLY', interval: 1 },
      });

      const fetched = await CalendarEventService.getEventById(makeCtx('MEMBER'), result.id);

      expect(fetched.recurrence).not.toBeNull();
      expect(fetched.recurrence?.frequency).toBe('MONTHLY');
      expect(fetched.recurrence?.interval).toBe(1);
    });
  });
});

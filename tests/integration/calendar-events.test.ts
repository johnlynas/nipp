/**
 * Integration tests: Calendar events — CRUD, recurrence expansion, upcoming events.
 *
 * Service-level tests against the real database: CalendarEventService is driven
 * with a mocked ServiceContext (no HTTP/auth layer), and results are verified
 * both through the service responses and directly against the DB via prisma.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { ServiceContext } from '@/lib/services/types';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

describe('Calendar Events Integration', () => {
  let testOrgId: string;
  let calendarId: string;

  // Track every org created during the run so afterAll can clean them all up
  // (beforeEach creates a fresh org per test for isolation)
  const createdOrgIds: string[] = [];

  const makeCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'): ServiceContext => ({
    userId: 'user-1',
    role,
    organizationId: testOrgId,
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: {
        name: 'Test Calendar Org',
        slug: `test-cal-org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'ACTIVE',
      },
    });
    testOrgId = org.id;
    createdOrgIds.push(org.id);

    const calendar = await prisma.calendar.create({
      data: { name: 'Main Calendar', isDefault: true, organizationId: testOrgId },
    });
    calendarId = calendar.id;
  });

  afterAll(async () => {
    // Recurrences first — the CalendarRecurrence.event relation is Restrict,
    // so a direct event/org delete would fail while rule rows still exist.
    for (const orgId of createdOrgIds) {
      await prisma.calendarRecurrence.deleteMany({ where: { organizationId: orgId } });
      await prisma.calendarEvent.deleteMany({ where: { organizationId: orgId } });
      await prisma.calendar.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.deleteMany({ where: { id: orgId } });
    }
  });

  // -------------------------------------------------------------------------
  // createEvent
  // -------------------------------------------------------------------------

  describe('createEvent', () => {
    it('rejects MEMBER role with ForbiddenError and creates nothing', async () => {
      await expect(
        CalendarEventService.createEvent(makeCtx('MEMBER'), {
          title: 'Nope',
          startDate: new Date('2026-08-17T10:00:00Z'),
          endDate: new Date('2026-08-17T11:00:00Z'),
          calendarId,
        })
      ).rejects.toThrow(ForbiddenError);

      expect(await prisma.calendarEvent.count({ where: { organizationId: testOrgId } })).toBe(0);
    });

    it('creates a non-recurring event without a recurrence row', async () => {
      const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off viewing',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
        eventType: 'VIEWING',
      });

      expect(result.recurrenceId).toBeNull();
      expect(result.recurrence).toBeNull();

      const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
      expect(row).not.toBeNull();
      expect(row!.recurrenceId).toBeNull();
      expect(await prisma.calendarRecurrence.count({ where: { eventId: result.id } })).toBe(0);
    });

    it('creates a recurring event and persists the recurrenceId scalar (regression)', async () => {
      const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      expect(result.recurrenceId).not.toBeNull();
      expect(result.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });

      // The event row's scalar must point at the recurrence row — without it,
      // later updates would create a second rule (unique violation) and deletes
      // would hit the Restrict FK.
      const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
      expect(row!.recurrenceId).toBe(result.recurrenceId);

      const rule = await prisma.calendarRecurrence.findUnique({ where: { eventId: result.id } });
      expect(rule).not.toBeNull();
      expect(rule!.id).toBe(result.recurrenceId);
      expect(rule!.frequency).toBe('WEEKLY');
    });

    it('stores recurrence end date and count when provided', async () => {
      const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Bounded series',
        startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T10:00:00Z'),
        calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59Z'), count: 5 },
      });

      const rule = await prisma.calendarRecurrence.findUnique({ where: { eventId: result.id } });
      expect(rule!.endDate).toEqual(new Date('2026-08-19T23:59:59Z'));
      expect(rule!.count).toBe(5);
    });
  });

  // -------------------------------------------------------------------------
  // getEventsWithRecurrences
  // -------------------------------------------------------------------------

  describe('getEventsWithRecurrences', () => {
    it('returns later occurrences of a long-running series with shifted end dates (regression)', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      // Query the week of Aug 17 — months after the base event's own dates.
      // The series must still be returned (its base range does not overlap the query).
      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'),
        endDate: new Date('2026-08-23T23:59:59Z'),
        calendarId,
      });

      expect(result).toHaveLength(1);
      expect(result[0].startDate.toISOString()).toBe('2026-08-17T10:00:00.000Z');
      // The instance end is the base duration shifted onto the occurrence date
      expect(result[0].endDate.toISOString()).toBe('2026-08-17T11:30:00.000Z');
      expect(result[0].recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
    });

    it('respects the recurrence count limit', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Three daily standups',
        startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'),
        calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, count: 3 },
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'),
        endDate: new Date('2026-09-30T23:59:59Z'),
        calendarId,
      });

      expect(result.map((e) => e.startDate.toISOString())).toEqual([
        '2026-08-17T09:00:00.000Z',
        '2026-08-18T09:00:00.000Z',
        '2026-08-19T09:00:00.000Z',
      ]);
    });

    it('stops expanding after the recurrence end date', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Bounded daily series',
        startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'),
        calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59Z') },
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-17T00:00:00Z'),
        endDate: new Date('2026-09-30T23:59:59Z'),
        calendarId,
      });

      expect(result.map((e) => e.startDate.toISOString())).toEqual([
        '2026-08-17T09:00:00.000Z',
        '2026-08-18T09:00:00.000Z',
        '2026-08-19T09:00:00.000Z',
      ]);
    });

    it('includes non-recurring events inside the range and excludes those outside', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Inside August',
        startDate: new Date('2026-08-10T10:00:00Z'),
        endDate: new Date('2026-08-10T11:00:00Z'),
        calendarId,
      });
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'In September',
        startDate: new Date('2026-09-15T10:00:00Z'),
        endDate: new Date('2026-09-15T11:00:00Z'),
        calendarId,
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00Z'),
        endDate: new Date('2026-08-31T23:59:59Z'),
        calendarId,
      });

      const titles = result.map((e) => e.title);
      expect(titles).toContain('Inside August');
      expect(titles).not.toContain('In September');
    });

    it('sorts instances by start date', async () => {
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Later event',
        startDate: new Date('2026-08-20T10:00:00Z'),
        endDate: new Date('2026-08-20T11:00:00Z'),
        calendarId,
      });
      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Earlier event',
        startDate: new Date('2026-08-18T10:00:00Z'),
        endDate: new Date('2026-08-18T11:00:00Z'),
        calendarId,
      });

      const result = await CalendarEventService.getEventsWithRecurrences(makeCtx('MEMBER'), {
        startDate: new Date('2026-08-01T00:00:00Z'),
        endDate: new Date('2026-08-31T23:59:59Z'),
        calendarId,
      });

      expect(result.map((e) => e.title)).toEqual(['Earlier event', 'Later event']);
    });
  });

  // -------------------------------------------------------------------------
  // getEventById
  // -------------------------------------------------------------------------

  describe('getEventById', () => {
    it('includes recurrence details when the rule exists', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Monthly review',
        startDate: new Date('2026-08-31T14:00:00Z'),
        endDate: new Date('2026-08-31T15:00:00Z'),
        calendarId,
        recurrence: { frequency: 'MONTHLY', interval: 1 },
      });

      const result = await CalendarEventService.getEventById(makeCtx('MEMBER'), created.id);

      expect(result.recurrenceId).toBe(created.recurrenceId);
      expect(result.recurrence).toEqual({ frequency: 'MONTHLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
    });

    it('returns recurrence: null for non-recurring events', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
      });

      const result = await CalendarEventService.getEventById(makeCtx('MEMBER'), created.id);
      expect(result.recurrence).toBeNull();
    });

    it('throws NotFoundError for a missing event', async () => {
      await expect(
        CalendarEventService.getEventById(makeCtx('MEMBER'), 'nonexistent-event-id')
      ).rejects.toThrow(NotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // updateEvent
  // -------------------------------------------------------------------------

  describe('updateEvent', () => {
    it('updates an existing rule in place without creating a second row (regression)', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'MONTHLY', interval: 2 },
      });

      // Same rule row, updated in place (eventId is unique — a second row would violate it)
      expect(updated.recurrenceId).toBe(created.recurrenceId);

      const rows = await prisma.calendarRecurrence.findMany({ where: { eventId: created.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].frequency).toBe('MONTHLY');
      expect(rows[0].interval).toBe(2);
    });

    it('adds a rule to a non-recurring event and syncs the scalar', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      expect(updated.recurrenceId).not.toBeNull();

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id } });
      expect(row!.recurrenceId).toBe(updated.recurrenceId);

      const rule = await prisma.calendarRecurrence.findUnique({ where: { eventId: created.id } });
      expect(rule!.frequency).toBe('WEEKLY');
    });

    it('clears the recurrence when null is passed (row deleted, scalar nulled)', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: null,
      });

      expect(updated.recurrence).toBeNull();
      expect(updated.recurrenceId).toBeNull();

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id } });
      expect(row!.recurrenceId).toBeNull();
      expect(await prisma.calendarRecurrence.count({ where: { eventId: created.id } })).toBe(0);
    });

    it('clears the recurrence on a legacy row whose scalar is null (regression)', async () => {
      // Simulate pre-fix data: the rule row exists but the event's recurrenceId
      // scalar was never set. The service must find the rule via the relation.
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Legacy weekly',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });
      await prisma.calendarEvent.update({ where: { id: created.id }, data: { recurrenceId: null } });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: null,
      });

      expect(updated.recurrence).toBeNull();
      expect(await prisma.calendarRecurrence.count({ where: { eventId: created.id } })).toBe(0);
    });

    it('updates scalar fields without touching the rule', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        title: 'Renamed inspection',
      });

      expect(updated.title).toBe('Renamed inspection');

      const rule = await prisma.calendarRecurrence.findUnique({ where: { eventId: created.id } });
      expect(rule!.frequency).toBe('WEEKLY'); // unchanged
    });

    it('rejects MEMBER role with ForbiddenError', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
      });

      await expect(
        CalendarEventService.updateEvent(makeCtx('MEMBER'), created.id, { title: 'Nope' })
      ).rejects.toThrow(ForbiddenError);

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id } });
      expect(row!.title).toBe('One-off'); // unchanged
    });
  });

  // -------------------------------------------------------------------------
  // deleteEvent
  // -------------------------------------------------------------------------

  describe('deleteEvent', () => {
    it('deletes a recurring event and its rule (regression: FK Restrict)', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      await CalendarEventService.deleteEvent(makeCtx('TENANT_ADMIN'), created.id);

      expect(await prisma.calendarEvent.findUnique({ where: { id: created.id } })).toBeNull();
      expect(await prisma.calendarRecurrence.count({ where: { eventId: created.id } })).toBe(0);
    });

    it('deletes a non-recurring event', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
      });

      await CalendarEventService.deleteEvent(makeCtx('TENANT_ADMIN'), created.id);
      expect(await prisma.calendarEvent.findUnique({ where: { id: created.id } })).toBeNull();
    });

    it('rejects MEMBER role and leaves the event intact', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off',
        startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'),
        calendarId,
      });

      await expect(CalendarEventService.deleteEvent(makeCtx('MEMBER'), created.id)).rejects.toThrow(ForbiddenError);

      expect(await prisma.calendarEvent.findUnique({ where: { id: created.id } })).not.toBeNull();
    });

    it('throws NotFoundError for a missing event', async () => {
      await expect(
        CalendarEventService.deleteEvent(makeCtx('TENANT_ADMIN'), 'nonexistent-event-id')
      ).rejects.toThrow(NotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // getUpcomingEvents
  // -------------------------------------------------------------------------

  describe('getUpcomingEvents', () => {
    it('combines single and recurring instances without duplicates, sorted and limited', async () => {
      // Dates relative to now so the test stays valid over time
      const inTwoDays = new Date();
      inTwoDays.setDate(inTwoDays.getDate() + 2);
      inTwoDays.setHours(10, 0, 0, 0);

      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      fiveDaysAgo.setHours(9, 0, 0, 0);

      const single = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Upcoming one-off',
        startDate: inTwoDays,
        endDate: new Date(inTwoDays.getTime() + 60 * 60 * 1000),
        calendarId,
      });

      const series = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup',
        startDate: fiveDaysAgo,
        endDate: new Date(fiveDaysAgo.getTime() + 60 * 60 * 1000),
        calendarId,
        recurrence: { frequency: 'DAILY', interval: 1 },
      });

      // Generous limit so our events are never sliced out by data from other orgs
      const result = await CalendarEventService.getUpcomingEvents(makeCtx('TENANT_ADMIN'), testOrgId, 100);

      expect(result.length).toBeLessThanOrEqual(100);

      // Sorted ascending by start date
      for (let i = 1; i < result.length; i++) {
        expect(result[i].startDate.getTime()).toBeGreaterThanOrEqual(result[i - 1].startDate.getTime());
      }

      // No duplicate instances (id + start date) — a non-recurring event must
      // not appear from both the single-event and recurring queries
      const keys = result.map((e) => `${e.id}:${e.startDate.getTime()}`);
      expect(new Set(keys).size).toBe(keys.length);

      // The single event is present exactly once (no double counting)
      expect(result.filter((e) => e.id === single.id)).toHaveLength(1);

      // The daily series is expanded into instances within the 30-day window,
      // each carrying its rule details
      const myInstances = result.filter((e) => e.id === series.id);
      expect(myInstances.length).toBeGreaterThanOrEqual(1);
      for (const inst of myInstances) {
        expect(inst.recurrence?.frequency).toBe('DAILY');
      }
    });

    it('respects the limit', async () => {
      // A daily series started in the past guarantees more instances than the limit
      const fiveDaysAgo = new Date();
      fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
      fiveDaysAgo.setHours(9, 0, 0, 0);

      await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup',
        startDate: fiveDaysAgo,
        endDate: new Date(fiveDaysAgo.getTime() + 60 * 60 * 1000),
        calendarId,
        recurrence: { frequency: 'DAILY', interval: 1 },
      });

      const result = await CalendarEventService.getUpcomingEvents(makeCtx('TENANT_ADMIN'), testOrgId, 5);
      expect(result.length).toBe(5);
    });

    it('throws ValidationError without an organization context', async () => {
      await expect(
        CalendarEventService.getUpcomingEvents({ userId: 'user-1', role: 'TENANT_ADMIN' })
      ).rejects.toThrow(ValidationError);
    });
  });

  // -------------------------------------------------------------------------
  // Database constraints (document why the service deletes children first)
  // -------------------------------------------------------------------------

  describe('database constraints', () => {
    it('enforces a single recurrence row per event (unique eventId)', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      await expect(
        prisma.calendarRecurrence.create({
          data: { frequency: 'DAILY', interval: 1, eventId: created.id, organizationId: testOrgId },
        })
      ).rejects.toThrow();

      expect(await prisma.calendarRecurrence.count({ where: { eventId: created.id } })).toBe(1);
    });

    it('restricts deleting an event that still has a recurrence row', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection',
        startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'),
        calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      // Direct delete must fail — the CalendarRecurrence.event relation is
      // Restrict. This is why CalendarEventService.deleteEvent removes the rule first.
      await expect(prisma.calendarEvent.delete({ where: { id: created.id } })).rejects.toThrow();

      // The event is still there; clean up the way the service does
      await prisma.calendarRecurrence.deleteMany({ where: { eventId: created.id } });
      await prisma.calendarEvent.delete({ where: { id: created.id } });

      expect(await prisma.calendarEvent.findUnique({ where: { id: created.id } })).toBeNull();
    });
  });
});

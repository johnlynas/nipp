/**
 * Integration tests: CalendarEventService.updateEvent.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { ServiceContext } from '@/lib/services/types';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

describe('Calendar Events Integration — update', () => {
  let testOrgId: string;
  let calendarId: string;
  const createdOrgIds: string[] = [];

  const makeCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'): ServiceContext => ({
    userId: 'user-1', role, organizationId: testOrgId,
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Test Calendar Org', slug: `test-cal-org-update-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'ACTIVE' },
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
  // updateEvent — recurrence changes
  // -------------------------------------------------------------------------

  describe('updateEvent', () => {
    it('updates rrule JSON when changing an existing recurrence', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'MONTHLY', interval: 2 },
      });

      expect(updated.recurrence?.frequency).toBe('MONTHLY');
      expect(updated.recurrence?.interval).toBe(2);

      // Verify rrule JSON was updated
      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
      expect(parsed.freq).toBe('MONTHLY');
      expect(parsed.interval).toBe(2);
    });

    it('adds recurrence to a non-recurring event via rrule JSON', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      expect(updated.recurrence).not.toBeNull();
      expect(updated.recurrence?.frequency).toBe('WEEKLY');

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      expect(row!.rrule).not.toBeNull();
    });

    it('clears rrule JSON and exdates when recurrence is set to null', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: null,
      });

      expect(updated.recurrence).toBeNull();

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true, exdates: true } });
      expect(row!.rrule).toBeNull();
    });

    it('updates scalar fields without touching rrule JSON', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
        endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        title: 'Renamed inspection', description: 'Updated description',
      });

      expect(updated.title).toBe('Renamed inspection');
      expect((updated as any).description).toBe('Updated description');

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
      expect(parsed.freq).toBe('WEEKLY'); // unchanged
    });

    it('rejects MEMBER role with ForbiddenError', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      await expect(
        CalendarEventService.updateEvent(makeCtx('MEMBER'), created.id, { title: 'Nope' })
      ).rejects.toThrow(ForbiddenError);

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id } });
      expect(row!.title).toBe('One-off'); // unchanged
    });

    it('throws NotFoundError for a missing event', async () => {
      await expect(
        CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), 'nonexistent-event-id', { title: 'X' })
      ).rejects.toThrow(NotFoundError);
    });

    it('throws ValidationError for an empty title', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      await expect(
        CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, { title: '' })
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError when updated end date precedes start date', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      await expect(
        CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
          startDate: new Date('2026-08-17T12:00:00Z'),
          endDate: new Date('2026-08-17T10:00:00Z'),
        })
      ).rejects.toThrow(ValidationError);
    });

    it('stores recurrence end date and count in rrule JSON', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Bounded series', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T10:00:00Z'), calendarId,
      });

      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59Z'), count: 5 },
      });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
      expect(parsed.count).toBe(5);
    });

    it('appends excluded dates via top-level excludedDate field', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1, count: 5 },
      });

      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        excludedDate: '2026-08-19',
      });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { exdates: true } });
      const exdates = typeof row!.exdates === 'string' ? JSON.parse(row!.exdates) : (row!.exdates as string[]);
      expect(exdates).toContain('2026-08-19');
    });

    it('merges exdates from recurrence.excludedDates with existing ones', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1 },
      });

      // Add first exdate
      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, { excludedDate: '2026-08-19' });

      // Add second exdate via recurrence.excludedDates
      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'DAILY', excludedDates: ['2026-08-21'] },
      });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { exdates: true } });
      const exdates = typeof row!.exdates === 'string' ? JSON.parse(row!.exdates) : (row!.exdates as string[]);
      expect(exdates).toContain('2026-08-19');
      expect(exdates).toContain('2026-08-21');
    });

    it('maps byDay to byweekday in rrule JSON', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Bi-weekly Tue/Thu', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'WEEKLY', byDay: 'MO,WE' },
      });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
      expect(parsed.byweekday).toEqual(['MO', 'WE']);
    });

    it('maps byMonthDay to bymonthday in rrule JSON', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: '15th of month', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        recurrence: { frequency: 'MONTHLY', byMonthDay: 15 },
      });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { rrule: true } });
      const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
      expect(parsed.bymonthday).toEqual([15]);
    });

    it('combines title update with recurrence change', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        title: 'Renamed', recurrence: { frequency: 'WEEKLY' },
      });

      expect(updated.title).toBe('Renamed');
      expect(updated.recurrence?.frequency).toBe('WEEKLY');
    });

    it('deduplicates excluded dates when the same date is added twice', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'Daily standup', startDate: new Date('2026-08-17T09:00:00Z'),
        endDate: new Date('2026-08-17T09:30:00Z'), calendarId,
        recurrence: { frequency: 'DAILY', interval: 1 },
      });

      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, { excludedDate: '2026-08-19' });
      await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, { excludedDate: '2026-08-19' });

      const row = await prisma.calendarEvent.findUnique({ where: { id: created.id }, select: { exdates: true } });
      const exdates = typeof row!.exdates === 'string' ? JSON.parse(row!.exdates) : (row!.exdates as string[]);
      expect(exdates.filter((d: string) => d === '2026-08-19').length).toBe(1);
    });

    it('updates date fields (startDate, endDate)', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        startDate: new Date('2026-08-18T14:00:00Z'),
        endDate: new Date('2026-08-18T15:00:00Z'),
      });

      expect(updated.startDate.toISOString()).toBe('2026-08-18T14:00:00.000Z');
      expect(updated.endDate.toISOString()).toBe('2026-08-18T15:00:00.000Z');
    });

    it('updates eventType field', async () => {
      const created = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
        title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
        endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
      });

      const updated = await CalendarEventService.updateEvent(makeCtx('TENANT_ADMIN'), created.id, {
        eventType: 'MAINTENANCE',
      });

      expect(updated.eventType).toBe('MAINTENANCE');
    });
  });
});

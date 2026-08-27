/**
 * Integration tests: CalendarEventService.createEvent — authorization, validation, rrule JSON writes.
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { CalendarEventService } from '@/services/calendar-event-service';
import type { ServiceContext } from '@/lib/services/types';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

describe('Calendar Events Integration — createEvent', () => {
  let testOrgId: string;
  let calendarId: string;
  const createdOrgIds: string[] = [];

  const makeCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER'): ServiceContext => ({
    userId: 'user-1', role, organizationId: testOrgId,
  });

  beforeEach(async () => {
    const org = await prisma.organization.create({
      data: { name: 'Test Calendar Org', slug: `test-cal-org-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'ACTIVE' },
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

  // --- Authorization ---

  it('rejects MEMBER role with ForbiddenError and creates nothing', async () => {
    await expect(CalendarEventService.createEvent(makeCtx('MEMBER'), {
      title: 'Nope', startDate: new Date('2026-08-17T10:00:00Z'),
      endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
    })).rejects.toThrow(ForbiddenError);
    expect(await prisma.calendarEvent.count({ where: { organizationId: testOrgId } })).toBe(0);
  });

  // --- Validation ---

  it('throws ValidationError for an empty title', async () => {
    await expect(CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: '   ', startDate: new Date('2026-08-17T10:00:00Z'),
      endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
    })).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError when end date is before start date', async () => {
    await expect(CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Test', startDate: new Date('2026-08-17T11:00:00Z'),
      endDate: new Date('2026-08-17T10:00:00Z'), calendarId,
    })).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when the calendar does not exist', async () => {
    await expect(CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Test', startDate: new Date('2026-08-17T10:00:00Z'),
      endDate: new Date('2026-08-17T11:00:00Z'), calendarId: 'nonexistent-cal',
    })).rejects.toThrow(NotFoundError);
  });

  // --- Non-recurring events ---

  it('creates a non-recurring event with null rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'One-off viewing', startDate: new Date('2026-08-17T10:00:00Z'),
      endDate: new Date('2026-08-17T11:00:00Z'), calendarId, eventType: 'VIEWING',
    });

    expect(result.recurrence).toBeNull();

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    expect(row).not.toBeNull();
    expect(row!.rrule).toBeNull();
  });

  // --- Recurring events — rrule JSON writes ---

  it('writes valid rrule JSON for a WEEKLY recurring event', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
      endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
      recurrence: { frequency: 'WEEKLY', interval: 1 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    expect(row!.rrule).not.toBeNull();
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.freq).toBe('WEEKLY');
    expect(parsed.interval).toBe(1);
  });

  it('maps QUARTERLY to MONTHLY interval=3 in rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Quarterly review', startDate: new Date('2026-01-15T10:00:00Z'),
      endDate: new Date('2026-01-15T11:00:00Z'), calendarId,
      recurrence: { frequency: 'QUARTERLY', interval: 1 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.freq).toBe('MONTHLY');
    expect(parsed.interval).toBe(3);
  });

  it('maps SEMI_ANNUALLY to MONTHLY interval=6 in rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Semi-annual review', startDate: new Date('2026-01-15T10:00:00Z'),
      endDate: new Date('2026-01-15T11:00:00Z'), calendarId,
      recurrence: { frequency: 'SEMI_ANNUALLY', interval: 1 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.freq).toBe('MONTHLY');
    expect(parsed.interval).toBe(6);
  });

  it('maps byDay to byweekday in rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Bi-weekly MO/WE', startDate: new Date('2026-01-05T10:00:00Z'),
      endDate: new Date('2026-01-05T11:00:00Z'), calendarId,
      recurrence: { frequency: 'WEEKLY', byDay: 'MO,WE' },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.byweekday).toEqual(['MO', 'WE']);
  });

  it('maps byMonthDay to bymonthday in rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Monthly on 15th', startDate: new Date('2026-01-15T10:00:00Z'),
      endDate: new Date('2026-01-15T11:00:00Z'), calendarId,
      recurrence: { frequency: 'MONTHLY', byMonthDay: 15 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.bymonthday).toEqual([15]);
  });

  it('stores recurrence end date and count in rrule JSON', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Bounded series', startDate: new Date('2026-08-17T09:00:00Z'),
      endDate: new Date('2026-08-17T10:00:00Z'), calendarId,
      recurrence: { frequency: 'DAILY', interval: 1, endDate: new Date('2026-08-19T23:59:59Z'), count: 5 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const parsed = typeof row!.rrule === 'string' ? JSON.parse(row!.rrule) : row!.rrule;
    expect(parsed.count).toBe(5);
  });

  it('writes empty exdates array for recurring events', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Weekly standup', startDate: new Date('2026-01-05T10:00:00Z'),
      endDate: new Date('2026-01-05T11:00:00Z'), calendarId,
      recurrence: { frequency: 'WEEKLY', interval: 1 },
    });

    const row = await prisma.calendarEvent.findUnique({ where: { id: result.id } });
    const exdates = typeof row!.exdates === 'string' ? JSON.parse(row!.exdates) : row!.exdates;
    expect(exdates).toEqual([]);
  });

  // --- Output shape ---

  it('returns recurrence details in the response for recurring events', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'Weekly inspection', startDate: new Date('2026-05-18T10:00:00Z'),
      endDate: new Date('2026-05-18T11:30:00Z'), calendarId,
      recurrence: { frequency: 'WEEKLY', interval: 1 },
    });

    expect(result.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, endDate: null, count: null, byDay: null, byMonthDay: null, excludedDates: [] });
  });

  it('returns recurrence: null for non-recurring events', async () => {
    const result = await CalendarEventService.createEvent(makeCtx('TENANT_ADMIN'), {
      title: 'One-off', startDate: new Date('2026-08-17T10:00:00Z'),
      endDate: new Date('2026-08-17T11:00:00Z'), calendarId,
    });

    expect(result.recurrence).toBeNull();
  });
});

/**
 * Unit tests for calendar-utils — date math, recurrence expansion, and display helpers.
 */

import { describe, it, expect } from 'vitest';
import {
  getEventIcon,
  getEventColor,
  generateMonthGrid,
  generateMonthDays,
  generateWeekGrid,
  generateHourlySlots,
  getEventInstanceKey,
  formatDate,
  formatDateTime,
  formatTime,
  isSameDay,
  getMonthName,
  getDaysInMonth,
  getFirstDayOfMonth,
  getRecurrenceLabel,
  getRecurrenceEndDateLabel,
  getEventPosition,
  getEventSpan,
  generateYearMonths,
} from '@/components/calendar/calendar-utils';
import type { RecurringEvent } from '@/components/calendar/calendar-utils';
import type { RecurrenceFrequency } from '@/lib/recurrence';
import type { CalendarEvent } from '@/components/calendar/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEvent = (overrides: Partial<RecurringEvent> = {}): RecurringEvent => ({
  id: 'event-1',
  title: 'Test Event',
  description: null,
  startDate: new Date('2026-08-17T10:00:00'),
  endDate: new Date('2026-08-17T11:00:00'),
  eventType: 'OTHER',
  color: null,
  propertyId: null,
  createdAt: new Date('2026-01-01T00:00:00'),
  updatedAt: new Date('2026-01-01T00:00:00'),
  recurrence: null,
  ...overrides,
});

const makeCalEvent = (overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: 'event-1',
  title: 'Test Event',
  description: null,
  startDate: new Date('2026-08-17T10:00:00'),
  endDate: new Date('2026-08-17T11:00:00'),
  eventType: 'OTHER',
  color: null,
  calendarId: 'cal-1',
  propertyId: null,
  createdAt: new Date('2026-01-01T00:00:00'),
  updatedAt: new Date('2026-01-01T00:00:00'),
  recurrence: null,
  ...overrides,
});

describe('calendar-utils', () => {
  // -------------------------------------------------------------------------
  // Event type mappings
  // -------------------------------------------------------------------------

  describe('getEventIcon', () => {
    it('maps every event type to an icon name', () => {
      expect(getEventIcon('VIEWING')).toBe('Home');
      expect(getEventIcon('INSPECTION')).toBe('ClipboardList');
      expect(getEventIcon('MAINTENANCE')).toBe('Wrench');
      expect(getEventIcon('LEASE_SIGNING')).toBe('FileText');
      expect(getEventIcon('LEASE_RENEWAL')).toBe('RefreshCw');
      expect(getEventIcon('KEY_EXCHANGE')).toBe('Key');
      expect(getEventIcon('OTHER')).toBe('Calendar');
    });
  });

  describe('getEventColor', () => {
    it('maps every event type to a hex color', () => {
      const colors = [
        getEventColor('VIEWING'),
        getEventColor('INSPECTION'),
        getEventColor('MAINTENANCE'),
        getEventColor('LEASE_SIGNING'),
        getEventColor('LEASE_RENEWAL'),
        getEventColor('KEY_EXCHANGE'),
        getEventColor('OTHER'),
      ];
      // Colors are hex literals or CSS design-token vars (both resolve to the
      // Property NI palette via app/globals.css).
      for (const color of colors) {
        expect(color).toMatch(/^(#[0-9A-Fa-f]{6}|var\(--color-[a-z0-9-]+\))$/);
      }
    });

    it('returns distinct colors for each event type', () => {
      const types = ['VIEWING', 'INSPECTION', 'MAINTENANCE', 'LEASE_SIGNING', 'LEASE_RENEWAL', 'KEY_EXCHANGE', 'OTHER'] as const;
      const colors = types.map(getEventColor);
      expect(new Set(colors).size).toBe(types.length);
    });
  });

  // -------------------------------------------------------------------------
  // Grid generation
  // -------------------------------------------------------------------------

  describe('generateMonthGrid', () => {
    it('starts the grid on a Sunday', () => {
      const grid = generateMonthGrid(2026, 7); // August 2026

      expect(grid.length).toBeGreaterThanOrEqual(5);
      expect(grid[0][0].getDay()).toBe(0); // Sunday
    });

    it('covers the full month', () => {
      const grid = generateMonthGrid(2026, 7); // August 2026
      const flat = grid.flat();

      expect(flat.some((d) => d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 1)).toBe(true);
      expect(flat.some((d) => d.getFullYear() === 2026 && d.getMonth() === 7 && d.getDate() === 31)).toBe(true);
    });

    it('produces rows of exactly 7 days in chronological order', () => {
      const grid = generateMonthGrid(2026, 7);

      for (const week of grid) {
        expect(week).toHaveLength(7);
        for (let i = 1; i < week.length; i++) {
          const diffDays = (week[i].getTime() - week[i - 1].getTime()) / 86400000;
          expect(diffDays).toBeCloseTo(1, 5);
        }
      }
    });
  });

  describe('generateMonthDays', () => {
    it('marks only days of the requested month as current-month', () => {
      const days = generateMonthDays(2026, 7); // August 2026

      expect(days.length).toBeGreaterThan(28);
      for (const { date, isCurrentMonth } of days) {
        expect(isCurrentMonth).toBe(date.getFullYear() === 2026 && date.getMonth() === 7);
      }
    });

    it('starts on a Sunday', () => {
      const days = generateMonthDays(2026, 7);
      expect(days[0].date.getDay()).toBe(0);
    });
  });

  describe('generateWeekGrid', () => {
    it('returns 7 consecutive days starting on Sunday', () => {
      const reference = new Date(2026, 7, 19); // Wednesday
      const week = generateWeekGrid(reference);

      expect(week).toHaveLength(7);
      expect(week[0].getDay()).toBe(0); // Sunday
      expect(week[0].getDate()).toBe(16); // 2026-08-16
      expect(week[6].getDate()).toBe(22); // 2026-08-22
    });
  });

  describe('generateHourlySlots', () => {
    it('returns hours 0-23', () => {
      expect(generateHourlySlots()).toEqual(Array.from({ length: 24 }, (_, i) => i));
    });
  });

  // -------------------------------------------------------------------------
  // Instance identity
  // -------------------------------------------------------------------------

  describe('getEventInstanceKey', () => {
    it('produces different keys for instances of the same recurring event', () => {
      const base = makeEvent();
      const instanceA = { ...base, startDate: new Date('2026-08-17T10:00:00') };
      const instanceB = { ...base, startDate: new Date('2026-08-24T10:00:00') };

      expect(getEventInstanceKey(instanceA)).not.toBe(getEventInstanceKey(instanceB));
    });

    it('produces the same key for identical id + start date', () => {
      const base = makeEvent();
      expect(getEventInstanceKey(base)).toBe(getEventInstanceKey({ ...base }));
    });

    it('handles string start dates', () => {
      const key = getEventInstanceKey({ id: 'e1', startDate: '2026-08-17T10:00:00.000Z' });
      expect(key).toBe('e1:2026-08-17T10:00:00.000Z');
    });

    it('distinguishes events with the same start date but different ids', () => {
      const a = makeEvent({ id: 'a' });
      const b = makeEvent({ id: 'b' });
      expect(getEventInstanceKey(a)).not.toBe(getEventInstanceKey(b));
    });
  });

  // -------------------------------------------------------------------------
  // Date formatting helpers
  // -------------------------------------------------------------------------

  describe('formatDate', () => {
    it('formats as day + short month (en-GB)', () => {
      expect(formatDate(new Date(2026, 7, 17))).toBe('17 Aug');
    });
  });

  describe('formatDateTime', () => {
    it('includes weekday, day, month and year', () => {
      expect(formatDateTime(new Date(2026, 7, 17))).toBe('Mon, 17 Aug 2026');
    });
  });

  describe('formatTime', () => {
    it('formats as 24h HH:MM (en-GB)', () => {
      expect(formatTime(new Date(2026, 7, 17, 9, 5))).toBe('09:05');
      expect(formatTime(new Date(2026, 7, 17, 14, 30))).toBe('14:30');
    });
  });

  describe('isSameDay', () => {
    it('returns true for the same calendar day regardless of time', () => {
      expect(isSameDay(new Date(2026, 7, 17, 1, 0), new Date(2026, 7, 17, 23, 59))).toBe(true);
    });

    it('returns false for different days', () => {
      expect(isSameDay(new Date(2026, 7, 17), new Date(2026, 7, 18))).toBe(false);
    });
  });

  describe('getMonthName', () => {
    it('returns the long month name for each index', () => {
      expect(getMonthName(0)).toBe('January');
      expect(getMonthName(7)).toBe('August');
      expect(getMonthName(11)).toBe('December');
    });
  });

  describe('getDaysInMonth', () => {
    it('returns the correct day count including February in leap years', () => {
      expect(getDaysInMonth(2026, 7)).toBe(31); // August
      expect(getDaysInMonth(2026, 1)).toBe(28); // February (non-leap)
      expect(getDaysInMonth(2028, 1)).toBe(29); // February (leap)
      expect(getDaysInMonth(2026, 3)).toBe(30); // April
    });
  });

  describe('getFirstDayOfMonth', () => {
    it('returns the weekday of the first day (0=Sunday)', () => {
      expect(getFirstDayOfMonth(2026, 7)).toBe(new Date(2026, 7, 1).getDay());
    });
  });

  // -------------------------------------------------------------------------
  // Recurrence display helpers
  // -------------------------------------------------------------------------

  describe('getRecurrenceLabel', () => {
    it('returns the plain frequency label for interval 1', () => {
      expect(getRecurrenceLabel('DAILY', 1)).toBe('Daily');
      expect(getRecurrenceLabel('WEEKLY', 1)).toBe('Weekly');
      expect(getRecurrenceLabel('MONTHLY', 1)).toBe('Monthly');
      expect(getRecurrenceLabel('QUARTERLY', 1)).toBe('Quarterly');
      expect(getRecurrenceLabel('SEMI_ANNUALLY', 1)).toBe('Semi-Annually');
      expect(getRecurrenceLabel('ANNUALLY', 1)).toBe('Annually');
    });

    it('returns "Every N <frequency>" for interval > 1', () => {
      expect(getRecurrenceLabel('WEEKLY', 2)).toBe('Every 2 weekly');
      expect(getRecurrenceLabel('MONTHLY', 3)).toBe('Every 3 monthly');
    });

    it('falls back to the raw frequency for unknown values', () => {
      expect(getRecurrenceLabel('HOURLY' as RecurrenceFrequency, 1)).toBe('HOURLY');
    });
  });

  describe('getRecurrenceEndDateLabel', () => {
    it('returns an "Ends <date>" label for an end date', () => {
      expect(getRecurrenceEndDateLabel(new Date(2026, 11, 31), null)).toBe('Ends 31 Dec');
    });

    it('returns an "Ends after N occurrences" label for a count', () => {
      expect(getRecurrenceEndDateLabel(null, 10)).toBe('Ends after 10 occurrences');
    });

    it('prefers the end date over the count', () => {
      expect(getRecurrenceEndDateLabel(new Date(2026, 11, 31), 10)).toBe('Ends 31 Dec');
    });

    it('returns an empty string when neither is set', () => {
      expect(getRecurrenceEndDateLabel(null, null)).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Drag-and-drop helpers
  // -------------------------------------------------------------------------

  describe('getEventPosition', () => {
    it('positions events at 64px per hour from the start time', () => {
      const event = makeEvent({
        startDate: new Date(2026, 7, 17, 9, 30),
        endDate: new Date(2026, 7, 17, 11, 0),
      });

      const { top, height } = getEventPosition(event);

      expect(top).toBe(9.5 * 64);
      expect(height).toBe(1.5 * 64);
    });

    it('enforces a minimum height of 30 minutes', () => {
      const event = makeEvent({
        startDate: new Date(2026, 7, 17, 9, 58),
        endDate: new Date(2026, 7, 17, 9, 59),
      });

      expect(getEventPosition(event).height).toBe(0.5 * 64);
    });

    it('clamps inverted end times to the minimum height', () => {
      const event = makeEvent({
        startDate: new Date(2026, 7, 17, 11, 0),
        endDate: new Date(2026, 7, 17, 9, 0),
      });

      expect(getEventPosition(event).height).toBe(0.5 * 64);
    });
  });

  describe('getEventSpan', () => {
    it('returns an empty span for single-day events', () => {
      const event = makeEvent({
        startDate: new Date(2026, 7, 19, 10, 0),
        endDate: new Date(2026, 7, 19, 11, 0),
      });

      expect(getEventSpan(event)).toEqual({});
    });

    it('returns start/end weekday columns for multi-day events', () => {
      // 2026-08-19 is a Wednesday, 2026-08-21 is a Friday
      const event = makeEvent({
        startDate: new Date(2026, 7, 19, 0, 0),
        endDate: new Date(2026, 7, 21, 23, 59),
      });

      expect(getEventSpan(event)).toEqual({ startCol: 3, endCol: 5 });
    });
  });

  // -------------------------------------------------------------------------
  // Year view generation
  // -------------------------------------------------------------------------

  describe('generateYearMonths', () => {
    it('returns 12 month summaries with correct names, day counts and start weekdays', () => {
      const months = generateYearMonths(2026);

      expect(months).toHaveLength(12);
      expect(months[0].name).toBe('January');
      expect(months[11].name).toBe('December');
      expect(months[0].daysInMonth).toBe(31);
      expect(months[1].daysInMonth).toBe(28); // 2026 is not a leap year
      expect(months[0].firstDayOfWeek).toBe(4); // Jan 1, 2026 is a Thursday
      expect(months[1].firstDayOfWeek).toBe(0); // Feb 1, 2026 is a Sunday
    });

    it('reports 29 days in February for leap years', () => {
      const months = generateYearMonths(2028);

      expect(months[1].daysInMonth).toBe(29);
    });

    it('returns empty event maps when no events are provided', () => {
      for (const m of generateYearMonths(2026)) {
        expect(m.eventsByDay.size).toBe(0);
        expect(m.totalEvents).toBe(0);
      }
    });

    it('records single-day events on the correct day of the correct month', () => {
      const event = makeCalEvent({
        startDate: new Date(2026, 2, 15, 10, 0),
        endDate: new Date(2026, 2, 15, 11, 0),
      });

      const months = generateYearMonths(2026, [event]);

      expect(months[2].eventsByDay.get(15)).toEqual([event]);
      expect(months[2].totalEvents).toBe(1);
      expect(months[0].totalEvents).toBe(0);
    });

    it('spans multi-day events across days and months, counting once per month', () => {
      const event = makeCalEvent({
        startDate: new Date(2026, 0, 30, 9, 0),
        endDate: new Date(2026, 1, 2, 17, 0),
      });

      const months = generateYearMonths(2026, [event]);

      expect(months[0].eventsByDay.get(30)).toEqual([event]);
      expect(months[0].eventsByDay.get(31)).toEqual([event]);
      expect(months[1].eventsByDay.get(1)).toEqual([event]);
      expect(months[1].eventsByDay.get(2)).toEqual([event]);
      expect(months[0].totalEvents).toBe(1);
      expect(months[1].totalEvents).toBe(1);
    });

    it('deduplicates recurring instances by instance key but keeps distinct occurrences', () => {
      const a = makeCalEvent({
        id: 'rec-1',
        startDate: new Date(2026, 4, 10, 10, 0),
        endDate: new Date(2026, 4, 10, 11, 0),
      });
      const aDuplicate = { ...a }; // same id + start → same instance key
      const b: CalendarEvent = {
        ...a,
        startDate: new Date(2026, 4, 17, 10, 0),
        endDate: new Date(2026, 4, 17, 11, 0),
      };

      const months = generateYearMonths(2026, [a, aDuplicate, b]);

      expect(months[4].eventsByDay.get(10)).toHaveLength(1);
      expect(months[4].eventsByDay.get(17)).toHaveLength(1);
      expect(months[4].totalEvents).toBe(2); // two distinct instances, dup dropped
    });

    it('ignores events that fall entirely outside the requested year', () => {
      const event = makeCalEvent({
        startDate: new Date(2025, 11, 31, 10, 0),
        endDate: new Date(2025, 11, 31, 11, 0),
      });

      const months = generateYearMonths(2026, [event]);

      expect(months[11].totalEvents).toBe(0);
    });

    it('clips events that start before the year to Jan 1', () => {
      const event = makeCalEvent({
        startDate: new Date(2025, 11, 30, 10, 0),
        endDate: new Date(2026, 0, 3, 10, 0),
      });

      const months = generateYearMonths(2026, [event]);

      expect(months[0].eventsByDay.get(1)).toEqual([event]);
      expect(months[0].eventsByDay.get(3)).toEqual([event]);
      expect(months[0].totalEvents).toBe(1);
      expect(months[1].totalEvents).toBe(0); // ends Jan 3 — not in February
    });

    it('skips events with invalid dates', () => {
      const event = makeCalEvent({
        startDate: new Date('not-a-date'),
        endDate: new Date('nope'),
      });

      const months = generateYearMonths(2026, [event]);

      for (const m of months) {
        expect(m.totalEvents).toBe(0);
      }
    });
  });
});

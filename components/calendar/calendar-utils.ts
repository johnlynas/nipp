/**
 * Pure utility functions for date math, recurrence expansion, and event type mapping.
 *
 * Recurrence logic is consolidated in lib/recurrence.ts — this file re-exports
 * those helpers and provides calendar-specific utilities (grid generation, drag-and-drop).
 */

import { CalendarEvent, CalendarEventType } from './types';
import * as recurrence from '@/lib/recurrence';

// Re-export for backwards compatibility — consumers can import directly from here.
export {
  advanceDate,
  formatDate,
  formatDateTime,
  formatTime,
  isSameDay,
  isToday,
  toLocalDateTimeInputValue,
  toLocalDateInputValue,
  parseLocalDateInputValue,
  getRecurrenceLabel,
  getRecurrenceEndDateLabel,
  getEventInstanceKey,
} from '@/lib/recurrence';

// Local bindings for use in CalendarUtils object and internally.
const {
  advanceDate: _advanceDate,
  expandRecurrence: _expandRecurrence,
  formatDate: _formatDate,
  formatDateTime: _formatDateTime,
  formatTime: _formatTime,
  isSameDay: _isSameDay,
  isToday: _isToday,
  toLocalDateTimeInputValue: _toLocalDateTimeInputValue,
  toLocalDateInputValue: _toLocalDateInputValue,
  parseLocalDateInputValue: _parseLocalDateInputValue,
  getRecurrenceLabel: _getRecurrenceLabel,
  getRecurrenceEndDateLabel: _getRecurrenceEndDateLabel,
  getEventInstanceKey: _getEventInstanceKey,
} = recurrence;

// ---------------------------------------------------------------------------
// Adapter: old calendar-utils expandRecurrence signature (rule on event) → lib
// ---------------------------------------------------------------------------

/**
 * Adapter for the old expandRecurrence signature where the recurrence rule was
 * embedded in `event.recurrence`.  The lib version takes a separate 4th arg.
 */
export function expandRecurrence<T extends { startDate: Date; endDate: Date }>(
  event: T,
  rangeStart: Date,
  rangeEnd: Date,
): T[] {
  const rule = (event as any).recurrence ?? undefined;
  return _expandRecurrence(event, rangeStart, rangeEnd, rule);
}

// ---------------------------------------------------------------------------
// Event type to icon mapping (lucide-react component names)
// ---------------------------------------------------------------------------

export function getEventIcon(eventType: CalendarEventType): string {
  switch (eventType) {
    case 'VIEWING': return 'Home';
    case 'INSPECTION': return 'ClipboardList';
    case 'MAINTENANCE': return 'Wrench';
    case 'LEASE_SIGNING': return 'FileText';
    case 'LEASE_RENEWAL': return 'RefreshCw';
    case 'KEY_EXCHANGE': return 'Key';
    case 'OTHER': return 'Calendar';
  }
}

// ---------------------------------------------------------------------------
// Event type to color mapping (Property NI palette)
// ---------------------------------------------------------------------------

export function getEventColor(eventType: CalendarEventType): string {
  switch (eventType) {
    case 'VIEWING': return '#2A9D8F';   // Teal
    case 'INSPECTION': return '#F5A623'; // Amber
    case 'MAINTENANCE': return '#E76F51'; // Orange
    case 'LEASE_SIGNING': return '#1B2A4A'; // Navy
    case 'LEASE_RENEWAL': return '#7B68AE'; // Purple
    case 'KEY_EXCHANGE': return '#D4A017'; // Gold
    case 'OTHER': return '#6C757D';      // Gray
  }
}

// ---------------------------------------------------------------------------
// Month grid generation
// ---------------------------------------------------------------------------

/**
 * Generate a 7-column month grid starting from the Sunday of the week containing
 * the first day of the given month.
 */
export function generateMonthGrid(year: number, month: number): Date[][] {
  const grid: Date[][] = [];

  // First day of the month
  const firstDay = new Date(year, month, 1);
  // Day of week (0=Sunday, 6=Saturday)
  const startDayOfWeek = firstDay.getDay();

  // Start from the Sunday of the week containing the 1st
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDayOfWeek);

  // Generate 6 rows (42 cells max)
  for (let row = 0; row < 6; row++) {
    const week: Date[] = [];
    for (let col = 0; col < 7; col++) {
      const cellDate = new Date(startDate);
      cellDate.setDate(cellDate.getDate() + row * 7 + col);
      week.push(cellDate);
    }

    // Push first so the row containing the last day of the month is never
    // dropped, then stop once we've gone past it by more than a week.
    const lastDayOfMonth = new Date(year, month + 1, 0);
    grid.push(week);
    if (week[6] > lastDayOfMonth && row >= 4) {
      break;
    }
  }

  return grid;
}

/**
 * Get the days of a month as a flat array with previous/next month padding.
 */
export function generateMonthDays(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  // First day of the month
  const firstDay = new Date(year, month, 1);
  const startDayOfWeek = firstDay.getDay();

  // Start from the Sunday of the week containing the 1st
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - startDayOfWeek);

  const lastDayOfMonth = new Date(year, month + 1, 0);

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(startDate);
    cellDate.setDate(cellDate.getDate() + i);

    days.push({
      date: cellDate,
      isCurrentMonth: cellDate.getMonth() === month && cellDate.getFullYear() === year,
    });
  }

  return days;
}

// ---------------------------------------------------------------------------
// Week grid generation
// ---------------------------------------------------------------------------

/**
 * Generate a 7-day week grid starting from the Sunday of the given date's week.
 */
export function generateWeekGrid(referenceDate: Date): Date[] {
  const grid: Date[] = [];

  // Start from the Sunday of this week
  const startDate = new Date(referenceDate);
  startDate.setDate(startDate.getDate() - startDate.getDay());

  for (let i = 0; i < 7; i++) {
    const day = new Date(startDate);
    day.setDate(day.getDate() + i);
    grid.push(day);
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Day view helpers
// ---------------------------------------------------------------------------

/**
 * Generate hourly time slots for a day (0-23).
 */
export function generateHourlySlots(): number[] {
  return Array.from({ length: 24 }, (_, i) => i);
}

// ---------------------------------------------------------------------------
export interface RecurringEvent {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: CalendarEventType;
  color?: string | null;
  recurrenceId?: string | null;
  propertyId?: string | null;
  createdAt: Date;
  updatedAt: Date;
  recurrence?: { frequency: string; interval: number; endDate?: Date | null; count?: number | null } | null;
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

export function getMonthName(month: number): string {
  return new Date(2000, month).toLocaleDateString('en-GB', { month: 'long' });
}

export function getYear(month: number, year?: number): number {
  return year ?? new Date().getFullYear();
}

export function getDayName(dayIndex: number): string {
  return new Date(2000, 0, dayIndex + 1).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function getFirstDayOfMonth(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

// ---------------------------------------------------------------------------
// Year view generation
// ---------------------------------------------------------------------------

export interface YearMonthSummary {
  /** 0-based month index (0 = January). */
  month: number;
  name: string;
  daysInMonth: number;
  /** Day of week the month starts on (0 = Sunday). */
  firstDayOfWeek: number;
  /** Day-of-month (1-based) → events occurring on that day. */
  eventsByDay: Map<number, CalendarEvent[]>;
  /** Number of unique event instances overlapping this month. */
  totalEvents: number;
}

/**
 * Build per-month summaries for a year view. Events are deduplicated by
 * instance key (recurring instances share the base event id) and each day an
 * event spans within `year` is recorded in that month's summary. Events are
 * clipped to the requested year (an event starting before Jan 1 counts from
 * Jan 1).
 */
export function generateYearMonths(year: number, events: CalendarEvent[] = []): YearMonthSummary[] {
  const seen = new Set<string>();
  const validEvents: Array<{ event: CalendarEvent; start: Date; end: Date }> = [];
  for (const event of events) {
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    // Skip events with invalid dates before computing the instance key
    if (isNaN(start.getTime()) || isNaN(end.getTime())) continue;

    const key = _getEventInstanceKey(event);
    if (!seen.has(key)) {
      seen.add(key);
      validEvents.push({ event, start, end });
    }
  }

  const summaries: YearMonthSummary[] = Array.from({ length: 12 }, (_, month) => ({
    month,
    name: getMonthName(month),
    daysInMonth: getDaysInMonth(year, month),
    firstDayOfWeek: getFirstDayOfMonth(year, month),
    eventsByDay: new Map<number, CalendarEvent[]>(),
    totalEvents: 0,
  }));

  const monthKeys: Set<string>[] = Array.from({ length: 12 }, () => new Set());
  const yearStart = new Date(year, 0, 1);

  for (const { event, start, end } of validEvents) {
    const key = _getEventInstanceKey(event);
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    if (cursor < yearStart) cursor = new Date(year, 0, 1);

    // Cap iteration so a malformed multi-year event cannot hang the view
    let steps = 0;
    while (cursor <= end && cursor.getFullYear() === year && steps < 366) {
      const summary = summaries[cursor.getMonth()];
      const dayEvents = summary.eventsByDay.get(cursor.getDate());
      if (dayEvents) {
        dayEvents.push(event);
      } else {
        summary.eventsByDay.set(cursor.getDate(), [event]);
      }
      monthKeys[cursor.getMonth()].add(key);
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      steps += 1;
    }
  }

  return summaries.map((summary, i) => ({ ...summary, totalEvents: monthKeys[i].size }));
}

// ---------------------------------------------------------------------------
// Drag-and-drop helpers
// ---------------------------------------------------------------------------

export function getEventPosition(event: RecurringEvent): { top: number; height: number } {
  const startHour = event.startDate.getHours() + event.startDate.getMinutes() / 60;
  const endHour = event.endDate.getHours() + event.endDate.getMinutes() / 60;
  const duration = Math.max(endHour - startHour, 0.5); // Minimum 30 min

  return {
    top: startHour * 64, // 64px per hour slot
    height: duration * 64,
  };
}

export function getEventSpan(event: RecurringEvent): { startCol?: number; endCol?: number } {
  const days: Date[] = [];
  let current = new Date(event.startDate);
  const end = event.endDate;

  while (current <= end) {
    days.push(new Date(current));
    const next = new Date(current);
    next.setDate(next.getDate() + 1);
    current = next;
  }

  if (days.length <= 1) return {};

  // Find the day index within a week grid
  const firstDayOfWeek = days[0].getDay();
  return {
    startCol: firstDayOfWeek,
    endCol: days[days.length - 1].getDay(),
  };
}

// ---------------------------------------------------------------------------
// Export all utilities
// ---------------------------------------------------------------------------

export const CalendarUtils = {
  getEventIcon,
  getEventColor,
  generateMonthGrid,
  generateMonthDays,
  generateWeekGrid,
  generateHourlySlots,
  expandRecurrence: expandRecurrence,
  formatDate: _formatDate,
  formatDateTime: _formatDateTime,
  formatTime: _formatTime,
  isSameDay: _isSameDay,
  isToday: _isToday,
  getMonthName,
  getYear,
  getDayName,
  getDaysInMonth,
  getFirstDayOfMonth,
  getEventInstanceKey: _getEventInstanceKey,
  generateYearMonths,
  getRecurrenceLabel: _getRecurrenceLabel,
  getRecurrenceEndDateLabel: _getRecurrenceEndDateLabel,
  getEventPosition,
  getEventSpan,
  toLocalDateTimeInputValue: _toLocalDateTimeInputValue,
  toLocalDateInputValue: _toLocalDateInputValue,
  parseLocalDateInputValue: _parseLocalDateInputValue,
};

export default CalendarUtils;

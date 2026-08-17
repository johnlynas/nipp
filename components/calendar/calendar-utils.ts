/**
 * Pure utility functions for date math, recurrence expansion, and event type mapping.
 */

import { CalendarEventType } from './types';

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

    // Stop after the last day of the month + 6 days (to fill the grid)
    if (cellDate > lastDayOfMonth && i >= 35) break;
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
// Recurrence expansion (pure function — mirrors service layer)
// ---------------------------------------------------------------------------

export interface RecurrenceRule {
  frequency: string;
  interval: number;
  endDate?: Date | null;
  count?: number | null;
}

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
  recurrence?: RecurrenceRule | null;
}

/**
 * Expand a recurring event into individual instances within the given date range.
 */
export function expandRecurrence(
  event: RecurringEvent,
  rangeStart: Date,
  rangeEnd: Date,
): RecurringEvent[] {
  const instances: RecurringEvent[] = [];

  if (!event.recurrence) {
    // Single event — check if it overlaps the range
    if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
      instances.push({ ...event });
    }
    return instances;
  }

  const { frequency, interval: freqInterval, endDate, count } = event.recurrence;
  let current = new Date(event.startDate);
  const maxOccurrences = 52 * 12; // Cap at ~10 years of weekly events
  let occurrenceCount = 0;

  // Each instance keeps the base event's duration (end - start)
  const durationMs = event.endDate.getTime() - event.startDate.getTime();

  while (current <= rangeEnd && occurrenceCount < maxOccurrences) {
    // Stop if past recurrence end date or count limit
    if (endDate && current > endDate) break;
    if (count != null && occurrenceCount >= count) break;

    // Check overlap with range — the instance end is shifted by duration so
    // later occurrences are not compared against the base event's absolute end
    const instanceEnd = new Date(current.getTime() + durationMs);
    if (current <= rangeEnd && instanceEnd >= rangeStart) {
      instances.push({ ...event, startDate: new Date(current), endDate: instanceEnd });
    }

    // Advance by frequency + interval
    current = advanceDate(current, frequency, freqInterval);
    occurrenceCount++;
  }

  return instances;
}

/**
 * Advance a date by the given frequency and interval.
 */
function advanceDate(date: Date, frequency: string, interval: number): Date {
  const result = new Date(date);

  switch (frequency) {
    case 'DAILY':
      result.setDate(result.getDate() + interval);
      break;
    case 'WEEKLY':
      result.setDate(result.getDate() + interval * 7);
      break;
    case 'MONTHLY':
      result.setMonth(result.getMonth() + interval);
      break;
    case 'QUARTERLY':
      result.setMonth(result.getMonth() + interval * 3);
      break;
    case 'SEMI_ANNUALLY':
      result.setMonth(result.getMonth() + interval * 6);
      break;
    case 'ANNUALLY':
      result.setFullYear(result.getFullYear() + interval);
      break;
    default:
      result.setDate(result.getDate() + 1);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Date formatting helpers
// ---------------------------------------------------------------------------

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatDateTime(date: Date): string {
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function isToday(date: Date): boolean {
  const today = new Date();
  return isSameDay(date, today);
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
// Instance identity (recurring events expand into multiple instances that
// share the base event id — use this key to dedupe and render them)
// ---------------------------------------------------------------------------

/**
 * Stable per-instance key for an event. For recurring events the API returns
 * one instance per occurrence, all sharing the base event id; combining the
 * id with the instance start date makes each occurrence unique.
 */
export function getEventInstanceKey(event: { id: string; startDate: Date | string }): string {
  const start = event.startDate instanceof Date ? event.startDate : new Date(event.startDate);
  return `${event.id}:${start.toISOString()}`;
}

// ---------------------------------------------------------------------------
// Recurrence display helpers
// ---------------------------------------------------------------------------

export function getRecurrenceLabel(frequency: string, interval: number): string {
  const labels: Record<string, string> = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    SEMI_ANNUALLY: 'Semi-Annually',
    ANNUALLY: 'Annually',
  };

  if (interval === 1) {
    return labels[frequency] || frequency;
  }

  return `Every ${interval} ${labels[frequency]?.toLowerCase() || frequency}`;
}

export function getRecurrenceEndDateLabel(endDate?: Date | null, count?: number | null): string {
  if (endDate) {
    return `Ends ${formatDate(endDate)}`;
  }
  if (count != null && count > 0) {
    return `Ends after ${count} occurrences`;
  }
  return '';
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
  expandRecurrence,
  formatDate,
  formatDateTime,
  formatTime,
  isSameDay,
  isToday,
  getMonthName,
  getYear,
  getDayName,
  getDaysInMonth,
  getFirstDayOfMonth,
  getEventInstanceKey,
  getRecurrenceLabel,
  getRecurrenceEndDateLabel,
  getEventPosition,
  getEventSpan,
};

export default CalendarUtils;

/**
 * Shared recurrence logic — the single source of truth for all calendar
 * recurrence expansion, date advancement, and display helpers.
 *
 * Both the service layer (services/calendar-event-service.ts) and the
 * frontend utilities (components/calendar/calendar-utils.ts) import from
 * here instead of maintaining their own copies.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecurrenceFrequency =
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI_ANNUALLY'
  | 'ANNUALLY';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate?: Date | null;
  count?: number | null;
}

/** Extended rule that includes day-of-week / day-of-month filters. */
export interface RecurrenceRuleWithFilters extends RecurrenceRule {
  byDay?: string | null;   // e.g. 'MO', 'TU' (ISO 8601 day abbreviations)
  byMonthDay?: number | null;
  /** ISO date strings (YYYY-MM-DD) to exclude from expansion. */
  excludedDates?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const RECURRENCE_FREQUENCIES: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUALLY', label: 'Semi-Annually' },
  { value: 'ANNUALLY', label: 'Annually' },
];

/** Maximum number of occurrences to expand (prevents runaway loops). */
export const MAX_OCCURRENCES = 52 * 12; // ~10 years of weekly events

// ---------------------------------------------------------------------------
// Date advancement
// ---------------------------------------------------------------------------

/**
 * Advance a date by the given frequency and interval.
 */
export function advanceDate(
  date: Date,
  frequency: RecurrenceFrequency,
  interval: number,
): Date {
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
// Recurrence expansion
// ---------------------------------------------------------------------------

/**
 * Expand a recurring event into individual instances within the given date range.
 */
export function expandRecurrence<T extends { startDate: Date; endDate: Date }>(
  event: T,
  rangeStart: Date,
  rangeEnd: Date,
  rule?: RecurrenceRuleWithFilters | null,
): T[] {
  const instances: T[] = [];

  if (!rule) {
    // Single event — check if it overlaps the range
    if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
      instances.push({ ...event });
    }
    return instances;
  }

  const { frequency, interval: freqInterval, endDate, count, byDay, byMonthDay, excludedDates } = rule;
  let current = new Date(event.startDate);
  let occurrenceCount = 0;

  // Each instance keeps the base event's duration (end - start)
  const durationMs = event.endDate.getTime() - event.startDate.getTime();

  while (current <= rangeEnd && occurrenceCount < MAX_OCCURRENCES) {
    // Stop if past recurrence end date or count limit
    if (endDate && current > endDate) break;
    if (count != null && occurrenceCount >= count) break;

    // Apply byDay filter (weekly): only include if the weekday matches
    if (byDay && frequency === 'WEEKLY') {
      const targetWeekday = dayAbbreviationToNumber(byDay);
      if (targetWeekday !== null && current.getDay() !== targetWeekday) {
        current = advanceDate(current, frequency, freqInterval);
        occurrenceCount++;
        continue;
      }
    }

    // Apply byMonthDay filter (monthly): only include if the day-of-month matches
    if (byMonthDay != null && frequency === 'MONTHLY') {
      // Skip months that don't have this day (e.g. 31st in February)
      if (current.getDate() !== byMonthDay) {
        current = advanceDate(current, frequency, freqInterval);
        occurrenceCount++;
        continue;
      }
    }

    // Skip excluded dates (e.g. when a user drags one instance to a new date)
    if (excludedDates != null && excludedDates.length > 0) {
      const instanceDateStr = toLocalDateInputValue(current);
      if (excludedDates.includes(instanceDateStr)) {
        current = advanceDate(current, frequency, freqInterval);
        occurrenceCount++;
        continue;
      }
    }

    // Check overlap with range — the instance end is shifted by duration so
    // later occurrences are not compared against the base event's absolute end
    const instanceEnd = new Date(current.getTime() + durationMs);
    if (current <= rangeEnd && instanceEnd >= rangeStart) {
      instances.push({ ...event, startDate: new Date(current), endDate: instanceEnd } as T);
    }

    // Advance by frequency + interval
    current = advanceDate(current, frequency, freqInterval);
    occurrenceCount++;
  }

  return instances;
}

/** Map an ISO 8601 day abbreviation to a JavaScript weekday number (0=Sunday). */
function dayAbbreviationToNumber(abbrev: string): number | null {
  const map: Record<string, number> = {
    MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0,
  };
  return map[abbrev.toUpperCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Format a recurrence rule as a human-readable label.
 */
export function getRecurrenceLabel(frequency: RecurrenceFrequency, interval: number): string {
  const labels: Record<RecurrenceFrequency, string> = {
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

/**
 * Format the end condition of a recurrence rule.
 */
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
// Date formatting (re-exported for convenience)
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

export function toLocalDateTimeInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}`;
}

export function toLocalDateInputValue(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalDateInputValue(value: string): Date {
  return new Date(`${value}T00:00`);
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

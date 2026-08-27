/**
 * Shared recurrence logic — display helpers, types, and constants.
 *
 * Recurrence expansion is handled by lib/recurrence-rrule.ts (rrule library).
 * This module provides display helpers, type definitions, and constants used
 * by both the service layer and frontend components.
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

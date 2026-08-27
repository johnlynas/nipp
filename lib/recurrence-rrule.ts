/**
 * RFC 5545 recurrence expansion using the `rrule` library.
 *
 * This module replaces `lib/recurrence.ts` for the expansion logic while keeping
 * the display helpers (formatDate, getRecurrenceLabel, etc.) in the original file.
 *
 * The expansion API is a drop-in replacement for `expandRecurrence()` from the
 * legacy engine — same input shape, same output shape.
 */

import { RRule } from 'rrule';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** RFC 5545 recurrence rule stored as JSON (rrule format). */
export interface RruleJson {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'YEARLY';
  interval: number;
  /** Event start date — used as the RRule dtstart. */
  dtstart: Date;
  /** Hard end date (UNTIL). Mutually exclusive with count. */
  until: Date | null;
  /** Maximum occurrence count (mutually exclusive with until). */
  count: number | null;
  /** Days of week to include (e.g., ["MO", "WE"]). */
  byweekday?: string[] | null;
  /** Days of month to include (e.g., [15]). */
  bymonthday?: number[] | null;
}

/** Input to the expansion function — an event with startDate/endDate. */
export interface ExpandableEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  [key: string]: unknown; // Allow arbitrary extra fields (passed through)
}

/** Maximum number of occurrences to expand (prevents runaway loops). */
export const MAX_OCCURRENCES = 52 * 12; // ~10 years of weekly events

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a date string (YYYY-MM-DD) is in the excluded dates list. */
function isExcluded(date: Date, exdates: string[]): boolean {
  if (exdates.length === 0) return false;
  const dateStr = formatDateInput(date);
  return exdates.includes(dateStr);
}

/** Format a Date as YYYY-MM-DD (local, no timezone conversion). */
function formatDateInput(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Map our frequency names to rrule-compatible freq values. */
function mapFrequency(freq: string): number {
  const freqMap: Record<string, number> = {
    DAILY: RRule.DAILY,
    WEEKLY: RRule.WEEKLY,
    MONTHLY: RRule.MONTHLY,
    QUARTERLY: RRule.MONTHLY, // rrule doesn't have QUARTERLY; use MONTHLY interval=3
    SEMI_ANNUALLY: RRule.MONTHLY, // rrule doesn't have SEMIANNUALLY; use MONTHLY interval=6
    YEARLY: RRule.YEARLY,
  };
  return freqMap[freq] ?? RRule.DAILY;
}

/** Map our frequency names to interval multipliers for special frequencies. */
function mapInterval(freq: string, interval: number): number {
  if (freq === 'QUARTERLY') return interval * 3;
  if (freq === 'SEMI_ANNUALLY') return interval * 6;
  return interval;
}

/** Map day abbreviation to rrule weekday constant. */
function mapWeekday(day: string): typeof RRule.MO {
  const dayMap: Record<string, typeof RRule.MO> = {
    MO: RRule.MO,
    TU: RRule.TU,
    WE: RRule.WE,
    TH: RRule.TH,
    FR: RRule.FR,
    SA: RRule.SA,
    SU: RRule.SU,
  };
  return dayMap[day] ?? RRule.MO;
}

// ---------------------------------------------------------------------------
// Expansion
// ---------------------------------------------------------------------------

/**
 * Parse and normalize rrule JSON from the database.
 * Prisma returns Json columns as strings, and Date fields inside are ISO strings.
 */
function parseAndNormalizeRruleJson(raw: RruleJson | string | null): RruleJson | null {
  if (raw == null) return null;

  // If it's a string, parse the JSON
  let parsed: RruleJson;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw) as RruleJson;
    } catch {
      return null;
    }
  } else if (typeof raw === 'object') {
    parsed = raw as RruleJson;
  } else {
    return null;
  }

  // Convert Date fields from ISO strings to native JS Date objects.
  // Prisma may return dates as ISO strings (when stored as JSON) or as Date objects.
  const dtstart = parsed.dtstart;
  const dtstartDate = dtstart instanceof Date ? dtstart : new Date(dtstart as unknown as string);
  if (isNaN(dtstartDate.getTime())) return null; // Invalid date

  const until = parsed.until;
  const untilDate = until instanceof Date ? until : (until != null ? new Date(until as unknown as string) : null);
  if (untilDate != null && isNaN(untilDate.getTime())) return null; // Invalid until date

  return {
    ...parsed,
    dtstart: dtstartDate,
    until: untilDate,
  };
}

/**
 * Expand a recurring event into individual instances within the given date range.
 *
 * This is a drop-in replacement for `expandRecurrence()` from `lib/recurrence.ts`.
 * It uses the rrule library for RFC 5545 compliance.
 *
 * @param event - The base event (startDate/endDate define the instance shape).
 * @param rangeStart - Inclusive start of the query range.
 * @param rangeEnd - Inclusive end of the query range.
 * @param rruleJson - The rrule JSON rule (null/undefined for non-recurring events).
 * @param exdates - Dates to exclude from expansion.
 * @returns Array of event instances, each with startDate/endDate shifted to the occurrence date.
 */
export function expandRecurrenceWithRrule<T extends ExpandableEvent>(
  event: T,
  rangeStart: Date,
  rangeEnd: Date,
  rruleJson?: RruleJson | string | null,
  exdates?: string[],
): T[] {
  const instances: T[] = [];

  if (!rruleJson) {
    // Single event — check if it overlaps the range
    if (event.startDate <= rangeEnd && event.endDate >= rangeStart) {
      instances.push({ ...event });
    }
    return instances;
  }

  // Parse and normalize: Prisma returns Json columns as strings with ISO date values
  const normalized = parseAndNormalizeRruleJson(rruleJson);
  if (!normalized) {
    return instances;
  }

  // Calculate the duration of the base event (preserved across all occurrences)
  const durationMs = event.endDate.getTime() - event.startDate.getTime();

  // Build rrule options from the NORMALIZED data (string dates → Date objects)
  const effectiveFreq = mapFrequency(normalized.freq);
  const effectiveInterval = mapInterval(normalized.freq, normalized.interval);

  const rruleOptions: {
    freq: number;
    interval: number;
    dtstart: Date;
    count?: number;
    until?: Date;
    byweekday?: (typeof RRule.MO)[];
    bymonthday?: number[];
  } = {
    freq: effectiveFreq,
    interval: effectiveInterval,
    dtstart: normalized.dtstart,
  };

  if (normalized.count != null) {
    rruleOptions.count = normalized.count;
  }
  if (normalized.until != null) {
    rruleOptions.until = normalized.until;
  }

  if (normalized.byweekday && normalized.byweekday.length > 0) {
    rruleOptions.byweekday = normalized.byweekday.map(mapWeekday);
  }

  if (normalized.bymonthday && normalized.bymonthday.length > 0) {
    rruleOptions.bymonthday = normalized.bymonthday;
  }

  const rruleInstance = new RRule(rruleOptions);

  // Use .between() for efficient range-based expansion instead of generating
  // all occurrences (which can be up to MAX_OCCURRENCES for open-ended series).
  // We extend the query window slightly so that events starting before rangeStart
  // but ending within it are still captured.
  const queryStart = new Date(rangeStart.getTime() - durationMs);
  const occurrences = rruleInstance.between(queryStart, rangeEnd, true);

  for (const occurrenceDate of occurrences) {
    // Skip excluded dates
    if (isExcluded(occurrenceDate, exdates ?? [])) {
      continue;
    }

    // Calculate instance end date (preserve base duration)
    const instanceEnd = new Date(occurrenceDate.getTime() + durationMs);

    // Check overlap with range
    if (occurrenceDate <= rangeEnd && instanceEnd >= rangeStart) {
      instances.push({ ...event, startDate: occurrenceDate, endDate: instanceEnd } as T);
    }
  }

  return instances;
}

/**
 * Get all occurrences of a recurring event (unfiltered by range).
 * Useful for edit scope logic that needs to know all future instances.
 */
export function getAllOccurrences(
  rruleJson: RruleJson | string,
  exdates?: string[],
): Date[] {
  const normalized = parseAndNormalizeRruleJson(rruleJson);
  if (!normalized) return [];
  // Build rrule options from the NORMALIZED data (string dates → Date objects)
  const effectiveFreq = mapFrequency(normalized.freq);
  const effectiveInterval = mapInterval(normalized.freq, normalized.interval);

  const rruleOptions: {
    freq: number;
    interval: number;
    dtstart: Date;
    count?: number;
    until?: Date;
    byweekday?: (typeof RRule.MO)[];
    bymonthday?: number[];
  } = {
    freq: effectiveFreq,
    interval: effectiveInterval,
    dtstart: normalized.dtstart,
  };

  if (normalized.count != null) {
    rruleOptions.count = normalized.count;
  }
  if (normalized.until != null) {
    rruleOptions.until = normalized.until;
  }

  if (normalized.byweekday && normalized.byweekday.length > 0) {
    rruleOptions.byweekday = normalized.byweekday.map(mapWeekday);
  }

  if (normalized.bymonthday && normalized.bymonthday.length > 0) {
    rruleOptions.bymonthday = normalized.bymonthday;
  }

  // If no count or until is set, add a synthetic UNTIL to prevent rrule from
  // generating dates across its default ~300-year range (1900–2200).
  const effectiveOptions = { ...rruleOptions };
  if (normalized.count == null && normalized.until == null) {
    effectiveOptions.until = new Date(
      normalized.dtstart.getTime() + MAX_OCCURRENCES * 24 * 60 * 60 * 1000,
    );
  }

  const all = new RRule(effectiveOptions).all().slice(0, MAX_OCCURRENCES);
  return all.filter((d) => !isExcluded(d, exdates ?? []));
}

/**
 * Convert rrule JSON back to a human-readable string (for display).
 */
export function rruleToJsonString(rruleJson: RruleJson | string): string {
  const freqLabels: Record<string, string> = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    SEMI_ANNUALLY: 'Semi-Annually',
    YEARLY: 'Yearly',
  };

  const normalized = parseAndNormalizeRruleJson(rruleJson);
  if (!normalized) return '';
  const effectiveFreq = mapFrequency(normalized.freq);
  const effectiveInterval = mapInterval(normalized.freq, normalized.interval);

  // Determine the display frequency and interval
  const displayFreq = freqLabels[normalized.freq] || normalized.freq;
  const displayInterval = effectiveFreq === RRule.MONTHLY && (effectiveInterval === 3 || effectiveInterval === 6)
    ? effectiveInterval / (normalized.freq === 'QUARTERLY' ? 3 : 6)
    : normalized.interval;

  const base = displayInterval === 1
    ? displayFreq
    : `Every ${displayInterval} ${displayFreq.toLowerCase()}`;

  const parts: string[] = [base];

  if (normalized.byweekday && normalized.byweekday.length > 0) {
    parts.push(`on ${normalized.byweekday.join(', ')}`);
  }

  if (normalized.until) {
    parts.push(`ends ${formatDateInput(normalized.until)}`);
  } else if (normalized.count) {
    parts.push(`for ${normalized.count} occurrences`);
  }

  return parts.join(' ');
}

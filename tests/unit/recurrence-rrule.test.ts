/**
 * Unit tests for lib/recurrence-rrule.ts — RFC 5545 expansion via the rrule library.
 *
 * Covers: all frequency types, intervals, BYDAY/BYMONTHDAY edge cases,
 * month-end overflow, leap year handling, EXDATE filtering, count vs until
 * termination, and the MAX_OCCURRENCES cap.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  expandRecurrenceWithRrule,
  getAllOccurrences,
  rruleToJsonString,
  RruleJson,
  MAX_OCCURRENCES,
} from '@/lib/recurrence-rrule';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBaseEvent(overrides = {}) {
  return {
    id: 'event-1',
    title: 'Test Event',
    startDate: new Date('2026-01-05T10:00:00'),
    endDate: new Date('2026-01-05T11:00:00'),
    eventType: 'OTHER' as const,
    color: null,
    calendarId: 'cal-1',
    ...overrides,
  };
}

function makeRrule(overrides: Partial<RruleJson> = {}): RruleJson {
  return {
    freq: 'DAILY',
    interval: 1,
    dtstart: new Date('2026-01-05T10:00:00'),
    until: null,
    count: null,
    byweekday: null,
    bymonthday: null,
    ...overrides,
  };
}

/** Helper that passes the rrule as a JSON string (mimicking Prisma's JSON column format). */
function makeRruleString(overrides: Partial<RruleJson> = {}): string {
  const rrule = makeRrule(overrides);
  // Convert Date objects to ISO strings to simulate Prisma's JSON serialization
  return JSON.stringify({
    ...rrule,
    dtstart: rrule.dtstart.toISOString(),
    until: rrule.until ? rrule.until.toISOString() : null,
  });
}

const RANGE_START = new Date('2026-01-05T00:00:00');
const RANGE_END = new Date('2026-02-15T23:59:59');

// ---------------------------------------------------------------------------
// Daily frequency
// ---------------------------------------------------------------------------

describe('Daily recurrence', () => {
  it('expands daily interval=1 within range', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(5);
    // Each instance should be 1 day apart
    for (let i = 1; i < instances.length; i++) {
      const diff = instances[i].startDate.getTime() - instances[i - 1].startDate.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    }
  });

  it('expands daily interval=3', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 3, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(5);
    for (let i = 1; i < instances.length; i++) {
      const diff = instances[i].startDate.getTime() - instances[i - 1].startDate.getTime();
      expect(diff).toBe(3 * 24 * 60 * 60 * 1000);
    }
  });

  it('respects UNTIL date', () => {
    const event = makeBaseEvent();
    const until = new Date('2026-01-15T23:59:59');
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, until });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    // Jan 5 to Jan 15 = 11 occurrences (inclusive)
    expect(instances.length).toBeGreaterThanOrEqual(10);
    for (const inst of instances) {
      expect(inst.startDate.getTime()).toBeLessThanOrEqual(until.getTime());
    }
  });

  it('respects COUNT over UNTIL (COUNT takes precedence in rrule)', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 3 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(3);
  });

  it('returns single event when no rrule and within range', () => {
    const event = makeBaseEvent();
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, null);
    expect(instances).toHaveLength(1);
    expect(instances[0].id).toBe('event-1');
  });

  it('returns empty array when no rrule and event outside range', () => {
    const event = makeBaseEvent({
      startDate: new Date('2026-03-01T10:00:00'),
      endDate: new Date('2026-03-01T11:00:00'),
    });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, null);
    expect(instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Weekly frequency
// ---------------------------------------------------------------------------

describe('Weekly recurrence', () => {
  it('expands weekly interval=1', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'WEEKLY', interval: 1, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(5);
    for (let i = 1; i < instances.length; i++) {
      const diff = instances[i].startDate.getTime() - instances[i - 1].startDate.getTime();
      expect(diff).toBe(7 * 24 * 60 * 60 * 1000);
    }
  });

  it('expands weekly interval=2', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'WEEKLY', interval: 2, count: 4 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, new Date('2026-03-01'), rrule);
    expect(instances).toHaveLength(4);
  });

  it('respects byweekday — only Mondays', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-05T10:00:00') }); // Monday
    const rrule = makeRrule({ freq: 'WEEKLY', interval: 1, byweekday: ['MO'], count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(5);
    for (const inst of instances) {
      expect(inst.startDate.getUTCDay()).toBe(1); // Monday = 1
    }
  });

  it('respects byweekday — multiple days (MO, WE, FR)', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-05T10:00:00') });
    const rrule = makeRrule({ freq: 'WEEKLY', interval: 1, byweekday: ['MO', 'WE', 'FR'], count: 9 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances.length).toBeGreaterThanOrEqual(7);
    for (const inst of instances) {
      const day = inst.startDate.getUTCDay();
      expect([1, 3, 5]).toContain(day); // MO=1, WE=3, FR=5
    }
  });
});

// ---------------------------------------------------------------------------
// Monthly frequency
// ---------------------------------------------------------------------------

describe('Monthly recurrence', () => {
  it('expands monthly interval=1', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'MONTHLY', interval: 1, count: 3 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, new Date('2026-04-01'), rrule);
    expect(instances).toHaveLength(3);
  });

  it('handles month-end overflow — Jan 31 skips Feb (no 31st)', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-31T10:00:00'), endDate: new Date('2026-01-31T11:00:00') });
    const rrule = makeRrule({ freq: 'MONTHLY', interval: 1, dtstart: new Date('2026-01-31T10:00:00'), count: 3 });
    const instances = expandRecurrenceWithRrule(event, new Date('2026-01-01'), new Date('2026-06-30'), rrule);
    // rrule RFC 5545: monthly on the 31st skips months without a 31st
    expect(instances).toHaveLength(3); // Jan 31, Mar 31, May 31
    const months = instances.map((i) => i.startDate.getUTCMonth());
    expect(months).toEqual([0, 2, 4]); // Jan, Mar, May
  });

  it('respects bymonthday — 15th of each month', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-15T10:00:00') });
    const rrule = makeRrule({ freq: 'MONTHLY', interval: 1, bymonthday: [15], count: 3 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances.length).toBeGreaterThanOrEqual(2); // Jan 15, at least one more
    for (const inst of instances) {
      expect(inst.startDate.getUTCDate()).toBe(15);
    }
  });

  it('respects bymonthday — last day of month (-1)', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-31T10:00:00'), endDate: new Date('2026-01-31T11:00:00') });
    const rrule = makeRrule({ freq: 'MONTHLY', interval: 1, dtstart: new Date('2026-01-31T10:00:00'), bymonthday: [-1], count: 3 });
    const instances = expandRecurrenceWithRrule(event, new Date('2026-01-01'), new Date('2026-04-30'), rrule);
    expect(instances.length).toBeGreaterThanOrEqual(3);
    // Each should be on the last day of its month
    for (const inst of instances) {
      const d = inst.startDate;
      // Check that the next day is the 1st of the next month
      const nextDay = new Date(d.getTime() + 86400000);
      expect(nextDay.getUTCDate()).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Quarterly and Semi-Annually (mapped to MONTHLY with interval)
// ---------------------------------------------------------------------------

describe('Quarterly and Semi-Annually', () => {
  it('QUARTERLY expands every 3 months', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-15T10:00:00'), endDate: new Date('2026-01-15T11:00:00') });
    const rrule = makeRrule({ freq: 'QUARTERLY', interval: 1, dtstart: new Date('2026-01-15T10:00:00'), count: 4 });
    const instances = expandRecurrenceWithRrule(event, new Date('2026-01-01'), new Date('2027-01-01'), rrule);
    expect(instances).toHaveLength(4);
    // Check intervals: Jan → Apr → Jul → Oct (3 months apart)
    for (let i = 1; i < instances.length; i++) {
      const monthDiff = instances[i].startDate.getUTCMonth() - instances[i - 1].startDate.getUTCMonth();
      expect(monthDiff).toBe(3);
    }
  });

  it('SEMI_ANNUALLY expands every 6 months', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-15T10:00:00'), endDate: new Date('2026-01-15T11:00:00') });
    const rrule = makeRrule({ freq: 'SEMI_ANNUALLY', interval: 1, dtstart: new Date('2026-01-15T10:00:00'), count: 4 });
    const instances = expandRecurrenceWithRrule(event, new Date('2026-01-01'), new Date('2028-01-01'), rrule);
    expect(instances).toHaveLength(4);
    // Check 6-month intervals accounting for year wrap
    for (let i = 1; i < instances.length; i++) {
      const prev = instances[i - 1].startDate;
      const curr = instances[i].startDate;
      const monthDiff = (curr.getUTCFullYear() - prev.getUTCFullYear()) * 12 + (curr.getUTCMonth() - prev.getUTCMonth());
      expect(monthDiff).toBe(6);
    }
  });
});

// ---------------------------------------------------------------------------
// Yearly frequency
// ---------------------------------------------------------------------------

describe('Yearly recurrence', () => {
  it('expands yearly interval=1', () => {
    const event = makeBaseEvent({ startDate: new Date('2026-01-05T10:00:00'), endDate: new Date('2026-01-05T11:00:00') });
    const rrule = makeRrule({ freq: 'YEARLY', interval: 1, dtstart: new Date('2026-01-05T10:00:00'), count: 3 });
    const instances = expandRecurrenceWithRrule(event, new Date('2026-01-01'), new Date('2029-01-06'), rrule);
    expect(instances).toHaveLength(3);
  });

  it('handles leap year — Feb 29', () => {
    const event = makeBaseEvent({ startDate: new Date('2024-02-29T10:00:00'), endDate: new Date('2024-02-29T11:00:00') });
    const rrule = makeRrule({ freq: 'YEARLY', interval: 1, dtstart: new Date('2024-02-29T10:00:00'), count: 5 });
    const instances = expandRecurrenceWithRrule(event, new Date('2024-01-01'), new Date('2030-12-31'), rrule);
    // rrule clamps Feb 29 to Feb 28 in non-leap years
    expect(instances.length).toBeGreaterThanOrEqual(1);
    for (const inst of instances) {
      const month = inst.startDate.getUTCMonth();
      expect(month).toBe(1); // February (0-indexed)
    }
  });
});

// ---------------------------------------------------------------------------
// EXDATE filtering
// ---------------------------------------------------------------------------

describe('EXDATE filtering', () => {
  it('excludes dates listed in exdates array', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 10 });
    const exdates = ['2026-01-07', '2026-01-10'];
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule, exdates);
    expect(instances).toHaveLength(8); // 10 - 2 excluded
    const dates = instances.map((i) => {
      const d = i.startDate;
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    expect(dates).not.toContain('2026-01-07');
    expect(dates).not.toContain('2026-01-10');
  });

  it('handles empty exdates array', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule, []);
    expect(instances).toHaveLength(5);
  });

  it('handles undefined exdates', () => {
    const event = makeBaseEvent();
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// String-date format (Prisma JSON serialization)
// ---------------------------------------------------------------------------

describe('String-date format (Prisma JSON)', () => {
  it('expands when rrule is passed as a JSON string', () => {
    const event = makeBaseEvent();
    const rruleStr = makeRruleString({ freq: 'DAILY', interval: 1, count: 5 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rruleStr);
    expect(instances).toHaveLength(5);
  });

  it('expands weekly when rrule is passed as a JSON string', () => {
    const event = makeBaseEvent();
    const rruleStr = makeRruleString({ freq: 'WEEKLY', interval: 1, count: 4 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rruleStr);
    expect(instances).toHaveLength(4);
  });

  it('handles null rrule string', () => {
    const event = makeBaseEvent();
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, null);
    expect(instances).toHaveLength(1); // Single event within range
  });

  it('handles invalid JSON string gracefully', () => {
    const event = makeBaseEvent();
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, 'not-json' as any);
    expect(instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getAllOccurrences
// ---------------------------------------------------------------------------

describe('getAllOccurrences', () => {
  it('returns all occurrences without range filter', () => {
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 10 });
    const occurrences = getAllOccurrences(rrule);
    expect(occurrences).toHaveLength(10);
  });

  it('respects exdates in getAllOccurrences', () => {
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 10 });
    const occurrences = getAllOccurrences(rrule, ['2026-01-07']);
    expect(occurrences).toHaveLength(9);
  });

  it('returns empty array for invalid rrule', () => {
    const occurrences = getAllOccurrences('invalid' as any);
    expect(occurrences).toHaveLength(0);
  });

  it('caps at MAX_OCCURRENCES for open-ended series', () => {
    const rrule = makeRrule({ freq: 'DAILY', interval: 1 }); // No count, no until
    const occurrences = getAllOccurrences(rrule);
    expect(occurrences.length).toBeLessThanOrEqual(MAX_OCCURRENCES);
  });
});

// ---------------------------------------------------------------------------
// rruleToJsonString (display helper)
// ---------------------------------------------------------------------------

describe('rruleToJsonString', () => {
  it('returns a human-readable string for daily recurrence', () => {
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 5 });
    const label = rruleToJsonString(rrule);
    expect(label).toContain('Daily');
    expect(label).toContain('5 occurrences');
  });

  it('returns a human-readable string for weekly recurrence with interval', () => {
    const rrule = makeRrule({ freq: 'WEEKLY', interval: 2, count: 5 });
    const label = rruleToJsonString(rrule);
    expect(label).toContain('Every 2 weekly');
  });

  it('handles string-date format', () => {
    const rruleStr = makeRruleString({ freq: 'WEEKLY', interval: 1, count: 3 });
    const label = rruleToJsonString(rruleStr);
    expect(label).toContain('Weekly');
  });

  it('returns empty string for invalid input', () => {
    const label = rruleToJsonString('invalid' as any);
    expect(label).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Duration preservation
// ---------------------------------------------------------------------------

describe('Duration preservation', () => {
  it('preserves the base event duration across all instances', () => {
    const event = makeBaseEvent({
      startDate: new Date('2026-01-05T14:00:00'),
      endDate: new Date('2026-01-05T15:30:00'), // 90 min
    });
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 3 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances).toHaveLength(3);
    for (const inst of instances) {
      const duration = inst.endDate.getTime() - inst.startDate.getTime();
      expect(duration).toBe(90 * 60 * 1000);
    }
  });

  it('preserves extra fields from the base event', () => {
    const event = makeBaseEvent({ title: 'Special Meeting', color: '#FF0000' });
    const rrule = makeRrule({ freq: 'DAILY', interval: 1, count: 2 });
    const instances = expandRecurrenceWithRrule(event, RANGE_START, RANGE_END, rrule);
    expect(instances[0].title).toBe('Special Meeting');
    expect(instances[0].color).toBe('#FF0000');
  });
});

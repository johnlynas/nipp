/**
 * Unit tests for lib/recurrence-scopes.ts — Google Calendar-style edit scopes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import {
  applyEditScopeThis,
  applyEditScopeFollowing,
  applyEditScopeAll,
} from '@/lib/recurrence-scopes';

// ---------------------------------------------------------------------------
// Mocks — plain vi.fn() with no defaults (clearAllMocks preserves implementation)
// ---------------------------------------------------------------------------

vi.mock('@/lib/global-db', () => ({
  default: {
    calendarEvent: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers — extract call data from vi.fn().mock.calls (array of arg arrays)
// ---------------------------------------------------------------------------

function getCallData(mock: any, index = 0): any {
  const calls = mock.mock.calls;
  if (!calls || !calls[index]) return undefined;
  return calls[index][0]; // first argument is the Prisma call object
}

function findCall(mock: any, predicate: (data: any) => boolean): any {
  const calls = mock.mock.calls;
  if (!calls) return undefined;
  for (const callArgs of calls) {
    const data = callArgs[0]; // first argument is the Prisma call object
    if (predicate(data)) return data;
  }
  return undefined;
}

/** Parse rrule value — handles both string and object forms. */
function parseRrule(rruleVal: any): any {
  if (typeof rruleVal === 'string') return JSON.parse(rruleVal);
  return rruleVal;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const mockCtx = {
  userId: 'user-1',
  role: 'TENANT_ADMIN' as const,
  organizationId: 'org-1',
};

function makeBaseEvent(overrides = {}) {
  return {
    id: 'event-1',
    title: 'Weekly Standup',
    description: null,
    startDate: new Date('2026-01-05T10:00:00'),
    endDate: new Date('2026-01-05T11:00:00'),
    eventType: 'OTHER',
    color: null,
    calendarId: 'cal-1',
    organizationId: 'org-1',
    // rrule must be an object (not a string) because getEventRrule does:
    //   return event.rrule as unknown as RruleJson;
    rrule: {
      freq: 'WEEKLY',
      interval: 1,
      dtstart: new Date('2026-01-05T10:00:00').toISOString(),
      until: null,
      count: null,
    },
    exdates: [],
    ...overrides,
  };
}

/** Create a copy of base event fields suitable for creating an override (excludes id). */
function makeOverrideFields(overrides = {}) {
  const baseEvent = makeBaseEvent();
  const { id: _id, rrule: _rrule, ...rest } = baseEvent;
  return { id: 'override-1', ...rest, ...overrides };
}

/** Create a copy of base event fields for a new series (excludes id). */
function makeNewSeriesFields(overrides = {}) {
  const baseEvent = makeBaseEvent();
  const { id: _id, rrule: _rrule, ...rest } = baseEvent;
  return { id: 'new-series-1', ...rest, ...overrides };
}

// ---------------------------------------------------------------------------
// Reset — reassign mock functions to fresh vi.fn() instances each test.
// This is the KEY fix: clearAllMocks does NOT reset implementations, so we
// must reassign the properties themselves to fresh mocks.
// ---------------------------------------------------------------------------

function resetMocks() {
  (globalDb.calendarEvent.findFirst as any) = vi.fn();
  (globalDb.calendarEvent.update as any) = vi.fn();
  (globalDb.calendarEvent.create as any) = vi.fn();
}

// ---------------------------------------------------------------------------
// "this" scope — EXDATE the clicked instance + create a detached override
// ---------------------------------------------------------------------------

describe('Edit Scope: this', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('adds clicked date to exdates on the base event', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Rescheduled Standup',
    });

    const exdateUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.exdates !== undefined);
    expect(exdateUpdate).toBeDefined();
    const updatedExdates = exdateUpdate.data.exdates as string[];
    expect(updatedExdates).toContain('2026-01-19');
  });

  it('creates a detached override event with updated details', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      title: 'Rescheduled Standup',
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    expect(createData.data.title).toBe('Rescheduled Standup');
  });

  it('returns the overrideId', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    const result = await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Rescheduled Standup',
    });

    expect(result).toEqual({ overrideId: 'override-1' });
  });

  it('updates in place for non-recurring events', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve({ ...makeBaseEvent(), rrule: null }));

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Updated Standup',
    });

    const updateData = findCall(globalDb.calendarEvent.update, (data: any) => data.data.title !== undefined);
    expect(updateData).toBeDefined();
    expect(updateData.data.title).toBe('Updated Standup');

    // Should NOT create an override
    expect(globalDb.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('preserves base duration when no new dates provided', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Rescheduled Standup',
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    const duration = createData.data.endDate.getTime() - createData.data.startDate.getTime();
    expect(duration).toBe(60 * 60 * 1000); // 1 hour (base duration)
  });

  it('uses clicked date as override start when no startDate provided', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Rescheduled Standup',
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData.data.startDate.getTime()).toBe(new Date('2026-01-19T10:00:00').getTime());
  });

  it('does not add duplicate exdates', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeOverrideFields());

    // First call adds the date
    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {});

    // Second call with same date — should not add again
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve({ ...makeBaseEvent(), exdates: ['2026-01-19'] }));
    (globalDb.calendarEvent.update as any).mockClear();

    await applyEditScopeThis(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {});

    // update should not have been called (addExdate returns early)
    const exdateUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.exdates !== undefined);
    expect(exdateUpdate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// "following" scope — UNTIL-terminate base + create new series from clicked date
// ---------------------------------------------------------------------------

describe('Edit Scope: following', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('sets UNTIL on base to day before clicked date', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'New Time Standup',
    });

    const rruleUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.rrule !== undefined);
    expect(rruleUpdate).toBeDefined();
    const updatedRrule = parseRrule(rruleUpdate.data.rrule);
    // UNTIL should be Jan 18 (day before clicked) at 23:59:59.999
    const untilDate = new Date(updatedRrule.until);
    expect(untilDate.getUTCDate()).toBe(18);
    expect(untilDate.getUTCMonth()).toBe(0); // January
  });

  it('creates a new series starting from clicked date', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      title: 'New Time Standup',
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    expect(createData.data.title).toBe('New Time Standup');
  });

  it('writes rrule JSON on the new series event', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    const rrule = parseRrule(createData.data.rrule);
    expect(rrule.freq).toBe('WEEKLY');
    expect(rrule.dtstart).toBeDefined();
  });

  it('returns baseId and newSeriesId', async () => {
    const baseEvent = makeBaseEvent();
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    const result = await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {});

    expect(result).toEqual({ baseId: 'event-1', newSeriesId: 'new-series-1' });
  });

  it('updates in place for non-recurring events', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve({ ...makeBaseEvent(), rrule: null }));

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T10:00:00'), {
      title: 'Updated Standup',
    });

    const updateData = findCall(globalDb.calendarEvent.update, (data: any) => data.data.title !== undefined);
    expect(updateData).toBeDefined();
    expect(updateData.data.title).toBe('Updated Standup');
  });

  it('resets UNTIL for the new series when count is set (UNTIL cleared)', async () => {
    const baseEvent = {
      ...makeBaseEvent(),
      rrule: {
        freq: 'WEEKLY', interval: 1,
        dtstart: new Date('2026-01-05T10:00:00').toISOString(),
        until: new Date('2026-12-31T23:59:59').toISOString(),
        count: 10,
      },
    };
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    const rrule = parseRrule(createData.data.rrule);
    // When count is set, UNTIL should be null for the new series
    expect(rrule.until).toBeNull();
  });

  it('preserves original UNTIL for new series when no count is set', async () => {
    const baseEvent = {
      ...makeBaseEvent(),
      rrule: {
        freq: 'WEEKLY', interval: 1,
        dtstart: new Date('2026-01-05T10:00:00').toISOString(),
        until: new Date('2026-12-31T23:59:59').toISOString(),
        count: null,
      },
    };
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    const rrule = parseRrule(createData.data.rrule);
    // When no count, UNTIL should be preserved for the new series
    expect(rrule.until).toBeDefined();
  });

  it('resets UNTIL when count is set on original rrule', async () => {
    const baseEvent = {
      ...makeBaseEvent(),
      rrule: {
        freq: 'WEEKLY', interval: 1,
        dtstart: new Date('2026-01-05T10:00:00').toISOString(),
        until: new Date('2026-12-31T23:59:59').toISOString(),
        count: 10,
      },
    };
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));
    (globalDb.calendarEvent.create as any).mockResolvedValue(makeNewSeriesFields());

    await applyEditScopeFollowing(mockCtx, 'event-1', new Date('2026-01-19T14:00:00'), {
      startDate: new Date('2026-01-19T14:00:00'),
      endDate: new Date('2026-01-19T15:30:00'),
    });

    const createData = getCallData(globalDb.calendarEvent.create);
    expect(createData).toBeDefined();
    const rrule = parseRrule(createData.data.rrule);
    // When count is set, UNTIL should be cleared for the new series
    expect(rrule.until).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// "all" scope — Reset base recurrence, clear EXDATEs, apply updates
// ---------------------------------------------------------------------------

describe('Edit Scope: all', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('clears UNTIL on base rrule (no end)', async () => {
    const baseEvent = {
      ...makeBaseEvent(),
      rrule: {
        freq: 'WEEKLY', interval: 1,
        dtstart: new Date('2026-01-05T10:00:00').toISOString(),
        until: new Date('2026-12-31T23:59:59').toISOString(),
        count: null,
      },
    };
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));

    await applyEditScopeAll(mockCtx, 'event-1', { title: 'Permanent Standup' });

    const rruleUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.rrule !== undefined);
    expect(rruleUpdate).toBeDefined();
    const updatedRrule = parseRrule(rruleUpdate.data.rrule);
    expect(updatedRrule.until).toBeNull();
  });

  it('clears all exdates on the base event', async () => {
    const baseEvent = makeBaseEvent({ exdates: ['2026-01-19', '2026-02-02'] });
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));

    await applyEditScopeAll(mockCtx, 'event-1', { title: 'Updated' });

    const exdateUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.exdates !== undefined);
    expect(exdateUpdate).toBeDefined();
    const clearedExdates = exdateUpdate.data.exdates as string[];
    expect(clearedExdates).toEqual([]);
  });

  it('applies updates to the base event', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(makeBaseEvent()));

    await applyEditScopeAll(mockCtx, 'event-1', {
      title: 'Permanent Standup',
      startDate: new Date('2026-01-05T14:00:00'),
      endDate: new Date('2026-01-05T15:00:00'),
    });

    const titleUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.title !== undefined);
    expect(titleUpdate).toBeDefined();
    expect(titleUpdate.data.title).toBe('Permanent Standup');

    const dateUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.startDate !== undefined);
    expect(dateUpdate).toBeDefined();
    expect(dateUpdate.data.startDate.getTime()).toBe(new Date('2026-01-05T14:00:00').getTime());
  });

  it('returns baseId', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(makeBaseEvent()));

    const result = await applyEditScopeAll(mockCtx, 'event-1', {});
    expect(result).toEqual({ baseId: 'event-1' });
  });

  it('updates in place for non-recurring events', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve({ ...makeBaseEvent(), rrule: null }));

    await applyEditScopeAll(mockCtx, 'event-1', { title: 'Updated' });

    const updateData = findCall(globalDb.calendarEvent.update, (data: any) => data.data.title !== undefined);
    expect(updateData).toBeDefined();
    expect(updateData.data.title).toBe('Updated');
  });

  it('does not clear exdates for non-recurring events', async () => {
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve({ ...makeBaseEvent(), rrule: null }));

    await applyEditScopeAll(mockCtx, 'event-1', { title: 'Updated' });

    // Should only have one update call (the in-place update), no exdate clearing
    const exdateUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.exdates !== undefined);
    expect(exdateUpdate).toBeUndefined();
  });

  it('preserves rrule properties when resetting (only clears UNTIL)', async () => {
    const baseEvent = {
      ...makeBaseEvent(),
      rrule: {
        freq: 'WEEKLY', interval: 2,
        dtstart: new Date('2026-01-05T10:00:00').toISOString(),
        until: new Date('2026-12-31T23:59:59').toISOString(),
        count: null,
        byweekday: ['MO', 'WE', 'FR'],
      },
    };
    (globalDb.calendarEvent.findFirst as any).mockImplementation(() => Promise.resolve(baseEvent));

    await applyEditScopeAll(mockCtx, 'event-1', {});

    const rruleUpdate = findCall(globalDb.calendarEvent.update, (data: any) => data.data.rrule !== undefined);
    const updatedRrule = parseRrule(rruleUpdate.data.rrule);
    expect(updatedRrule.freq).toBe('WEEKLY');
    expect(updatedRrule.interval).toBe(2);
    expect(updatedRrule.byweekday).toEqual(['MO', 'WE', 'FR']);
  });
});

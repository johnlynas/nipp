/**
 * Unit tests for lib/calendar-event-scheduler — background scan that pushes an
 * SSE notification when a calendar event is due to start within its lead window.
 *
 * Covers: lead-window selection, non-recurring single notification per event,
 * recurring per-instance dedup, exdate skipping, ORG scope + payload shape,
 * no-op scan, resilience to push failures, timer lifecycle.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import globalDb from '@/lib/global-db';
import {
  findDueToStartEvents,
  runCalendarEventScan,
  startCalendarEventScheduler,
  stopCalendarEventScheduler,
  resetCalendarEventSchedulerState,
} from '@/lib/calendar-event-scheduler';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn().mockResolvedValue(undefined);

vi.mock('@/lib/global-db', () => ({
  default: {
    calendarEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() } }));

vi.mock('@/lib/notification-push', () => ({
  pushNotification: (...args: unknown[]) => mockPush(...args),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINUTE = 60 * 1000;

/** Fixed "now" shared by every test in a describe block. */
let now: Date;

beforeEach(() => {
  vi.clearAllMocks();
  resetCalendarEventSchedulerState();
  now = new Date('2026-09-08T10:30:00'); // Tue, 30 minutes after a 10:00 start
});

afterEach(() => {
  stopCalendarEventScheduler();
});

const makeDbEvent = (overrides: Record<string, unknown> = {}) => ({
  id: 'event-1',
  title: 'Viewing: 12 Foyle St',
  description: null,
  startDate: new Date('2026-09-08T10:45:00'), // inside default 15-min window after `now`
  endDate: new Date('2026-09-08T11:00:00'),
  eventType: 'VIEWING',
  color: null,
  calendarId: 'cal-1',
  propertyId: null,
  organizationId: 'org-1',
  rrule: null,
  exdates: [],
  createdAt: new Date('2026-01-01T00:00:00'),
  updatedAt: new Date('2026-01-01T00:00:00'),
  ...overrides,
});

// ---------------------------------------------------------------------------
// findDueToStartEvents — pure query + expansion function
// ---------------------------------------------------------------------------

describe('findDueToStartEvents', () => {
  it('fetches single events whose start falls in (now, now+lead]', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()]);

    const result = await findDueToStartEvents(now);

    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('event-1');
    const where = (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0].where;
    // DB fetch window is [now, now+15m]; the exclusive lower bound (an event
    // starting exactly at `now` was already due) is enforced in code.
    expect(new Date(where.startDate.gte).getTime()).toBe(now.getTime());
    expect(new Date(where.startDate.lte).getTime()).toBe(now.getTime() + 15 * MINUTE);
  });

  it('returns empty when nothing starts within the lead window', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await findDueToStartEvents(now);
    expect(result).toHaveLength(0);
  });

  it('expands recurring series into instances starting within the window', async () => {
    // Daily series with base start yesterday 13:50; `now` is Tue 13:45, so the
    // next daily instance (today 13:50) falls inside the 15-min lead window.
    const base = new Date(now.getTime() - 24 * 60 * MINUTE + 5 * MINUTE); // yesterday 13:50
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([]) // no single events
      .mockResolvedValueOnce([
        makeDbEvent({
          id: 'series-1',
          title: 'Daily maintenance round',
          startDate: base,
          endDate: new Date(base.getTime() + 60 * MINUTE),
          rrule: JSON.stringify({
            freq: 'DAILY',
            interval: 1,
            dtstart: base.toISOString(),
            until: null,
            count: null,
          }),
        }),
      ]);

    const result = await findDueToStartEvents(now);

    expect(result).toHaveLength(1);
    expect(result[0].eventId).toBe('series-1');
    // The single instance in the window is today's occurrence: base + 24h.
    expect(result[0].instanceStart.getTime()).toBe(base.getTime() + 24 * 60 * MINUTE);
    const delta = result[0].instanceStart.getTime() - now.getTime();
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(15 * MINUTE);
  });

  it('skips recurring instances whose date is excluded via exdates', async () => {
    // Base event at `now` + 10 min (inside window), daily recurrence, that date excluded.
    const base = new Date(now.getTime() + 10 * MINUTE);
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        makeDbEvent({
          id: 'series-x',
          startDate: base,
          endDate: new Date(base.getTime() + 30 * MINUTE),
          rrule: JSON.stringify({
            freq: 'DAILY',
            interval: 1,
            dtstart: base.toISOString(),
            until: null,
            count: null,
            byweekday: null,
            bymonthday: null,
          }),
          exdates: [formatLocalDate(base)],
        }),
      ]);

    // The only instance in the window is today's (base) occurrence — excluded.
    // Tomorrow's occurrence is 24h away — outside the window. So nothing due.
    const result = await findDueToStartEvents(now);
    expect(result).toHaveLength(0);
  });

  it('filters non-recurring events whose startDate falls in the window even if fetched', async () => {
    // Fetched but starts 2 hours out — must be dropped by the range filter.
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent({ startDate: new Date(now.getTime() + 120 * MINUTE) })])
      .mockResolvedValueOnce([]);

    const result = await findDueToStartEvents(now);
    expect(result).toHaveLength(0);
  });

  it('orders results by instance start ascending', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([
        makeDbEvent({ id: 'late', title: 'Late', startDate: new Date(now.getTime() + 12 * MINUTE) }),
        makeDbEvent({ id: 'early', title: 'Early', startDate: new Date(now.getTime() + 5 * MINUTE) }),
      ])
      .mockResolvedValueOnce([]);

    const result = await findDueToStartEvents(now);
    expect(result.map((e) => e.eventId)).toEqual(['early', 'late']);
  });
});

// ---------------------------------------------------------------------------
// runCalendarEventScan — notify + dedup behavior
// ---------------------------------------------------------------------------

describe('runCalendarEventScan', () => {
  it('pushes an ORG-scoped INFO notification for each event due to start', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()])
      .mockResolvedValueOnce([]);

    const notified = await runCalendarEventScan(now);
    expect(notified).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(1);

    const payload = mockPush.mock.calls[0][0];
    expect(payload.scope).toBe('ORG');
    expect(payload.priority).toBe('INFO');
    expect(payload.source).toBe('calendar:event-upcoming');
    expect(payload.organizationId).toBe('org-1');
    expect(payload.title).toContain('due to start');
    expect(payload.message).toContain('Viewing: 12 Foyle St');
    // Message carries the start time in en-GB format.
    expect(payload.message).toContain('10:45');
  });

  it('notifies each event only once — repeat scans are no-ops', async () => {
    const dbFindMany = globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;
    dbFindMany.mockResolvedValue([makeDbEvent()]); // both single + recurring queries return same row? No — recurring query must be empty.
    dbFindMany.mockResolvedValueOnce([makeDbEvent()]).mockResolvedValueOnce([]);

    const first = await runCalendarEventScan(now);
    const second = await runCalendarEventScan(new Date(now.getTime() + MINUTE));

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('dedups recurring events per instance, not just once-ever (next day fires again)', async () => {
    // Daily series with base start at `now` + 5 min, 10-min duration.
    const base = new Date(now.getTime() + 5 * MINUTE);
    const dbFindMany = globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;

    const scanAt = (t: Date) => {
      dbFindMany.mockReset();
      dbFindMany.mockResolvedValueOnce([]);
      dbFindMany.mockResolvedValueOnce([
        makeDbEvent({
          id: 'series-day',
          startDate: base,
          endDate: new Date(base.getTime() + 10 * MINUTE),
          rrule: JSON.stringify({ freq: 'DAILY', interval: 1, dtstart: base.toISOString(), until: null, count: null }),
        }),
      ]);
      return runCalendarEventScan(t);
    };

    const today = await scanAt(now); // instance at now+5min → notified
    expect(today).toBe(1);

    // 24h later: same series, next instance now inside window → must fire again.
    const tomorrow = new Date(now.getTime() + 24 * 60 * MINUTE);
    const nextDay = await scanAt(tomorrow);
    expect(nextDay).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(2);

    // And the second push is about a different instance (different start time in message).
    const [firstMsg, secondMsg] = mockPush.mock.calls.map((c) => c[0].message);
    expect(firstMsg).not.toEqual(secondMsg);
  });

  it('uses an in-memory set for dedup — cleared by reset helper', async () => {
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()])
      .mockResolvedValueOnce([]);

    await runCalendarEventScan(now);
    expect(mockPush).toHaveBeenCalledTimes(1);

    // Simulate process restart: state cleared.
    resetCalendarEventSchedulerState();

    // Re-fetch same event (now + 30s; still inside window) → fires again.
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()])
      .mockResolvedValueOnce([]);
    const afterReset = await runCalendarEventScan(new Date(now.getTime() + 30 * 1000));
    expect(afterReset).toBe(1);
    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('does not notify for events already inside their lead window at scan start boundary', async () => {
    // Event starting exactly at now + 16 min — just outside the 15-min lead.
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent({ startDate: new Date(now.getTime() + 16 * MINUTE) })])
      .mockResolvedValueOnce([]);

    const notified = await runCalendarEventScan(now);
    expect(notified).toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('treats a push failure as non-success but still marks the event handled (no retry storm)', async () => {
    mockPush.mockRejectedValueOnce(new Error('SSE unavailable'));

    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()])
      .mockResolvedValueOnce([]);

    await expect(runCalendarEventScan(now)).resolves.toBe(0);

    // The failing push still claims the event so we don't retry forever on a broken SSE.
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([makeDbEvent()])
      .mockResolvedValueOnce([]);
    const second = await runCalendarEventScan(new Date(now.getTime() + MINUTE));
    expect(second).toBe(0);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('survives a DB failure on one query without throwing', async () => {
    const dbFindMany = globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;
    dbFindMany.mockRejectedValueOnce(new Error('connection lost'));
    dbFindMany.mockResolvedValueOnce([]);

    await expect(runCalendarEventScan(now)).resolves.toBe(0);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('limits how many events are processed in a single scan', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      makeDbEvent({
        id: `batch-${i}`,
        title: `Batch ${i}`,
        startDate: new Date(now.getTime() + (i % 15 + 1) * MINUTE),
      }),
    );
    (globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(many)
      .mockResolvedValueOnce([]);

    const notified = await runCalendarEventScan(now);
    // Per-scan cap keeps a burst of events from flooding subscribers in one tick.
    expect(notified).toBeLessThanOrEqual(20);
    expect(mockPush).toHaveBeenCalledTimes(notified);
  });
});

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

describe('scheduler lifecycle', () => {
  it('ticks every interval; start is idempotent; stop halts ticks', async () => {
    resetCalendarEventSchedulerState();
    vi.useFakeTimers();
    try {
      const dbFindMany = globalDb.calendarEvent.findMany as unknown as ReturnType<typeof vi.fn>;
      dbFindMany.mockReset();
      dbFindMany.mockResolvedValue([]); // no due events — scans are quiet no-ops

      startCalendarEventScheduler();
      startCalendarEventScheduler(); // idempotent — must not double-schedule

      const SCAN_INTERVAL_MS = Number(process.env.CALENDAR_EVENT_SCAN_INTERVAL_MS ?? 30_000);
      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
      expect(dbFindMany).toHaveBeenCalledTimes(2); // one scan tick → two queries (single + recurring)

      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS * 2);
      expect(dbFindMany).toHaveBeenCalledTimes(6); // three ticks total — no doubling even after second start()

      stopCalendarEventScheduler();
      await vi.advanceTimersByTimeAsync(SCAN_INTERVAL_MS);
      expect(dbFindMany).toHaveBeenCalledTimes(6); // halted — no fourth tick

      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Local helpers (mirrors lib/recurrence-rrule.ts formatDateInput — local, not UTC)
// ---------------------------------------------------------------------------

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

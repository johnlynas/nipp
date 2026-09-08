/**
 * Calendar Event Scheduler — background scanner that pushes an SSE notification
 * when a calendar event is due to start within its lead window.
 *
 * Design (mirrors lib/background-health-check.ts):
 *   - One shared interval, booted once per server process via the globalThis
 *     singleton pattern (Next.js dev mode can evaluate the same module twice).
 *   - Each tick (default 30s): find every event instance — single or recurring —
 *     whose start falls in (now, now + LEAD] (default lead: 15 minutes) and push
 *     one ORG-scoped INFO notification per instance via pushNotification().
 *   - Recurring series (rrule JSON) are expanded with the same rrule engine used
 *     by CalendarEventService (expandRecurrenceWithRrule), honoring exdates.
 *
 * Dedup:
 *   In-memory Set of `${eventId}:${instanceStartMs}` in shared globalThis state.
 *   Chosen over a schema migration on purpose: a single instance is fired
 *   exactly once per process lifetime; after a server restart the same event
 *   instance is re-notified at most one extra time (best-effort behavior,
 *   accepted). pushNotification()'s own 10s in-process/DB dedup window is NOT
 *   relied on here — the 30s polling interval spans that window.
 *
 * Resilience:
 *   - A failed push marks the instance as handled (no retry storms if SSE is
 *     down; the notification is lost rather than re-sent in a loop).
 *   - A DB failure aborts the tick quietly and retries on the next interval.
 *   - Per-scan cap on processed events avoids flooding subscribers on bursts.
 */

import { NotificationPriority, NotificationScope } from '@prisma/client';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import { pushNotification } from '@/lib/notification-push';
import { expandRecurrenceWithRrule, RruleJson } from '@/lib/recurrence-rrule';

// ---------------------------------------------------------------------------
// Configuration — read from env with hardcoded defaults
// ---------------------------------------------------------------------------

const SCAN_INTERVAL_MS = Number(process.env.CALENDAR_EVENT_SCAN_INTERVAL_MS ?? 30_000);
const LEAD_TIME_MINUTES = Number(process.env.CALENDAR_LEAD_TIME_MINUTES ?? 15);
const MAX_EVENTS_PER_SCAN = Number(process.env.CALENDAR_MAX_EVENTS_PER_SCAN ?? 20);

const EVENT_TYPE_LABELS: Record<string, string> = {
  VIEWING: 'Viewing',
  INSPECTION: 'Inspection',
  MAINTENANCE: 'Maintenance',
  LEASE_SIGNING: 'Lease Signing',
  LEASE_RENEWAL: 'Lease Renewal',
  KEY_EXCHANGE: 'Key Exchange',
  OTHER: 'Other',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DbEventShape = {
  id: string;
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  eventType: string;
  calendarId: string;
  organizationId: string;
  rrule?: unknown;
  exdates?: unknown;
};

/** A concrete occurrence that is due to start within the lead window. */
export interface DueToStartInstance {
  eventId: string;
  title: string;
  eventType: string;
  organizationId: string;
  instanceStart: Date;
  instanceEnd: Date;
}

// ---------------------------------------------------------------------------
// Shared process state (globalThis — survives duplicate module evaluation)
// ---------------------------------------------------------------------------

type SchedulerState = {
  /** Fired `${eventId}:${instanceStartMs}` keys — dedup across ticks. */
  firedKeys: Set<string>;
  timer: ReturnType<typeof setInterval> | null;
};

function getSchedulerState(): SchedulerState {
  const g = globalThis as unknown as Record<string, SchedulerState>;
  if (!g.calendarEventSchedulerState) {
    g.calendarEventSchedulerState = { firedKeys: new Set(), timer: null };
  }
  return g.calendarEventSchedulerState;
}

const state = getSchedulerState();

// ---------------------------------------------------------------------------
// JSON helpers (mirrors services/calendar-event-service.ts — Prisma returns
// Json columns as strings with ISO date values, or already-parsed objects)
// ---------------------------------------------------------------------------

function getRruleJson(event: { rrule?: unknown }): RruleJson | null {
  if (!event.rrule) return null;
  const raw = event.rrule;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as RruleJson;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw as RruleJson;
  return null;
}

function getExdates(event: { exdates?: unknown }): string[] {
  if (!event.exdates) return [];
  const raw = event.exdates;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as string[];
  return [];
}

// ---------------------------------------------------------------------------
// Discovery — findDueToStartEvents
// ---------------------------------------------------------------------------

/**
 * Find all event instances (single + recurring) whose start falls in
 * (now, now + LEAD_TIME_MINUTES]. All organizations are scanned — this runs
 * outside request scope; each notification is ORG-scoped downstream so tenant
 * isolation is enforced at delivery.
 */
export async function findDueToStartEvents(now: Date): Promise<DueToStartInstance[]> {
  const windowEnd = new Date(now.getTime() + LEAD_TIME_MINUTES * 60 * 1000);
  const instances: DueToStartInstance[] = [];

  // 1. Non-recurring events — single query, then code-level window filter
  //    (the DB filter is the primary gate; the code check guards mocks and
  //    rounding edges, and keeps behavior identical for recurring below).
  const singleEvents = (await globalDb.calendarEvent.findMany({
    where: { startDate: { gte: now, lte: windowEnd } },
    orderBy: { startDate: 'asc' },
  })) as unknown as DbEventShape[];

  for (const event of singleEvents) {
    if (getRruleJson(event)) continue; // recurring series handled below
    const start = new Date(event.startDate);
    const end = new Date(event.endDate);
    if (start > now && start <= windowEnd) {
      instances.push({
        eventId: event.id,
        title: event.title,
        eventType: event.eventType,
        organizationId: event.organizationId,
        instanceStart: start,
        instanceEnd: end,
      });
    }
  }

  // 2. Recurring series — fetch candidates whose series began on or before
  //    the window end, then expand instances into (now, windowEnd].
  const recurringSeries = (await globalDb.calendarEvent.findMany({
    where: { startDate: { lte: windowEnd } },
    orderBy: { startDate: 'asc' },
  })) as unknown as DbEventShape[];

  for (const event of recurringSeries) {
    const rruleJson = getRruleJson(event);
    if (!rruleJson) continue; // not actually recurring
    const exdates = getExdates(event);

    const expanded = expandRecurrenceWithRrule(
      event as unknown as Parameters<typeof expandRecurrenceWithRrule>[0],
      now,
      windowEnd,
      rruleJson,
      exdates.length > 0 ? exdates : undefined,
    );

    for (const instance of expanded) {
      const start = new Date(instance.startDate);
      const end = new Date(instance.endDate);
      if (start > now && start <= windowEnd) {
        instances.push({
          eventId: event.id,
          title: event.title,
          eventType: event.eventType,
          organizationId: event.organizationId,
          instanceStart: start,
          instanceEnd: end,
        });
      }
    }
  }

  instances.sort((a, b) => a.instanceStart.getTime() - b.instanceStart.getTime());
  return instances;
}

// ---------------------------------------------------------------------------
// Notification message building
// ---------------------------------------------------------------------------

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function buildUpcomingMessage(instance: DueToStartInstance): { title: string; message: string } {
  const label = EVENT_TYPE_LABELS[instance.eventType] ?? 'Other';
  return {
    title: `Calendar event due to start: ${instance.title}`,
    message: `${label}: "${instance.title}" starts at ${formatTime(instance.instanceStart)} on ${formatDate(instance.instanceStart)} (ends ${formatTime(instance.instanceEnd)}).`,
  };
}

// ---------------------------------------------------------------------------
// Scan — notify + dedup
// ---------------------------------------------------------------------------

/**
 * Run one scan tick: discover due instances and push one ORG-scoped INFO SSE
 * notification per previously-unfired instance. Returns the number of
 * notifications successfully pushed. Never throws.
 */
export async function runCalendarEventScan(now: Date = new Date()): Promise<number> {
  let instances: DueToStartInstance[];
  try {
    instances = await findDueToStartEvents(now);
  } catch (error) {
    console.error('[calendar-event-scheduler] Discovery failed, skipping tick:', error);
    return 0;
  }

  let notified = 0;
  for (const instance of instances.slice(0, MAX_EVENTS_PER_SCAN)) {
    const key = `${instance.eventId}:${instance.instanceStart.getTime()}`;
    if (state.firedKeys.has(key)) continue; // already fired this process lifetime

    // Claim synchronously BEFORE the async push so a failing push cannot be
    // retried on the next tick (lost-not-resent semantics, by design).
    state.firedKeys.add(key);

    const { title, message } = buildUpcomingMessage(instance);
    try {
      await pushNotification({
        title,
        message,
        priority: NotificationPriority.CALENDAR,
        scope: NotificationScope.ORG,
        source: 'calendar:event-upcoming',
        organizationId: instance.organizationId,
      });
      notified++;
    } catch (error) {
      // Marked handled above — do not retry; log for observability.
      console.error(
        `[calendar-event-scheduler] Failed to push notification for "${instance.title}" (${key}):`,
        error,
      );
    }
  }

  if (notified > 0) {
    logger.info({ notified, total: instances.length }, 'Calendar upcoming-event notifications pushed');
  }

  return notified;
}

// ---------------------------------------------------------------------------
// Timer lifecycle — idempotent start/stop (mirrors background-health-check.ts)
// ---------------------------------------------------------------------------

/** Start the calendar event scan interval. Safe to call multiple times. */
export function startCalendarEventScheduler(): void {
  if (state.timer) return; // Already running

  const timer = setInterval(() => {
    runCalendarEventScan().catch((error) => {
      console.error('[calendar-event-scheduler] Scan tick failed:', error);
    });
  }, SCAN_INTERVAL_MS);

  state.timer = timer;

  if (typeof timer.unref === 'function') {
    timer.unref(); // Don't prevent process exit in dev mode
  }

  console.log(
    `[calendar-event-scheduler] Started (every ${SCAN_INTERVAL_MS / 1000}s, lead window ${LEAD_TIME_MINUTES} min)`,
  );
}

/** Stop the calendar event scan interval (mainly useful for tests). */
export function stopCalendarEventScheduler(): void {
  const timer = state.timer;
  if (timer) {
    clearInterval(timer);
    state.timer = null;
  }
}

/** Clear fired-key state and stop the timer. For tests that simulate restarts. */
export function resetCalendarEventSchedulerState(): void {
  stopCalendarEventScheduler();
  state.firedKeys.clear();
}

// Start on module load — runs once when the Next.js server boots the root
// layout (same boot path as the background health check in app/layout.tsx).
startCalendarEventScheduler();

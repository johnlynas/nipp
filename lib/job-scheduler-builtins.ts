/**
 * Job Scheduler — trusted built-in handler set (Phase 1 / Phase 2 shared)
 *
 * SIDE-EFFECT-FREE: importing this module must never start timers, connect to
 * the database, or evaluate env schemas. It is imported both by the main thread
 * (lib/job-scheduler-engine.ts) and inside Bree worker threads
 * (job-scheduler-runtime runner → lib/job-scheduler-worker-bootstrap.ts), so any
 * side effect here would be re-executed per fork.
 *
 * These are the trusted built-in handlers operators can attach to a
 * JobDefinition via `handlerKey`. They may use the platform primitives
 * (globalDb, pushNotification, health probes) directly — they never touch
 * untrusted code (that is the Phase 2 `code` pipeline).
 */

import {
  JobSchedulerService,
  type JobHandler,
  type JobRunContext,
} from '@/services/job-scheduler-service';
import { checkHealthStatus, type HealthResponse } from '@/lib/health-check';
import { findDueToStartEvents } from '@/lib/calendar-event-scheduler';
import { pushNotification } from '@/lib/notification-push';
import { NotificationPriority, NotificationScope } from '@prisma/client';

/** `noop` — the minimal smoke-test handler. Proves the end-to-end path. */
export const noopHandler: JobHandler = async (ctx) => {
  const input = ctx.input !== undefined ? JSON.stringify(ctx.input) : null;
  return { ok: true, handler: 'noop', trigger: ctx.trigger, hadInput: input !== null };
};

/**
 * `health-check` — run the shared platform health probe and, on an unhealthy
 * outcome, raise an operational alert. A healthy result is silent (the service's
 * own "Job completed" notification already confirms the run), so this does not
 * flood the ticker.
 */
/** No ctx needed; unannotated so its inferred signature stays 0- or 1-arg
 * callable (a `: JobHandler` annotation would pin it to the 1-arg form). */
export const healthCheckHandler = async (_ctx?: JobRunContext) => {
  const report: HealthResponse = await checkHealthStatus();
  const unhealthy = Object.entries(report.checks)
    .filter(([, c]) => c.status !== 'healthy')
    .map(([key]) => key);

  if (report.status !== 'healthy' || unhealthy.length > 0) {
    await pushNotification({
      title: 'Job health-check: platform unhealthy',
      message: `Health probe reported: ${unhealthy.length ? unhealthy.join(', ') : report.status}.`,
      priority: NotificationPriority.ERROR,
      scope: NotificationScope.GLOBAL,
      source: 'job-scheduler:health-check',
    });
  }

  return {
    handler: 'health-check',
    status: report.status,
    checks: report.checks,
    unhealthy,
  };
};

/**
 * `calendar-health-check` — probe the calendar "due to start" notification
 * pipeline by running the same discovery the live scanner uses
 * (`findDueToStartEvents`). If discovery throws, the job FAILS, so a broken
 * calendar-notification substrate becomes visible in execution history instead
 * of failing silently. A clean run reports how many instances are currently due
 * (normally 0 between events) without emitting its own event.
 */
/** No ctx needed; unannotated so its inferred signature stays 0- or 1-arg
 * callable (a `: JobHandler` annotation would pin it to the 1-arg form). */
export const calendarHealthCheckHandler = async (_ctx?: JobRunContext) => {
  const due = await findDueToStartEvents(new Date());
  return {
    handler: 'calendar-health-check',
    pipelineReachable: true,
    dueInstances: due.length,
    checkedAt: new Date().toISOString(),
  };
};

/**
 * `calendar-selftest` — prove the CALENDAR-priority notification path is
 * reachable by emitting exactly one CALENDAR SSE notification through the same
 * `pushNotification()` the live scanner uses, without needing a real due-to-start
 * event. It mirrors the scanner's emission (CALENDAR priority, GLOBAL scope)
 * but stays time-stamped so each run is distinct and lands on the platform-ops
 * ticker rather than a tenant's ORG feed.
 *
 * Input: optional `{ message?, title? }` to customise the probe text.
 */
export const calendarSelfTestHandler: JobHandler = async (ctx) => {
  const input = (ctx.input ?? {}) as { title?: unknown; message?: unknown };
  const now = new Date();
  await pushNotification({
    title:
      typeof input.title === 'string'
        ? input.title
        : 'Calendar notification path: self-test',
    message:
      typeof input.message === 'string'
        ? input.message
        : `CALENDAR-priority probe emitted at ${now.toISOString()} to verify the calendar notification pipeline.`,
    priority: NotificationPriority.CALENDAR,
    scope: NotificationScope.GLOBAL,
    source: 'job-scheduler:calendar-selftest',
    organizationId: ctx.platformOrgId,
  });
  return { ok: true, handler: 'calendar-selftest', emittedAt: now.toISOString() };
};

/** The complete trusted built-in set (key → handler). */
export const BUILTIN_HANDLERS: Array<{ key: string; handler: JobHandler }> = [
  { key: 'noop', handler: noopHandler },
  { key: 'health-check', handler: healthCheckHandler },
  { key: 'calendar-health-check', handler: calendarHealthCheckHandler },
  { key: 'calendar-selftest', handler: calendarSelfTestHandler },
];

/**
 * Register the trusted built-in handler set with the service's registry.
 * Idempotent — safe to call on every boot / module re-evaluation.
 */
export function registerBuiltinHandlers(): void {
  JobSchedulerService.registerBuiltins(BUILTIN_HANDLERS);
}

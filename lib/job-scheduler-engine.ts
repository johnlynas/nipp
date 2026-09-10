/**
 * Background Job Scheduler — engine boot module
 *
 * Boots a lightweight, main-thread scheduler that periodically checks
 * `JobDefinition` rows and executes due jobs by calling
 * `JobSchedulerService.runJob(jobId, { trigger: 'SCHEDULE' })`.
 *
 * Design rationale (see the Phase 0 spike in the plan document):
 *    - Bree's execution model forks a worker per run (confirmed by spike).
 *      Each worker would need to reconstruct globalDb/Prisma/pino context.
 *      For Phase 1 (trusted built-in handlers only, no untrusted code),
 *      this is overkill. A main-thread scanner is the simplest correct path.
 *    - The scanner mirrors `calendar-event-scheduler.ts`:
 *        * globalThis-singleton (survive Next.js dev double-evaluation),
 *        * unref'd timer (doesn't block process exit),
 *        * `setInterval` + `setImmediate` idempotent lifecycle.
 *    - `JobSchedulerService.runJob` is the shared execution path for both
 *      scheduled and manual triggers, so the scanner's job is purely:
 *      "find due jobs, call runJob()."
 *
 * Bree integration (Phase 2 — when untrusted code is handled):
 *    Each untrusted job will register a Bree job pointing at a runner file
 *    in `job-scheduler-runtime/`. The runner reconstructs a minimal Prisma
 *    context and calls `runJob`. For now, this module is the boot target
 *    that the side-effect import resolves to.
 *
 * Boot: `import '@/lib/job-scheduler-engine'` in an instrumentation/boot file.
 */

import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import {
  JobSchedulerService,
  parseSchedule,
  type JobHandler,
  type JobRunContext,
  type Schedule,
} from '@/services/job-scheduler-service';
import { checkHealthStatus, type HealthResponse } from '@/lib/health-check';
import { findDueToStartEvents } from '@/lib/calendar-event-scheduler';
import { pushNotification } from '@/lib/notification-push';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 10_000; // 10 s — how often to check for due jobs
const ENABLED = env.JOB_SCHEDULER_ENABLED !== 'false';
const POLL_ONLY = env.JOB_SCHEDULER_BOOT_REGISTRY === 'false'; // skip DB load

// ---------------------------------------------------------------------------
// Shared process state
// ---------------------------------------------------------------------------

type EngineState = {
  timer: ReturnType<typeof setInterval> | null;
  lastPoll: number;
};

function getState(): EngineState {
  const g = globalThis as unknown as Record<string, EngineState | undefined>;
  if (!g.jobSchedulerEngineState) {
    g.jobSchedulerEngineState = { timer: null, lastPoll: 0 };
    }
  return g.jobSchedulerEngineState;
}

const state = getState();

// ---------------------------------------------------------------------------
// Built-in handler registry
//
// Phase 1 built-in handlers go here. Each is a trusted, audited, scoped
// operation. The engine boot calls registerBuiltins() which registers all
// known handlers. Operators cannot define new handlers — they can only
// reference existing keys via JobDefinition.handlerKey.
//
// Phase 2: operators will author handlers stored in `code` column,
// materialised to tmp files under job-scheduler-runtime/ and loaded at
// run time by the Bree worker runner.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Built-in handlers
//
// These are the trusted Phase 1 set. Each is a plain, audited function keyed by
// `handlerKey`; operators reference them via JobDefinition.handlerKey but cannot
// define new ones (that is Phase 2's sandboxed `code` path). A runJob call for an
// unregistered key fails gracefully and is surfaced as a FAILED JobExecution.
//
// They run in the main-thread scanner (Phase 1 model), so they may use the
// parent's platform primitives (globalDb, pushNotification, health checks)
// directly — they never touch untrusted code.
// ---------------------------------------------------------------------------

/** `noop` — the minimal smoke-test handler. Proves the end-to-end path. */
export async function noopHandler(ctx: JobRunContext): Promise<unknown> {
  const input = ctx.input !== undefined ? JSON.stringify(ctx.input) : null;
  return { ok: true, handler: 'noop', trigger: ctx.trigger, hadInput: input !== null };
}

/**
 * `health-check` — run the shared platform health probe and, on an unhealthy
 * outcome, raise an operational alert. A healthy result is silent (the service's
 * own "Job completed" notification already confirms the run), so this does not
 * flood the ticker.
 */
export async function healthCheckHandler(): Promise<unknown> {
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
}

/**
 * `calendar-health-check` — probe the calendar "due to start" notification
 * pipeline by running the same discovery the live scanner uses
 * (`findDueToStartEvents`). If discovery throws, the job FAILS, so a broken
 * calendar-notification substrate becomes visible in execution history instead
 * of failing silently. A clean run reports how many instances are currently due
 * (normally 0 between events) without emitting its own event.
 */
export async function calendarHealthCheckHandler(): Promise<unknown> {
  const due = await findDueToStartEvents(new Date());
  return {
     handler: 'calendar-health-check',
     pipelineReachable: true,
     dueInstances: due.length,
     checkedAt: new Date().toISOString(),
    };
}

/**
 * `calendar-selftest` — prove the CALENDAR-priority notification path is
 * reachable by emitting exactly one CALENDAR SSE notification through the same
 * `pushNotification()` the live scanner uses, without needing a real due-to-start
 * event. It mirrors the scanner's emission (CALENDAR priority, `calendar:*`
 * source) but stays GLOBAL-scoped and time-stamped so each run is distinct and
 * lands on the platform-ops ticker rather than a tenant's ORG feed.
 *
 * Input: optional `{ message?, title? }` to customise the probe text.
 */
export async function calendarSelfTestHandler(ctx: JobRunContext): Promise<unknown> {
  const input = (ctx.input ?? {}) as { title?: unknown; message?: unknown };
  const now = new Date();
  await pushNotification({
      title: typeof input.title === 'string' ? input.title : 'Calendar notification path: self-test',
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
}

/**
 * Register the trusted built-in handler set. Idempotent — safe to call on every
 * boot / module re-evaluation.
 */
export function registerBuiltinHandlers(): void {
  const builtins: Array<{ key: string; handler: JobHandler }> = [
      { key: 'noop', handler: noopHandler },
      { key: 'health-check', handler: healthCheckHandler },
      { key: 'calendar-health-check', handler: calendarHealthCheckHandler },
      { key: 'calendar-selftest', handler: calendarSelfTestHandler },
   ];
  JobSchedulerService.registerBuiltins(builtins);
}

// ---------------------------------------------------------------------------
// Schedule matching
// ---------------------------------------------------------------------------

/**
 * Returns true if the given schedule is due at `now` and has not yet
 * been consumed since the last poll.
 *
 * cron — Phase 1 approximation: `* * * * *` fires every minute,
 *          a "every-N-minutes" pattern fires every N minutes
 *          (full cron parsing is Phase 2).
 * interval — fires every `everyMs` (strict).
 * oneshot — fires once at the `at` instant (idempotent via `lastRunAt`).
 *
 * The `lastRunAt` field on `JobDefinition` is the authoritative
 * "was this already handled" state.
 */
// Exported for tests (see tests/unit/job-scheduler-engine.test.ts).
export function isDueAt(now: Date, scheduleExpr: string, lastRunAt: Date | null): boolean {
  let schedule: Schedule;
  try {
    schedule = parseSchedule(scheduleExpr);
    } catch {
    // Malformed schedule — log once and skip
    return false;
  }
  if (schedule.kind === 'oneshot') {
    // oneshot: due if not yet fired and at <= now
    const atMs = new Date(schedule.at).getTime();
    if (Number.isNaN(atMs)) return false;
    if (lastRunAt && lastRunAt.getTime() >= atMs) return false;
    return atMs <= now.getTime();
    }
  if (schedule.kind === 'interval') {
    const sinceMs = lastRunAt ? lastRunAt.getTime() : 0;
    return now.getTime() - sinceMs >= schedule.everyMs;
    }
  if (schedule.kind === 'cron') {
    // Phase 1 cron: approximate — treat "* * * * *" as 1-min interval,
    // "*/N * * * *" as N-min interval. Full cron is Phase 2.
    // Default: 1 minute.
    const match = schedule.expr.match(/^\*\/?(\d*)\s+\*\s+\*\s+\*\s+\*$/);
    const minutes = match && match[1] ? Number(match[1]) : 1;
    const sinceMs = lastRunAt ? lastRunAt.getTime() : 0;
    return now.getTime() - sinceMs >= minutes * 60 * 1000;
    }
  return false;
}

// ---------------------------------------------------------------------------
// Scan: find due jobs, execute them
// ---------------------------------------------------------------------------

// Exported for tests (see tests/unit/job-scheduler-engine.test.ts).
export async function scanDueJobs(now = new Date()): Promise<number> {
  try {
    const jobs = await globalDb.jobDefinition.findMany({
      // Defence in depth for the approval gate: even if a row were somehow
      // enabled without approval (it shouldn't — enableJob/updateJob guard
      // it), the scheduler never runs an unapproved job.
      where: { enabled: true, approved: true },
       select: {
         id: true,
         name: true,
          scheduleExpr: true,
          handlerKey: true,
          lastRunAt: true,
       },
      orderBy: { updatedAt: 'asc' },
     });

    let executed = 0;

for (const job of jobs) {
    try {
      if (!isDueAt(now, job.scheduleExpr, job.lastRunAt)) continue;

      const result = await JobSchedulerService.runJob(job.id, {
        trigger: 'SCHEDULE',
        });

      if (result.claimed && result.status !== 'SKIPPED') {
        executed++;
       }
     } catch (err) {
      logger.error({ jobId: job.id, jobName: job.name, error: err },
        'Job scheduler: scan tick failed for job');
     }
   }

    if (executed > 0) {
      logger.info({ executed, scanned: jobs.length },
         'Job scheduler: scan tick executed jobs');
       }

      return executed;
     } catch (err) {
      logger.error({ error: err }, 'Job scheduler: scan tick DB failure');
      return 0;
    }
  }

// ---------------------------------------------------------------------------
// Timer lifecycle
// ---------------------------------------------------------------------------

export function startJobScheduler(): void {
  if (state.timer) return;
  if (!ENABLED) {
    console.log('[job-scheduler] Disabled via JOB_SCHEDULER_ENABLED=false');
    return;
    }

  // Register built-in handlers.
  registerBuiltinHandlers();

  // Bootstrap: load enabled jobs into the scanner.
  const pollOnce = () => {
    scanDueJobs().catch((err) =>
      console.error('[job-scheduler] Scan tick crashed:', err),
     );
   };

  state.timer = setInterval(pollOnce, SCAN_INTERVAL_MS);
  (state.timer as unknown as ReturnType<typeof setImmediate>).unref?.();

  // Kick one immediate scan on boot so jobs don't wait a full interval
  // if they were due since the last start.
  pollOnce();

  console.log(
   `[job-scheduler] Started (scan every ${SCAN_INTERVAL_MS / 1000}s, ` +
    `poll-only=${POLL_ONLY})`,
  );
}

export function stopJobScheduler(): void {
  const timer = state.timer;
  if (timer) {
    clearInterval(timer);
    state.timer = null;
   }
}

/**
 * For tests: reset state without the engine timer (test harness sets up
 * its own fake timers).
 */
export function resetJobSchedulerState(): void {
  stopJobScheduler();
  state.lastPoll = 0;
}

// Start on module load
startJobScheduler();

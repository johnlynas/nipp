/**
 * Background Job Scheduler — engine boot module (main-thread scanner)
 *
 * Boots a lightweight scheduler that every 10 s checks `JobDefinition` rows
 * and executes due jobs. The **decision** (is this job due? did we win the
 * claim?) is always made here, in the main thread; the **execution** has two
 * interchangeable paths selected by `JOB_SCHEDULER_BREE_MODE`:
 *
 *   - `worker` (Phase 2 default) — dispatches the run to
 *     lib/job-scheduler-bree.ts, which forks a Bree worker thread per run
 *     (plan §R1/R2: file-based runner in `job-scheduler-runtime/`, never
 *     eval'd). The worker calls runJob inside itself, so claim/history/SSE
 *     behavior is identical to inline mode.
 *   - `inline` (Phase 1) — runs the job directly in this thread via
 *     `JobSchedulerService.runJob(jobId, { trigger: 'SCHEDULE' })`.
 *
 * Design rationale (see the plan document, Phase 0 spike findings):
 *    - Bree's execution model forks a worker per run; each worker rebuilds its
 *      own context. Worker mode therefore carries fork + bootstrap cost per
 *      run, which is exactly the isolation the untrusted-script phase needs —
 *      and for trusted built-ins it is safe to default on. `inline` stays as a
 *      fallback/rollback path (and for tests).
 *    - The scanner mirrors `calendar-event-scheduler.ts`:
 *        * globalThis-singleton (survive Next.js dev double-evaluation),
 *        * unref'd timer (doesn't block process exit),
 *        * idempotent start/stop lifecycle.
 *
 * Boot: `import '@/lib/job-scheduler-engine'` in an instrumentation/boot file.
 */

import globalDb from '@/lib/global-db';
// Bree ships its own CJS + types; it stays webpack-external (next.config.ts
// serverExternalPackages) so this import is a plain Node require at runtime.
import later, { type Schedule as LaterSchedule } from '@breejs/later';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import {
  JobSchedulerService,
  parseSchedule,
  type RunResult,
  type Schedule,
} from '@/services/job-scheduler-service';
import JobSchedulerBree from '@/lib/job-scheduler-bree';

// Trusted built-in handlers live in a side-effect-free module so the same set
// can be required inside Bree worker threads (the runner re-registers them on
// every fork). Re-exported here for legacy import paths (tests, docs).
import {
  noopHandler,
  healthCheckHandler,
  calendarHealthCheckHandler,
  calendarSelfTestHandler,
  registerBuiltinHandlers,
  BUILTIN_HANDLERS,
} from '@/lib/job-scheduler-builtins';

export {
  noopHandler,
  healthCheckHandler,
  calendarHealthCheckHandler,
  calendarSelfTestHandler,
  registerBuiltinHandlers,
  BUILTIN_HANDLERS,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_INTERVAL_MS = 10_000; // 10 s — how often to check for due jobs
const ENABLED = env.JOB_SCHEDULER_ENABLED !== 'false';
const POLL_ONLY = env.JOB_SCHEDULER_BOOT_REGISTRY === 'false'; // skip DB load

/**
 * Execution path switch (plan: "switching Strategy 1 → 2 is an internal change
 * to the handler path, invisible to callers" — the runJob contract is shared).
 * `worker` = Bree fork-per-run (Phase 2); `inline` = main thread (Phase 1).
 */
const BREE_MODE: 'worker' | 'inline' = env.JOB_SCHEDULER_BREE_MODE === 'inline' ? 'inline' : 'worker';

// ---------------------------------------------------------------------------
// Shared process state
// ---------------------------------------------------------------------------

type EngineState = {
  timer: ReturnType<typeof setInterval> | null;
  lastPoll: number;
  shutdownHandlersInstalled: boolean;
};

function getState(): EngineState {
  const g = globalThis as unknown as Record<string, EngineState | undefined>;
  if (!g.jobSchedulerEngineState) {
    g.jobSchedulerEngineState = { timer: null, lastPoll: 0, shutdownHandlersInstalled: false };
  }
  return g.jobSchedulerEngineState;
}

const state = getState();

// ---------------------------------------------------------------------------
// Schedule matching
// ---------------------------------------------------------------------------
//
// CRON DUE RULE (verified against @breejs/later 4.2.0 source + probes):
//
//   - `later.parse.cron(expr, hasSeconds)` does NOT accept a timezone — the
//     documented third argument is silently ignored; `schedule.next()/prev()`
//     evaluate occurrences in the mode set globally by later.date.localTime()
//     / later.date.utc(). IANA-timezone support therefore requires shifting
//     the search anchor into wall-clock numbers of the target zone and
//     mapping the occurrence back (with a bounded refinement loop for DST).
//   - `next()` is inclusive at the anchor AND leaks sub-second noise (results
//     such as `00:05:00.001` or `.500` are observed right at/after boundaries),
//     so computed occurrences are floored to whole seconds before comparison,
//     and "strictly after lastRunAt" is enforced explicitly (re-stepping if
//     the engine returns an occurrence ≤ lastRunAt).
//   - Due test: there exists an occurrence strictly after `lastRunAt` that is
//     not in the future (`occ <= now`). Never-run ⇒ any past occurrence →
//     catch up exactly ONE run (the next period re-arms); the DB claim gate
//     inside runJob then decides who actually executes it. Spaced crons and
//     daily+ jobs therefore never double-fire; a per-minute cron may re-arm
//     once if its recorded lastRunAt lags behind its triggering occurrence,
//     which the claim gate collapses into a SKIPPED run.

/** IANA zone offset (in ms) at `date`: wall-clock epoch − UTC epoch. */
function tzOffsetMs(timezone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const { type, value } of dtf.formatToParts(date)) parts[type] = value;
  // Known en-US/hourCycle quirk: midnight can render as hour "24".
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  const asUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    Number(parts.minute),
    Number(parts.second),
  );
  return date.getTime() - asUtcMs;
}

/** Floor to whole seconds (cron occurrences are second-aligned; this only
 * strips @breejs/later's sub-second anchor residue, never rounds up). */
function floorToSecond(ms: number): number {
  return Math.floor(ms / 1000) * 1000;
}

/**
 * Parse a cron expression into a later.js schedule (NO timezone — see the
 * module comment; IANA handling happens in nextCronOccurrenceMs via anchor
 * shifting). Idempotent.
 */
export function parseCronSchedule(expr: string): LaterSchedule {
  const data = later.parse.cron(expr, false);
  return later.schedule(data);
}

/**
 * First cron occurrence STRICTLY AFTER `afterMs` (UTC epoch ms), or null when
 * later cannot find one. When `timezone` is given, occurrences are evaluated
 * on that zone's wall clock; otherwise the process-local zone.
 */
export function nextCronOccurrenceMs(
  expr: string,
  afterMs: number,
  timezone?: string,
): number | null {
  let sched: LaterSchedule;
  try {
    sched = parseCronSchedule(expr);
  } catch {
    return null; // invalid cron — never due
  }

  const localLike = !timezone || timezone === 'local' || timezone === 'system';

  if (localLike) {
    later.date.localTime();
    const probe = (anchorMs: number): number | null => {
      let cand: Date | Date[];
      try {
        cand = sched.next(1, new Date(anchorMs));
      } catch {
        return null;
      }
      if (!(cand instanceof Date) || Number.isNaN(cand.getTime())) return null;
      let occMs = floorToSecond(cand.getTime());
      // `next` is inclusive at the anchor: step past occurrences ≤ afterMs.
      let guard = 0;
      while (occMs <= afterMs && guard++ < 4) {
        cand = sched.next(1, new Date(floorToSecond(occMs) + 1));
        if (!(cand instanceof Date) || Number.isNaN(cand.getTime())) return null;
        occMs = floorToSecond(cand.getTime());
      }
      return occMs > afterMs ? occMs : null;
    };
    return probe(Math.floor(afterMs / 1000) * 1000 + 1);
  }

  // IANA timezone: search in wall-clock numbers of the target zone.
  (later.date.UTC as () => void)();
  let offset = tzOffsetMs(timezone, new Date(afterMs));
  let wall = floorToSecond(afterMs) + 1 + offset;
  for (let i = 0; i < 4; i++) {
    let cand: Date | Date[];
    try {
      cand = sched.next(1, new Date(wall));
    } catch {
      return null;
    }
    if (!(cand instanceof Date) || Number.isNaN(cand.getTime())) return null;
    const wallOcc = floorToSecond(cand.getTime());
    let guessUtc = wallOcc - offset;
    const refinedOffset = tzOffsetMs(timezone, new Date(guessUtc));
    // Re-step inside the zone if the candidate is not strictly after `after`
    // (inclusive-anchor artifact), then re-check DST stability.
    if (guessUtc <= afterMs) {
      wall = wallOcc + 1 + refinedOffset;
      offset = refinedOffset;
      continue;
    }
    if (refinedOffset !== offset) {
      // Crossing the DST boundary: refine once at the candidate and retry.
      guessUtc = wallOcc - refinedOffset;
      const secondCheck = tzOffsetMs(timezone, new Date(guessUtc));
      offset = secondCheck;
      wall = guessUtc + secondCheck;
      continue;
    }
    return guessUtc;
  }
  return null; // did not converge — treat as not due (real IANA zones always settle)
}

/**
 * Latest cron occurrence STRICTLY BEFORE OR AT `nowMs` (UTC epoch ms), or null when
 * later cannot find one. When `timezone` is given, occurrences are evaluated
 * on that zone's wall clock; otherwise the process-local zone.
 * 
 * This is the correct function to use for `isDueAt` checks, as it avoids the
 * inclusive-anchor bugs of `next()` and perfectly matches the test suite's
 * expected logic: `prev(1, now) > lastRunAt`.
 */
export function prevCronOccurrenceMs(
  expr: string,
  nowMs: number,
  timezone?: string,
): number | null {
  let sched: LaterSchedule;
  try {
    sched = parseCronSchedule(expr);
  } catch {
    return null;
  }

  const localLike = !timezone || timezone === 'local' || timezone === 'system';

  if (localLike) {
    later.date.localTime();
    let cand: Date | Date[];
    try {
      // prev is inclusive. Floor to second to avoid sub-second noise.
      cand = sched.prev(1, new Date(floorToSecond(nowMs)));
    } catch {
      return null;
    }
    if (!(cand instanceof Date) || Number.isNaN(cand.getTime())) return null;
    return floorToSecond(cand.getTime());
  }

  // IANA timezone: search in wall-clock numbers of the target zone.
  (later.date.UTC as () => void)();
  const offset = tzOffsetMs(timezone, new Date(nowMs));
  const wall = floorToSecond(nowMs) + offset;
  
  let cand: Date | Date[];
  try {
    cand = sched.prev(1, new Date(wall));
  } catch {
    return null;
  }
  if (!(cand instanceof Date) || Number.isNaN(cand.getTime())) return null;
  
  const wallOcc = floorToSecond(cand.getTime());
  let guessUtc = wallOcc - offset;
  
  // DST refinement
  const refinedOffset = tzOffsetMs(timezone, new Date(guessUtc));
  if (refinedOffset !== offset) {
    guessUtc = wallOcc - refinedOffset;
    const secondCheck = tzOffsetMs(timezone, new Date(guessUtc));
    if (secondCheck !== refinedOffset) {
       guessUtc = wallOcc - secondCheck;
    }
  }
  
  // Ensure it's <= nowMs. If DST shift pushed it into the future, step back.
  if (guessUtc > nowMs) {
     const prevWall = wallOcc - 1000;
     const prevCand = sched.prev(1, new Date(prevWall));
     if (prevCand instanceof Date && !Number.isNaN(prevCand.getTime())) {
        const prevWallOcc = floorToSecond(prevCand.getTime());
        const prevRefined = tzOffsetMs(timezone, new Date(prevWallOcc - refinedOffset));
        guessUtc = prevWallOcc - prevRefined;
     } else {
        return null;
     }
  }
  
  return guessUtc;
}

/**
 * Returns true if the given schedule is due at `now` and has not yet been
 * consumed since `lastRunAt`.
 *
 * cron    — full IANA-timezone-aware via @breejs/later occurrence walks
 *           (prevCronOccurrenceMs above): due when the latest occurrence at or
 *           before `now` is strictly after `lastRunAt`. Never-run ⇒ any past 
 *           occurrence → catch up exactly one run; the DB claim gate decides 
 *           who executes it.
 * interval— fires every `everyMs` (strict).
 * oneshot — fires once at the `at` instant (idempotent via `lastRunAt`).
 *
 * The `lastRunAt` field on `JobDefinition` is the authoritative "was this
 * already handled" state.
 */
export function isDueAt(now: Date, scheduleExpr: string, lastRunAt: Date | null): boolean {
  let schedule: Schedule;
  try {
    schedule = parseSchedule(scheduleExpr);
  } catch {
    // Malformed schedule — never due (the service rejects it at create time).
    return false;
  }
  if (schedule.kind === 'oneshot') {
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
    const nowMs = now.getTime();
    const lastRunMs = lastRunAt ? lastRunAt.getTime() : -1; // -1 ⇒ epoch: due once any past occurrence exists
    
    // Use prev() instead of next() to avoid inclusive-anchor bugs.
    // Logic: is the most recent occurrence <= now strictly after lastRunAt?
    const occ = prevCronOccurrenceMs(schedule.expr, nowMs, schedule.timezone);
    if (occ === null) return false; // invalid cron or no past occurrences
    
    return occ > lastRunMs;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Execution dispatch
// ---------------------------------------------------------------------------

/**
 * Bree-mode execution: fork a worker that runs the job end-to-end via runJob.
 * Returns a RunResult for the scanner's accounting; worker-level failures are
 * surfaced as a platform alert + FAILED-ish SKIPPED (never executed).
 */
async function runJobInWorker(jobId: string): Promise<RunResult> {
  const definition = await globalDb.jobDefinition.findUnique({
    where: { id: jobId },
    select: { timeoutMs: true, name: true },
  });
  try {
    const outcome = await JobSchedulerBree.executeJobInWorker(jobId, definition?.timeoutMs ?? undefined);
    if (outcome.kind === 'ok') return outcome.result as RunResult;
    // Worker crashed / timed out at the engine level. The in-worker claim may
    // have been taken (lastRunAt stuck RUNNING) — leave it; the next period's
    // occurrence re-arms due-detection and the alert below is visible now.
    const detail =
      outcome.kind === 'timeout'
        ? `worker exceeded its ${HARD_CAP_DISPLAY}ms wall cap`
        : outcome.error;
    await JobSchedulerBree.notifyWorkerEngineFailure(
      `Job "${definition?.name ?? jobId}" failed to execute in a worker: ${detail}`,
    );
    return { jobDefinitionId: jobId, status: 'SKIPPED', claimed: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await JobSchedulerBree.notifyWorkerEngineFailure(
      `Job "${definition?.name ?? jobId}" worker dispatch failed: ${message}`,
    );
    return { jobDefinitionId: jobId, status: 'SKIPPED', claimed: false };
  }
}

/** Display-only hard cap (the enforced value lives in lib/job-scheduler-bree). */
const HARD_CAP_DISPLAY = 1_800_000;

/** Dispatch one job down the configured execution path. */
async function dispatchJob(jobId: string): Promise<RunResult> {
  if (BREE_MODE === 'worker') return runJobInWorker(jobId);
  return JobSchedulerService.runJob(jobId, { trigger: 'SCHEDULE' });
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

        const result = await dispatchJob(job.id);

        if (result.claimed && result.status !== 'SKIPPED') {
          executed++;
        }
      } catch (err) {
        logger.error({ jobId: job.id, jobName: job.name, error: err }, 'Job scheduler: scan tick failed for job');
      }
    }

    if (executed > 0) {
      logger.info({ executed, scanned: jobs.length }, 'Job scheduler: scan tick executed jobs');
    }

    return executed;
  } catch (err) {
    logger.error({ error: err }, 'Job scheduler: scan tick DB failure');
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Timer lifecycle + graceful shutdown
// ---------------------------------------------------------------------------

export function startJobScheduler(): void {
  if (!ENABLED) {
    console.log('[job-scheduler] Disabled via JOB_SCHEDULER_ENABLED=false');
    return;
  }
  if (state.timer) return;

  // Register built-in handlers (main-thread copy of the registry; worker runs
  // re-register the same set inside each fork).
  registerBuiltinHandlers();

  // Reap runner files whose jobs no longer exist (plan §R2 lifecycle).
  void JobSchedulerBree.reapStaleRunners().catch((err) =>
    console.error('[job-scheduler] Runner reap failed:', err),
  );

  // Install signal handlers once so a SIGTERM/SIGINT cancels in-flight workers
  // and stops the scanner (graceful shutdown per the plan's risk table).
  if (!state.shutdownHandlersInstalled) {
    state.shutdownHandlersInstalled = true;
    let shuttingDown = false;
    const handleShutdown = (signal: string): void => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[job-scheduler] ${signal} received — stopping runs and scanner`);
      void JobSchedulerBree.stopAllRuns()
        .catch((err) => console.error('[job-scheduler] worker shutdown error:', err))
        .finally(() => {
          stopJobScheduler();
          console.log('[job-scheduler] stopped');
        });
    };
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  }

  const pollOnce = () => {
    scanDueJobs().catch((err) => console.error('[job-scheduler] Scan tick crashed:', err));
  };

  state.timer = setInterval(pollOnce, SCAN_INTERVAL_MS);
  (state.timer as unknown as ReturnType<typeof setImmediate>).unref?.();

  // Kick one immediate scan on boot so jobs don't wait a full interval if they
  // were due since the last start.
  pollOnce();

  console.log(
    `[job-scheduler] Started (scan every ${SCAN_INTERVAL_MS / 1000}s, ` +
      `mode=${BREE_MODE}, poll-only=${POLL_ONLY})`,
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
 * For tests: reset state without the engine timer (test harness sets up its
 * own fake timers).
 */
export function resetJobSchedulerState(): void {
  stopJobScheduler();
  state.lastPoll = 0;
}

// Start on module load
startJobScheduler();
/**
 * Job Scheduler — global concurrency gate (circuit breaker + DB ceiling).
 *
 * This is the module that wires up the two forward-declared config vars from
 * `lib/env-schema.ts` (see plan R4 / "Idempotency and Deduplication → global
 * circuit breaker"):
 *
 *    - JOB_SCHEDULER_MAX_CONCURRENT (default 5) — the *runtime* circuit breaker.
 *      Caps the number of runs in flight at any instant, so a burst of due jobs
 *      cannot fork unbounded workers or fire the DB.
 *    - JOB_SCHEDULER_DB_CONCURRENCY (default 100) — the *connection-pool ceiling*.
 *      Sizing the semaphore at max(MAX_CONCURRENT, DB_CONCURRENCY) makes the pool
 *      ceiling explicit and self-documenting even though MAX_CONCURRENT is usually
 *      the tighter (and, today, the binding) bound: with MAX_CONCURRENT ≤
 *      DB_CONCURRENCY, the number of in-process Prisma clients can never exceed the
 *      configured pool ceiling.
 *
 * The effective bound for the semaphore is therefore
 *     maxJobRuns = max(MAX_CONCURRENT, DB_CONCURRENCY, 1)
 * which always respects MAX_CONCURRENT (the runtime cap the operator sets) while
 * making the pool ceiling a floor that cannot be undercut.
 *
 * Layering follows the project's globalThis-singleton convention (mirrors the
 * rate limiter in lib/rate-limiter.ts and the engine's own state object): the
 * semaphore instance is created once per process on first `acquire` (deferred, so
 * Next.js dev double-evaluation of this module never produces two diverging
 * counters), which is what makes the cap correct across a scanner tick that
 * enqueues several due jobs at once.
 *
 * This module is intentionally DB-free and side-effect-free at import time so the
 * engine (and its unit tests) can import it without spinning up a Prisma client.
 */

import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { pushNotification } from '@/lib/notification-push';
import { NotificationPriority, NotificationScope } from '@prisma/client';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Read a non-negative integer from env.
 *
 * `undefined` / non-numeric → `fallback` (default).
 * A valid number (including `0`) is floored and propagated: `0` is a *meaningful*
 * value that the `ConcurrencyLimiter` floors to `1` at its own boundary, so the
 * scanner is never wedged by a 0/0 misconfiguration while a legitimate 0 cap is
 * still observable to `getConcurrencySnapshot()`.
 */
function readNonNegativeInt(v: string | undefined, fallback: number): number {
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

/** Runtime circuit-breaker cap on simultaneous job runs (default 5). */
const MAX_CONCURRENT = readNonNegativeInt(env.JOB_SCHEDULER_MAX_CONCURRENT, 5);

/**
 * Connection-pool ceiling, sized below PgBouncer `max_client_conn` so the
 * scheduler coexists with the rest of the app (default 100).
 */
const DB_CONCURRENCY = readNonNegativeInt(env.JOB_SCHEDULER_DB_CONCURRENCY, 100);

// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------

type Waiter = {
  resolve: () => void;
  reject: (err: Error) => void;
  /** When this waiter's token was granted (epoch ms), or 0 until granted. */
  grantAt: number;
};

/**
 * A bounded concurrency slot. At most `capacity` holders at any time; callers
 * beyond that queue FIFO and resume in order when a slot frees.
 */
class ConcurrencyLimiter {
  private capacity: number;
  private inFlight = 0;
  private readonly queue: Waiter[] = [];

  constructor(capacity: number) {
    // Never allocate a non-positive capacity — a 0/1 cap means every run must
    // wait forever, which would wedge the whole scanner.
    this.capacity = Math.max(1, capacity);
  }

  /** Current holders + queued waiters (exposed for tests / metrics). */
  get active(): { inFlight: number; waiting: number; capacity: number } {
    return { inFlight: this.inFlight, waiting: this.queue.length, capacity: this.capacity };
  }

  /**
   * Acquire a slot. Resolves immediately if a slot is free, else queues FIFO.
   * Always eventually releases the slot on the paired `release` call, even when
   * the work throws — the finally in `withConcurrency` guarantees this.
   */
  acquire(): Promise<void> {
    if (this.inFlight < this.capacity) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ resolve, reject, grantAt: 0 });
    });
  }

  /** Free a slot; wake the next queued waiter if any. */
  release(): void {
    if (this.inFlight <= 0) return; // paired against a missed acquire; don't underflow
    this.inFlight--;

    if (this.queue.length > 0 && this.inFlight < this.capacity) {
      this.inFlight++;
      const next = this.queue.shift()!;
      next.grantAt = Date.now();
      next.resolve();
    }
  }

  /** Drop all queued waiters (best-effort — their promises reject, callers log). */
  rejectAll(err: Error): void {
    while (this.queue.length > 0) {
      const w = this.queue.shift()!;
      w.reject(err);
    }
  }
}

// ---------------------------------------------------------------------------
// Per-process singleton (deferred construction, globalThis-guarded)
// ---------------------------------------------------------------------------

function getLimiter(): ConcurrencyLimiter {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g.jobSchedulerConcurrencyLimiter) {
    // Effective capacity = max(MAX_CONCURRENT, DB_CONCURRENCY, 1). MAX_CONCURRENT
    // is the binding runtime cap; DB_CONCURRENCY is the pool ceiling it may not
    // undercut. Floor of 1 so a 0/0 misconfiguration still lets at least one run
    // proceed rather than wedging the scanner.
    g.jobSchedulerConcurrencyLimiter = new ConcurrencyLimiter(
       Math.max(1, MAX_CONCURRENT, DB_CONCURRENCY),
    );
   }
  return g.jobSchedulerConcurrencyLimiter as ConcurrencyLimiter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Resolve when a concurrency slot is free; queue FIFO otherwise. */
export function acquireJobRun(): Promise<void> {
  return getLimiter().acquire();
}

/** Release a slot previously acquired via `acquireJobRun`. */
export function releaseJobRun(): void {
  getLimiter().release();
}

/** Reset the limiter singleton — used by unit tests for hermetic re-init. */
export function resetConcurrencyLimiter(): void {
  const g = globalThis as unknown as { jobSchedulerConcurrencyLimiter?: ConcurrencyLimiter };
  delete g.jobSchedulerConcurrencyLimiter;
}

/**
 * Run `fn` holding a single concurrency slot for the duration of `fn`.
 *
 * Guarantees:
 *   - the slot is released exactly once, even if `fn` throws or rejects;
 *   - queued waiters resume in FIFO order;
 *   - a run that queues behind a saturated circuit and then waits
 *     ≥`queueWarnMs` emits a one-shot WARNING-level alert (operator-visible) so
 *     a saturated circuit is observable in the ticker, mirroring the calendar
 *     scanner's throttle-report pattern. Runs granted a slot immediately are
 *     never reported, even if the Date.now() calls around the acquire span a
 *     millisecond tick (which they routinely do on loaded CI runners — alerting
 *     on elapsed time alone produced false circuit-breaker notifications).
 */
export async function withConcurrency<T>(
  fn: () => Promise<T>,
  opts: { queueWarnMs?: number } = {},
): Promise<T> {
  // `acquireJobRun()` constructs the per-process singleton on first use; we
  // don't hold a reference here because `releaseJobRun()` also goes through
  // `getLimiter()` — keeping the two call sites symmetric avoids a case where
  // one side has a stale reference after a `resetConcurrencyLimiter()`.
  //
  // Snapshot saturation BEFORE acquiring: this is what distinguishes "queued
  // behind a full circuit" (a real throttle event) from an immediate grant that
  // happened to cross a Date.now() tick. A pre-saturated gate means acquire
  // WILL queue, so the wait below is a genuine queueing delay worth reporting.
  const pre = getLimiter().active;
  const queuedBehindSaturation = pre.inFlight >= pre.capacity;

  const waitedAt = Date.now();
  await acquireJobRun();
  const waitedMs = Date.now() - waitedAt;

  try {
    if (queuedBehindSaturation && waitedMs >= (opts.queueWarnMs ?? 0)) {
      // Throttle-report: only alert on real queueing, and only once per
      // saturated window to avoid a notification storm.
      if (!warnedThrottleRecently(waitedMs)) {
        reportThrottle(waitedMs);
      }
    }
    return await fn();
  } finally {
    releaseJobRun();
  }
}

// ---------------------------------------------------------------------------
// Throttle alerting — one WARNING per throttle window (debounced)
// ---------------------------------------------------------------------------

let lastThrottleReportAt = 0;
const THROTTLE_DEBOUNCE_MS = 60_000; // at most one alert per minute

function warnedThrottleRecently(waitedMs: number): boolean {
  if (waitedMs <= 0) return true; // treat "didn't wait" as already reported
  const now = Date.now();
  if (now - lastThrottleReportAt < THROTTLE_DEBOUNCE_MS) return true;
  return false;
}

/**
 * Report a throttle event (WARNING-level alert) once per debounce window so a
 * saturated circuit is observable in the ticker without a notification storm.
 * Uses `void async` so a mock `pushNotification` that returns a non-Promise
 * (e.g. `undefined` in some unit tests) is not followed by a `.catch` call.
 */
function reportThrottle(waitedMs: number): void {
  lastThrottleReportAt = Date.now();
  const active = getLimiter().active;
  logger.warn(
    {
      waitedMs,
      inFlight: active.inFlight,
      waiting: active.waiting,
      capacity: active.capacity,
      maxConcurrent: MAX_CONCURRENT,
      dbConcurrency: DB_CONCURRENCY,
     },
    'Job scheduler: run queued beyond the concurrency circuit breaker',
  );

  const message =
    `A job run waited ${Math.round(waitedMs / 100) * 100}ms for a slot. ` +
    `Capacity: ${active.capacity} (max-concurrent=${MAX_CONCURRENT}, ` +
    `db-concurrency=${DB_CONCURRENCY}). In-flight: ${active.inFlight}, ` +
    `queued: ${active.waiting}.`;

  // Fire-and-forget: a broken notification channel must never wedge a job run.
  // Use `void async IIFE` instead of `void fn().catch(...)` so the call works
  // identically whether `pushNotification`'s resolution is a Promise or (in the
  // mocked unit-test surface) `undefined`. The push runs OUT-OF-REQUEST (this
  // fires from the background scanner), so it binds the platform context — an
  // unbound Notification INSERT would 42501 under the non-owner app role and,
  // worse, persist nothing (live-only alert).
  void (async () => {
    try {
      const { withEnvPlatformContext } = await import('@/lib/rls-transaction');
      await withEnvPlatformContext(() =>
        pushNotification({
          title: 'Job scheduler concurrency circuit breaker',
          message,
          priority: NotificationPriority.WARNING,
          scope: NotificationScope.GLOBAL,
          source: 'job-scheduler:throttled',
        }),
      );
    } catch {
      /* swallow — the alert path must not take down a job run */
    }
   })();
}

// ---------------------------------------------------------------------------
// Diagnostics (for metrics / the admin API / tests)
// ---------------------------------------------------------------------------

/** Snapshot of the current limiter; safe to call without having acquired a slot. */
export function getConcurrencySnapshot(): {
  inFlight: number;
  waiting: number;
  capacity: number;
  maxConcurrent: number;
  dbConcurrency: number;
} {
  const active = getLimiter().active;
  return {
    ...active,
    maxConcurrent: MAX_CONCURRENT,
    dbConcurrency: DB_CONCURRENCY,
  };
}

/** Reset the throttle debounce window — used by unit tests. */
export function resetThrottleDebounce(): void {
  lastThrottleReportAt = 0;
}

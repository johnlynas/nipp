/**
 * Unit tests for the job-scheduler global concurrency gate
 * (lib/job-scheduler-concurrency.ts) — the circuit breaker that bounds the
 * number of runs in flight to `MAX_CONCURRENT` / capped by the `DB_CONCURRENCY`
 * pool ceiling (plan R4 / "Idempotency and Deduplication → global circuit
 * breaker").
 *
 * The gate captures its caps from `env` at module-eval time, so each test varies
 * `process.env` (the real @/lib/env reads process.env at import, with defaults
 * when a var is absent) and re-imports the module via `vi.resetModules()` — the
 * same technique as tests/unit/job-scheduler-engine-lifecycle.test.ts. logger /
 * notification-push are mocked so the throttle alert path is observable without a
 * real DB/Prisma client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Dependency mocks ----------------------------------------------------
// env is the REAL module: it derives from process.env at import time, so varying
// process.env + resetModules gives each test a controlled set of caps.

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/notification-push', () => ({ pushNotification: vi.fn() }));

// --- Test helpers --------------------------------------------------------

/**
 * Import a *fresh* evaluation of the concurrency module under the given caps.
 * `MAX_CONCURRENT` is the runtime cap; `DB_CONCURRENCY` the pool ceiling; the
 * effective semaphore size is `max(MAX_CONCURRENT, DB_CONCURRENCY, 1)`.
 */
async function importConcurrency(capMax?: string, capDb?: string) {
  if (capMax === undefined) delete process.env.JOB_SCHEDULER_MAX_CONCURRENT;
  else process.env.JOB_SCHEDULER_MAX_CONCURRENT = capMax;
  if (capDb === undefined) delete process.env.JOB_SCHEDULER_DB_CONCURRENCY;
  else process.env.JOB_SCHEDULER_DB_CONCURRENCY = capDb;
  vi.resetModules();
  return import('@/lib/job-scheduler-concurrency');
}

const tick = () => new Promise((r) => setImmediate(r));
const hold = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Ensure all module mocks reset between tests (the hoisted `vi.fn()` for
// logger / pushNotification is shared across re-imports).
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.useRealTimers();
   // Drop any env the tests set so other suites aren't polluted.
  delete process.env.JOB_SCHEDULER_MAX_CONCURRENT;
  delete process.env.JOB_SCHEDULER_DB_CONCURRENCY;
});

// --- Capacity resolution --------------------------------------------------

describe('concurrency gate — capacity resolution (max of the two, floored at 1)', () => {
  it('defaults to the DB_CONCURRENCY ceiling (100) when MAX is the default (5)', async () => {
    const m = await importConcurrency(); // both default
    m.resetConcurrencyLimiter();
    const snap = m.getConcurrencySnapshot();
    expect(snap.capacity).toBe(100);
    expect(snap.maxConcurrent).toBe(5);
    expect(snap.dbConcurrency).toBe(100);
    });

  it('honours MAX_CONCURRENT when it exceeds the DB ceiling', async () => {
    const m = await importConcurrency('50', '10');
    m.resetConcurrencyLimiter();
    expect(m.getConcurrencySnapshot().capacity).toBe(50);
    });

  it('floors a 0/0 misconfiguration to 1 so the scanner is never wedged', async () => {
    const m = await importConcurrency('0', '0');
    m.resetConcurrencyLimiter();
    expect(m.getConcurrencySnapshot().capacity).toBe(1);
    });
});

// --- Cap enforcement + FIFO ----------------------------------------------

describe('concurrency gate — cap enforcement and FIFO queue', () => {
  it('never exceeds the cap in flight and resumes queued runs FIFO', async () => {
    const m = await importConcurrency('2', '2'); // cap = 2
    m.resetConcurrencyLimiter();

    let inFlight = 0;
    let maxInFlight = 0;
    const starts: string[] = [];
    const releases: Array<() => void> = [];

    const run = (id: string) =>
      m.withConcurrency(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        starts.push(id);
         // Block until this test explicitly releases the slot.
        await new Promise<void>((res) => {
          releases.push(res);
         });
        inFlight--;
        });

    const all = [run('a'), run('b'), run('c'), run('d')];

     // Two runs acquire immediately; c and d queue.
    await tick();
    await tick();
    expect(starts).toEqual(['a', 'b']);
    expect(maxInFlight).toBe(2);
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 2, waiting: 2 });

     // Free a's slot → next-queued (c) starts, holding the cap at 2.
    releases[0]();
    await tick();
    expect(starts).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(2);

     // Free b's slot → next-queued (d) starts.
    releases[1]();
    await tick();
    expect(starts).toEqual(['a', 'b', 'c', 'd']);
    expect(maxInFlight).toBe(2);

     // Drain the remaining runs.
    releases[2]();
    releases[3]();
    await Promise.all(all);

    expect(maxInFlight).toBe(2);
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 0, waiting: 0 });
    });
});

// --- Release on error -----------------------------------------------------

describe('concurrency gate — release on error', () => {
  it('frees the slot when a run throws, so the next run acquires', async () => {
    const m = await importConcurrency('1', '1'); // cap = 1
    m.resetConcurrencyLimiter();

     // A throwing run must still release its slot in a finally.
    await expect(m.withConcurrency(async () => {
      throw new Error('boom');
       })).rejects.toThrow('boom');

     // With cap=1, a held slot would make the next run queue (waiting=1). A
     // drained gate means the thrower released its slot.
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 0, waiting: 0 });

     // The next run acquires without queueing.
    const got = await m.withConcurrency(async () => 42);
    expect(got).toBe(42);
    expect(m.getConcurrencySnapshot().inFlight).toBe(0);
    });
});

// --- Per-process singleton ------------------------------------------------

describe('concurrency gate — per-process singleton', () => {
  it('acquires and releases through the shared instance and resets cleanly', async () => {
    const m = await importConcurrency('5', '10'); // cap = 10
    m.resetConcurrencyLimiter();

    await m.acquireJobRun();
    await m.acquireJobRun();
    expect(m.getConcurrencySnapshot().inFlight).toBe(2);

     // After dropping the instance, a fresh gate starts at 0.
    m.resetConcurrencyLimiter();
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 0, waiting: 0 });

     // The freshly-built gate is usable again.
    await m.acquireJobRun();
    expect(m.getConcurrencySnapshot().inFlight).toBe(1);
    await m.releaseJobRun();
    });
});

// --- Throttle alerting ----------------------------------------------------

describe('concurrency gate — throttle alert', () => {
  it('does not alert when a run acquires a slot immediately', async () => {
    const m = await importConcurrency('10', '10');
    m.resetConcurrencyLimiter();
    m.resetThrottleDebounce?.();

    const { pushNotification } = await import('@/lib/notification-push');
    const push = pushNotification as unknown as ReturnType<typeof vi.fn>;

     // Two fast sequential runs — neither queues beyond the cap of 10.
    await m.withConcurrency(async () => 'x');
    await m.withConcurrency(async () => 'y');

    expect(push).not.toHaveBeenCalled();
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 0, waiting: 0 });
    });

  it('emits one throttle alert when a run has to queue for a slot', async () => {
    const m = await importConcurrency('1', '1'); // cap = 1 → any 2nd run queues
    m.resetConcurrencyLimiter();
    m.resetThrottleDebounce?.();

    const { pushNotification } = await import('@/lib/notification-push');
    const push = pushNotification as unknown as ReturnType<typeof vi.fn>;

     // Hold a slot open so the second run queues.
    let releaseFirst!: () => void;
    const first = m.withConcurrency(
       async () => new Promise<void>((res) => { releaseFirst = res; }),
      { queueWarnMs: 1 },
     );
    await tick();
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 1, waiting: 0 });

     // Second run must wait for the single slot.
    const second = m.withConcurrency(async () => 'done', { queueWarnMs: 1 });
    await tick();
    // Give the second run time to queue up
    await hold(2);
    expect(m.getConcurrencySnapshot()).toMatchObject({ waiting: 1 });
    expect(push).not.toHaveBeenCalled(); // not yet — it is still queued, not "done waiting"

     // Free the slot; the second run proceeds, crosses its queue threshold, and
     // fires exactly one alert (the gate is debounced, so no storm).
    releaseFirst();
    await second;
    await tick();
    const calls = push.mock.calls as [Record<string, unknown> | undefined][];
    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toMatchObject({
     priority: 'WARNING',
     scope: 'GLOBAL',
     source: 'job-scheduler:throttled',
       });

     // Everything drained.
    expect(m.getConcurrencySnapshot()).toMatchObject({ inFlight: 0, waiting: 0 });
    });
});

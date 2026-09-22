/**
 * Timer-lifecycle coverage for lib/job-scheduler-engine.ts.
 *
 * The main engine test file mocks JOB_SCHEDULER_ENABLED='false' so the module
 * import stays hermetic (no real timer, no boot scan). This file flips that
 * switch so the *enabled* boot path — register built-ins + an unref'd scan
 * timer + the immediate boot poll — can be exercised end to end.
 *
 * Strategy: the engine captures `ENABLED` and its `state` singleton at module
 * load, so each test imports a *fresh* module via `vi.resetModules()` + dynamic
 * `import()` inside the test (no static top-level import — that would boot the
 * engine under the wrong timer context before the test could set up fake
 * timers).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Dependency mocks -----------------------------------------------------

const mockFindMany = vi.fn();
const mockRunJob = vi.fn();

vi.mock('@/lib/notification-push', () => ({ pushNotification: vi.fn() }));
vi.mock('@/lib/health-check', () => ({ checkHealthStatus: vi.fn() }));
vi.mock('@/lib/calendar-event-scheduler', () => ({ findDueToStartEvents: vi.fn() }));
vi.mock('@/lib/tenant-db', () => ({
  default: { jobDefinition: { findMany: mockFindMany } },
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Enabled boot path: the engine reads env.JOB_SCHEDULER_ENABLED at load.
vi.mock('@/lib/env', () => ({
  env: {
    JOB_SCHEDULER_ENABLED: 'true',
    JOB_SCHEDULER_BOOT_REGISTRY: 'true',
    // Scanner-lifecycle tests dispatch inline; the worker path is covered by
    // tests/unit/job-scheduler-bree.test.ts and the nipp_dev integration test.
    JOB_SCHEDULER_BREE_MODE: 'inline',
  },
}));

// The Bree executor module: hermetic stub (no real Bree instance, no runner
// files, no worker forks) for the scanner-lifecycle tests.
vi.mock('@/lib/job-scheduler-bree', () => ({
  default: {
    executeJobInWorker: vi.fn(),
    stopOneRun: vi.fn(),
    stopAllRuns: vi.fn().mockResolvedValue(undefined),
    reapStaleRunners: vi.fn().mockResolvedValue(0),
    notifyWorkerEngineFailure: vi.fn(),
  },
}));

// Mock registerBuiltins/runJob; keep parseSchedule real so a 1-minute cron with
// lastRunAt=null is "due immediately" and the boot poll actually runs a job.
vi.mock('@/services/job-scheduler-service', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/services/job-scheduler-service')>();
  return {
     ...actual,
   JobSchedulerService: {
      registerBuiltins: vi.fn(),
      runJob: mockRunJob,
    },
  };
});

// A due 1-minute cron.
const DUE_CRON = JSON.stringify({ kind: 'cron', expr: '* * * * *' });

/** Import a *fresh* evaluation of the engine under fake timers. */
async function bootEngine() {
  vi.resetModules();
  vi.useFakeTimers();
  return import('@/lib/job-scheduler-engine');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('job-scheduler engine — enabled boot path', () => {
  it('boots: registers built-ins, installs a scan timer, and runs a due job', async () => {
    mockFindMany.mockResolvedValue([
       { id: 'job-a', name: 'a', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
     ]);
    mockRunJob.mockResolvedValue({ jobDefinitionId: 'job-a', status: 'SUCCEEDED', claimed: true });

    const { startJobScheduler, stopJobScheduler } = await bootEngine();

    startJobScheduler();
    expect((globalThis as unknown as { jobSchedulerEngineState: { timer: unknown } })
         .jobSchedulerEngineState.timer).not.toBeNull();

     // The boot poll (pollOnce) found a due job and ran it via runJob.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRunJob).toHaveBeenCalledWith('job-a', { trigger: 'SCHEDULE' });

     // A further scan tick after the interval runs again.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockRunJob.mock.calls.length).toBeGreaterThanOrEqual(2);

      // Stopping clears the timer so no further scan ticks run.
    stopJobScheduler();
    expect((globalThis as unknown as { jobSchedulerEngineState: { timer: unknown } })
         .jobSchedulerEngineState.timer).toBeNull();
    const runsAfterStop = mockRunJob.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockRunJob.mock.calls.length).toBe(runsAfterStop);

    vi.useRealTimers();
   }, 5000);

  it('startJobScheduler is idempotent — a second boot installs no extra timer', async () => {
    mockFindMany.mockResolvedValue([]);

    const { startJobScheduler } = await bootEngine();
    startJobScheduler();
    const g = globalThis as unknown as { jobSchedulerEngineState: { timer: unknown } };
    const timerAfterFirst = g.jobSchedulerEngineState.timer;

    startJobScheduler();
    expect(g.jobSchedulerEngineState.timer).toBe(timerAfterFirst); // same, not new

    vi.useRealTimers();
   }, 5000);

  it('a second startJobScheduler call is a no-op while the timer is running', async () => {
    mockFindMany.mockResolvedValue([]);

    const { startJobScheduler, stopJobScheduler } = await bootEngine();
    startJobScheduler();
    const g = globalThis as unknown as { jobSchedulerEngineState: { timer: unknown } };
    const timerWhileRunning = g.jobSchedulerEngineState.timer;
    expect(timerWhileRunning).not.toBeNull();

     // Idempotent on the live timer.
    startJobScheduler();
    expect(g.jobSchedulerEngineState.timer).toBe(timerWhileRunning);

    stopJobScheduler();
    expect(g.jobSchedulerEngineState.timer).toBeNull();

     // Re-arming after stop schedules a new timer.
    startJobScheduler();
    expect(g.jobSchedulerEngineState.timer).not.toBeNull();
    expect(g.jobSchedulerEngineState.timer).not.toBe(timerWhileRunning);

    vi.useRealTimers();
   }, 5000);

  it('swallows a scan-tick rejection and keeps the engine alive', async () => {
    mockFindMany.mockRejectedValue(new Error('db down'));

    const { startJobScheduler } = await bootEngine();
    expect(() => startJobScheduler()).not.toThrow();

     // The boot pollOnce() rejects internally (caught by its .catch) — runJob is
     // never reached and no error propagates.
    await vi.advanceTimersByTimeAsync(0);
    expect(mockRunJob).not.toHaveBeenCalled();

    vi.useRealTimers();
   }, 5000);
});

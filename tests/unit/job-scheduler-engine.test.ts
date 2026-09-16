/**
 * Unit tests for the job-scheduler engine's trusted built-in handlers
 * (lib/job-scheduler-engine.ts) and its registration.
 *
 * These cover the Phase 1 handler set — the operations operators can attach to a
 * JobDefinition via `handlerKey`:
 *    - noop                 : end-to-end smoke test
 *    - health-check         : platform health probe; alerts on unhealthy
 *    - calendar-health-check: exercises the calendar discovery pipeline
 *    - calendar-selftest     : emits one CALENDAR-priority SSE probe
 *
 * Dependencies (health probe, calendar discovery, SSE push, the service's
 * registerBuiltins) are mocked so each handler's logic is verified in
 * isolation, with no real DB / infra.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Dependency mocks (hoisted by vitest) --------------------------------

vi.mock('@/lib/notification-push', () => ({
  pushNotification: vi.fn(),
}));

vi.mock('@/lib/health-check', () => ({
  checkHealthStatus: vi.fn(),
}));

vi.mock('@/lib/calendar-event-scheduler', () => ({
  findDueToStartEvents: vi.fn(),
}));

// The engine imports global-db; keep the boot-time scan a no-op. The
// `findMany` mock is created inline in the factory (vitest hoists vi.mock above
// every top-level const, so a module-level handle would trip the TDZ) and
// derived as `mockFindMany` after import below.
vi.mock('@/lib/global-db', () => ({
  default: { jobDefinition: { findMany: vi.fn().mockResolvedValue([]) } },
}));

// Engine config: disable the boot side-effect scan so the module import stays
// hermetic (no timer, no scan). Handlers are tested via their exported fns and
// registerBuiltinHandlers() is called explicitly.
vi.mock('@/lib/env', () => ({
  env: {
   JOB_SCHEDULER_ENABLED: 'false',
   JOB_SCHEDULER_BOOT_REGISTRY: 'true',
   JOB_SCHEDULER_BREE_MODE: 'inline',
   },
}));

// The service gives registerBuiltins + parseSchedule (+ runJob for the scanner);
// mock so the engine boots without a real scheduler/role engine and so we can
// spy on registration and job execution. `runJob` is created inline and derived
// as `mockRunJob` after import. parseSchedule is spied on the *real*
// implementation so isDueAt/scanDueJobs exercise genuine schedule parsing.
vi.mock('@/services/job-scheduler-service', async (importOriginal) => {
  const actual =
   await importOriginal<typeof import('@/services/job-scheduler-service')>();
  return {
     ...actual,
     JobSchedulerService: { registerBuiltins: vi.fn(), runJob: vi.fn() },
   };
});

// Hermetic Bree executor stub (no instance, no forks) — these tests run in
// `inline` mode and only need the surface the engine imports.
vi.mock('@/lib/job-scheduler-bree', () => ({
  default: {
    executeJobInWorker: vi.fn(),
    stopOneRun: vi.fn(),
    stopAllRuns: vi.fn().mockResolvedValue(undefined),
    reapStaleRunners: vi.fn().mockResolvedValue(0),
    notifyWorkerEngineFailure: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// --- Imports under test ---------------------------------------------------

import {
  noopHandler,
  healthCheckHandler,
  calendarHealthCheckHandler,
  calendarSelfTestHandler,
  registerBuiltinHandlers,
  isDueAt,
  scanDueJobs,
  startJobScheduler,
  stopJobScheduler,
} from '@/lib/job-scheduler-engine';
import { JobSchedulerService } from '@/services/job-scheduler-service';
import { checkHealthStatus } from '@/lib/health-check';
import { findDueToStartEvents } from '@/lib/calendar-event-scheduler';
import { pushNotification } from '@/lib/notification-push';
import type { JobRunContext } from '@/services/job-scheduler-service';
import globalDb from '@/lib/global-db';

// --- Typed mock handles ---------------------------------------------------

const mockPush = pushNotification as unknown as {
  mock: { calls: [Record<string, unknown>][] };
};
const mockCheck = checkHealthStatus as unknown as ReturnType<typeof vi.fn>;
const mockDue = findDueToStartEvents as unknown as ReturnType<typeof vi.fn>;
const mockRegister = (JobSchedulerService as unknown as {
  registerBuiltins: ReturnType<typeof vi.fn>;
}).registerBuiltins;
const mockRunJob = (JobSchedulerService as unknown as {
  runJob: ReturnType<typeof vi.fn>;
}).runJob;
const mockFindMany =
 (globalDb as unknown as { jobDefinition: { findMany: ReturnType<typeof vi.fn> } })
       .jobDefinition.findMany;

const ctx: JobRunContext = {
  jobDefinitionId: 'job-1',
  platformOrgId: 'platform-org-123',
  trigger: 'MANUAL',
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Registration ---------------------------------------------------------

describe('registerBuiltinHandlers', () => {
  it('registers the four trusted built-in handlers as functions', () => {
    registerBuiltinHandlers();
    expect(mockRegister).toHaveBeenCalled();

    const registration = mockRegister.mock.calls.at(-1)![0] as Array<{
      key: string;
      handler: unknown;
      }>;
    expect(registration.map((b) => b.key)).toEqual([
      'noop',
      'health-check',
      'calendar-health-check',
      'calendar-selftest',
      ]);
    expect(registration.every((b) => typeof b.handler === 'function')).toBe(true);
    });
});

// --- noop -----------------------------------------------------------------

describe('noopHandler', () => {
  it('returns a success result and reflects whether input was present', async () => {
    expect(await noopHandler(ctx)).toEqual({
      ok: true,
      handler: 'noop',
      trigger: 'MANUAL',
      hadInput: false,
       });

    const withInput = await noopHandler({ ...ctx, input: { hello: 'world' } });
    expect(withInput).toMatchObject({ ok: true, handler: 'noop', hadInput: true });
    });
});

// --- health-check ---------------------------------------------------------

describe('healthCheckHandler', () => {
  it('is silent when every check is healthy', async () => {
    mockCheck.mockResolvedValue({
      status: 'healthy',
      checks: { database: { status: 'healthy' }, cache: { status: 'healthy' } },
      });

    const result = (await healthCheckHandler()) as {
      handler: string;
      unhealthy: string[];
      };
    expect(result.handler).toBe('health-check');
    expect(result.unhealthy).toEqual([]);
    expect(mockPush).not.toHaveBeenCalled();
     });

  it('raises an ERROR notification listing the unhealthy checks', async () => {
    mockCheck.mockResolvedValue({
      status: 'unhealthy',
      checks: {
        database: { status: 'healthy' },
        cache: { status: 'unhealthy', error: 'Redis down' },
        pgbouncer: { status: 'unhealthy', error: 'pool exhausted' },
         },
       });

    const result = (await healthCheckHandler()) as { unhealthy: string[] };
    expect(result.unhealthy).toEqual(['cache', 'pgbouncer']);
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      priority: 'ERROR',
      scope: 'GLOBAL',
      source: 'job-scheduler:health-check',
       });
     });
});

// --- calendar-health-check ------------------------------------------------

describe('calendarHealthCheckHandler', () => {
  it('probes discovery and reports the number of due instances', async () => {
    mockDue.mockResolvedValue([{ eventId: 'e1' }, { eventId: 'e2' }]);

    const result = (await calendarHealthCheckHandler()) as {
      handler: string;
      pipelineReachable: boolean;
      dueInstances: number;
      };
    expect(result).toMatchObject({
      handler: 'calendar-health-check',
      pipelineReachable: true,
      dueInstances: 2,
       });
    expect(mockDue).toHaveBeenCalledOnce();
    expect(mockPush).not.toHaveBeenCalled();
     });
});

// --- calendar-selftest ----------------------------------------------------

describe('calendarSelfTestHandler', () => {
  it('emits a single GLOBAL, CALENDAR-priority probe with defaults', async () => {
    const result = (await calendarSelfTestHandler(ctx)) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      priority: 'CALENDAR',
      scope: 'GLOBAL',
      source: 'job-scheduler:calendar-selftest',
      organizationId: 'platform-org-123',
       });
    });

  it('honours a custom title and message from the run input', async () => {
    const result = await calendarSelfTestHandler({
      ...ctx,
      input: { title: 'Custom probe', message: 'Custom message' },
       });
    expect(result).toMatchObject({ ok: true, handler: 'calendar-selftest' });
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      title: 'Custom probe',
      message: 'Custom message',
       });
    });
});

// --- health-check (additional branches) -----------------------------------

describe('healthCheckHandler — alerts', () => {
  it('alerts when overall status is healthy but a sub-check is not, listing only the failing check', async () => {
    mockCheck.mockResolvedValue({
      status: 'healthy',
      checks: {
        database: { status: 'healthy' },
        cache: { status: 'degraded', error: 'slow' },
      },
    });

    const result = (await healthCheckHandler()) as { unhealthy: string[]; status: string };
    expect(result.unhealthy).toEqual(['cache']);
    expect(result.status).toBe('healthy');
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      title: 'Job health-check: platform unhealthy',
      message: 'Health probe reported: cache.',
      priority: 'ERROR',
      scope: 'GLOBAL',
      source: 'job-scheduler:health-check',
    });
  });

  it('alerts (message falls back to status) when a check is unhealthy but reports no unhealthy-key list', async () => {
    mockCheck.mockResolvedValue({
      status: 'unhealthy',
      checks: {},
    });

    await healthCheckHandler();
    expect(mockPush).toHaveBeenCalledOnce();
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      message: 'Health probe reported: unhealthy.',
      priority: 'ERROR',
    });
  });
});

// --- calendar-selftest (additional branches) ------------------------------

describe('calendarSelfTestHandler — input shaping', () => {
  it('uses a custom title with a default message when only a title is supplied', async () => {
    await calendarSelfTestHandler({ ...ctx, input: { title: 'Only title' } });
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      title: 'Only title',
    });
    const msg = mockPush.mock.calls.at(-1)![0].message as string;
    expect(msg).toContain('CALENDAR-priority probe emitted');
  });

  it('falls back to the default title/message when input is undefined', async () => {
    await calendarSelfTestHandler(ctx);
    expect(mockPush.mock.calls.at(-1)![0]).toMatchObject({
      title: 'Calendar notification path: self-test',
    });
  });
});

// --- isDueAt --------------------------------------------------------------

const MINUTE = 60 * 1000;

describe('isDueAt', () => {
  const now = new Date('2026-01-01T00:00:00.000Z').getTime();

  it('is a no-op when the schedule expression is malformed JSON', () => {
    expect(isDueAt(new Date(now), 'not-json', null)).toBe(false);
    expect(isDueAt(new Date(now), '{"kind":"bogus"}', null)).toBe(false);
  });

  // Timezone-aware @breejs/later semantics: a job is due when the most recent
  // cron occurrence (prev(1, now)) lies strictly after lastRunAt. prev() is
  // minute-precision for standard 5-field crons — it returns the floor of `now`
  // to the minute, EXCEPT that scanning exactly on a full minute returns now
  // itself (verified against @breejs/later). Consequence: a run whose
  // lastRunAt falls before the next boundary's own full instant is consumed by
  // that boundary; per-minute crons can therefore re-fire once if a SCHEDULE
  // run's recorded timestamp lands after its triggering scan instant (bounded
  // to one extra attempt, which runJob's RUNNING claim gate turns into a
  // SKIPPED run). Spaced crons (*/N+, daily, …) never double-fire this way.
  describe('cron (@breejs/later — timezone-aware, prev(1, now) > lastRunAt)', () => {
    const everyMin = JSON.stringify({ kind: 'cron', expr: '* * * * *' });
    const every5 = JSON.stringify({ kind: 'cron', expr: '*/5 * * * *' });

    it('is due when no prior run exists (never-run fires on any past occurrence)', () => {
      expect(isDueAt(new Date(now), everyMin, null)).toBe(true);
      expect(isDueAt(new Date(now), every5, null)).toBe(true);
    });

    // prev(1, 00:00:30) clamps to the scan instant's own minute → 00:00:30.
    it('a scan at T is not re-fired when lastRunAt == T (same instant already consumed)', () => {
      expect(isDueAt(new Date(now), everyMin, new Date(now))).toBe(false); // prev == last
    });

    // A stale mid-cycle lastRunAt (00:00:30) — at the next scan past it
    // (00:01:00.5 → prev 00:01:00) catch-up fires exactly once.
    it('is due at the first boundary strictly after a stale mid-cycle run (catch-up once)', () => {
      expect(
        isDueAt(new Date('2026-01-01T00:01:00.500Z'), everyMin, new Date('2026-01-01T00:00:30.000Z')),
      ).toBe(true);
      expect(
        isDueAt(new Date('2026-01-01T00:00:45.000Z'), everyMin, new Date('2026-01-01T00:00:30.000Z')),
      ).toBe(false); // prev clamps to 00:00:45 — same un-crossed boundary
    });

    it('*/5: stays not due across the window, flips at the next occurrence boundary', () => {
      const ranOnOccurrence = new Date('2026-01-01T00:00:00.000Z');
      expect(isDueAt(new Date('2026-01-01T00:00:30.000Z'), every5, ranOnOccurrence)).toBe(false);
      expect(isDueAt(new Date('2026-01-01T00:04:59.000Z'), every5, ranOnOccurrence)).toBe(false); // prev 00:04, not an occurrence
      expect(isDueAt(new Date('2026-01-01T00:05:00.400Z'), every5, ranOnOccurrence)).toBe(true); // prev 00:05 > last
    });

    it('an explicit timezone is honoured (occurrences computed in the IANA zone)', () => {
      const tzExpr = JSON.stringify({
        kind: 'cron',
        expr: '* * * * *',
        timezone: 'Asia/Singapore', // UTC+8, no DST
      });
      // Scanning at 17:30Z = 01:30 local: prev occurrence 01:29 local = 17:29Z.
      expect(isDueAt(new Date('2026-01-01T17:30:00.000Z'), tzExpr, new Date('2026-01-01T17:45:00.000Z'))).toBe(false); // last run 15 min ahead of prev → consumed
      expect(isDueAt(new Date('2026-01-01T17:30:00.000Z'), tzExpr, new Date('2026-01-01T17:28:00.000Z'))).toBe(true);  // last run before prev 01:29l → due
    });
  });

  describe('interval', () => {
    it('is due immediately when there is no prior run', () => {
      expect(isDueAt(new Date(now), '{"kind":"interval","everyMs":1000}', null)).toBe(true);
    });

    it('is not due when less than everyMs has elapsed, and due once it has', () => {
      const expr = '{"kind":"interval","everyMs":2000}';
      expect(isDueAt(new Date(now), expr, new Date(now - 500))).toBe(false);
      expect(isDueAt(new Date(now), expr, null)).toBe(true);
      expect(isDueAt(new Date(now), expr, new Date(now - 2000))).toBe(true);
    });
  });

  describe('oneshot', () => {
    const at = '2026-01-01T00:00:00.000Z';

    it('is due once the target instant is in the past and it has not fired', () => {
      expect(isDueAt(new Date(now + 1), `{"kind":"oneshot","at":"${at}"}`, null)).toBe(true);
    });

    it('is not due when the target instant is still in the future', () => {
      expect(isDueAt(new Date(now - 1), `{"kind":"oneshot","at":"${at}"}`, null)).toBe(false);
    });

    it('is idempotent: not due once lastRunAt has reached or passed the target', () => {
      const fired = new Date(now); // now > at, and lastRunAt(now) >= at
      expect(isDueAt(new Date(now + 1), `{"kind":"oneshot","at":"${at}"}`, fired)).toBe(false);
    });

    it('is not due for a non-parseable oneshot instant', () => {
      expect(isDueAt(new Date(now), '{"kind":"oneshot","at":"not-a-date"}', null)).toBe(false);
    });
  });
});

// --- scanDueJobs ----------------------------------------------------------

describe('scanDueJobs', () => {
  it('returns 0 and never runs a job when the scanner finds none', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    expect(await scanDueJobs(new Date())).toBe(0);
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('queries only enabled AND approved jobs (defence in depth for the approval gate)', async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await scanDueJobs(new Date());
    expect(mockFindMany).toHaveBeenCalledOnce();
    const where = mockFindMany.mock.calls.at(-1)![0].where;
    expect(where).toMatchObject({ enabled: true, approved: true });
  });

  // The engine applies its cron regex to `schedule.expr`; a bare `*/N` field
  // works, so a 1-minute cron (default) is "due immediately" when lastRunAt is
  // null — exactly what these fixtures rely on.
  const DUE_CRON = JSON.stringify({ kind: 'cron', expr: '* * * * *' });

  it('runs each due job via runJob and returns the execution count', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'job-a', name: 'a', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
      { id: 'job-b', name: 'b', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
    ]);
    mockRunJob.mockResolvedValueOnce({ jobDefinitionId: 'job-a', status: 'SUCCEEDED', claimed: true });
    mockRunJob.mockResolvedValueOnce({ jobDefinitionId: 'job-b', status: 'SUCCEEDED', claimed: true });

    expect(await scanDueJobs(new Date('2026-01-01T00:00:00.000Z'))).toBe(2);
    expect(mockRunJob).toHaveBeenCalledTimes(2);
    expect(mockRunJob.mock.calls[0][1]).toEqual({ trigger: 'SCHEDULE' });
   });

  it('does not count runs that were skipped by the claim gate (claim lost)', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'job-a', name: 'a', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
    ]);
    mockRunJob.mockResolvedValueOnce({ jobDefinitionId: 'job-a', status: 'SKIPPED', claimed: false });

    expect(await scanDueJobs(new Date('2026-01-01T00:00:00.000Z'))).toBe(0);
    expect(mockRunJob).toHaveBeenCalledOnce();
   });

  it('skips jobs that are not due', async () => {
    // prev(1, now) clamps to the scan instant's own minute; when lastRunAt
    // equals that instant (the job was already executed this scan cycle), the
    // occurrence is consumed → not due.
    mockFindMany.mockResolvedValueOnce([
      {
        id: 'job-a',
        name: 'a',
        scheduleExpr: DUE_CRON,
        handlerKey: 'noop',
        lastRunAt: new Date('2026-01-01T00:00:30.000Z'),
      },
    ]);

    expect(await scanDueJobs(new Date('2026-01-01T00:00:30.000Z'))).toBe(0);
    expect(mockRunJob).not.toHaveBeenCalled();
  });

  it('isolates a single failing job and still runs the others', async () => {
    mockFindMany.mockResolvedValueOnce([
      { id: 'job-a', name: 'a', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
      { id: 'job-b', name: 'b', scheduleExpr: DUE_CRON, handlerKey: 'noop', lastRunAt: null },
    ]);
    mockRunJob
       .mockRejectedValueOnce(new Error('boom'))
       .mockResolvedValueOnce({ jobDefinitionId: 'job-b', status: 'SUCCEEDED', claimed: true });

    const executed = await scanDueJobs(new Date('2026-01-01T00:00:00.000Z'));
    expect(executed).toBe(1);
    expect(mockRunJob).toHaveBeenCalledTimes(2);
   });

  it('returns 0 and logs when the DB query itself fails', async () => {
    mockFindMany.mockRejectedValueOnce(new Error("Can't reach database server"));

    expect(await scanDueJobs(new Date())).toBe(0);
    expect(mockRunJob).not.toHaveBeenCalled();
  });
});

// --- timer lifecycle ------------------------------------------------------

// NOTE: this test file mocks env.JOB_SCHEDULER_ENABLED='false' so the module
// import stays hermetic (no timer, no boot scan). `ENABLED` is captured at import
// time, so startJobScheduler() early-returns in this suite — the assertions
// below verify that disabled path. The enabled-path wiring (register builtins +
// unref'd setInterval) is exercised by the live/instantiation tests, and the
// scan core (isDueAt / scanDueJobs) is covered directly above.
describe('startJobScheduler / stopJobScheduler — disabled via env', () => {
  it('does not register built-ins or install a timer when the scheduler is disabled', () => {
    const state = (globalThis as unknown as { jobSchedulerEngineState: { timer: unknown } })
        .jobSchedulerEngineState;

    startJobScheduler();

     // Enabled=false means no registration, no timer install.
    expect(mockRegister).not.toHaveBeenCalled();
    expect(state.timer).toBeNull();
   });

  it('stopJobScheduler is a safe no-op when no timer is running', () => {
    expect(() => stopJobScheduler()).not.toThrow();
   });
});

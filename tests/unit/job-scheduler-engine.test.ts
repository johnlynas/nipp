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

// The engine imports global-db; keep the boot-time scan a no-op.
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
  },
}));

// The service gives registerBuiltins + parseSchedule; mock so the engine boots
// without a real scheduler/role engine and so we can spy on registration.
vi.mock('@/services/job-scheduler-service', () => ({
  JobSchedulerService: { registerBuiltins: vi.fn() },
  parseSchedule: vi.fn((x: string) => JSON.parse(x)),
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
} from '@/lib/job-scheduler-engine';
import { JobSchedulerService } from '@/services/job-scheduler-service';
import { checkHealthStatus } from '@/lib/health-check';
import { findDueToStartEvents } from '@/lib/calendar-event-scheduler';
import { pushNotification } from '@/lib/notification-push';
import type { JobRunContext } from '@/services/job-scheduler-service';

// --- Typed mock handles ---------------------------------------------------

const mockPush = pushNotification as unknown as {
  mock: { calls: [Record<string, unknown>][] };
};
const mockCheck = checkHealthStatus as unknown as ReturnType<typeof vi.fn>;
const mockDue = findDueToStartEvents as unknown as ReturnType<typeof vi.fn>;
const mockRegister = (JobSchedulerService as unknown as {
  registerBuiltins: ReturnType<typeof vi.fn>;
}).registerBuiltins;

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

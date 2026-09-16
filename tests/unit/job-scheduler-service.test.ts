/**
 * Unit tests for JobSchedulerService (services/job-scheduler-service.ts).
 *
 * Covers:
 *  - parseSchedule (cron / interval / oneshot; invalid / malformed)
 *  - createJob / updateJob / enableJob / disableJob / disposeJob / triggerJob
 *  - runJob: happy path (SUCCEEDED), claim gate (SKIPPED), failure path
 *  - Authorization: MEMBER → ForbiddenError
 *  - notifyExecution: emits JOB priority on success, ERROR on failure
 *  - listJobs / getExecutionHistory
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import {
  JobSchedulerService,
  parseSchedule,
  registerHandler,
} from '@/services/job-scheduler-service';
import { pushNotification as pushNotificationImpl } from '@/lib/notification-push';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  type ServiceContext,
} from '@/lib/services/types';

// Typed handle to the mocked pushNotification — assertions only, not in mock bodies.
interface PushNotificationArg {
  title: string;
  message: string;
  priority: string;
  scope: string;
  source?: string;
  organizationId?: string;
}
type PushMock = {
  mock: { calls: [PushNotificationArg][] };
  (a: PushNotificationArg): Promise<void>;
};
const mockPush = pushNotificationImpl as unknown as PushMock;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/global-db', () => {
  const jobDefinition = {
    create: vi.fn((args: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'job-1',
        platformOrgId: 'org-1',
        code: null,
        createdBy: 'user-1',
        lastRunAt: null,
        lastRunStatus: null,
        createdAt: new Date(),
        updatedAt: new Date(),
         ...args.data,
         })),
         update: vi.fn((args: { data: Record<string, unknown> }) =>
         Promise.resolve({
         id: 'job-1',
         name: 'Test Job',
         platformOrgId: 'platform-org-123',
         handlerKey: 'noop',
         scheduleExpr: '{"kind":"interval","everyMs":60000}',
         timezone: 'Europe/London',
         timeoutMs: 300000,
         concurrencyLimit: 1,
         enabled: false,
         approved: false,
         approvedBy: null,
         approvedAt: null,
         approvalNote: null,
          code: null,
          createdBy: 'user-1',
          lastRunAt: null,
          lastRunStatus: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
          })),
       delete: vi.fn().mockResolvedValue({ id: 'job-1', name: 'Test Job', platformOrgId: 'org-1' }),
    findUnique: vi.fn().mockResolvedValue({
      id: 'job-1',
      name: 'Test Job',
      platformOrgId: 'platform-org-123',
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
      timezone: 'Europe/London',
      timeoutMs: 300000,
      concurrencyLimit: 1,
      enabled: true,
      approved: true,
      approvedBy: 'user-1',
      approvedAt: new Date(),
      approvalNote: null,
      code: null,
      createdBy: 'user-1',
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    organization: {
      findFirst: vi.fn().mockResolvedValue({ id: 'platform-org-123' }),
    },
    };

  const jobExecution = {
    create: vi.fn().mockResolvedValue({
      id: 'exec-1',
      jobDefinitionId: 'job-1',
      platformOrgId: 'org-1',
      status: 'RUNNING',
      trigger: 'SCHEDULE',
      actorId: null,
      error: null,
      resultJson: null,
      source: 'job-scheduler:execution',
      startedAt: new Date(),
      }),
    update: vi.fn().mockResolvedValue({ id: 'exec-1', jobDefinitionId: 'job-1', status: 'SUCCEEDED', finishedAt: new Date() }),
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    };

  return {
    default: { jobDefinition, jobExecution },
    };
});

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    },
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn(),
}));

// Inline `vi.fn()` is hoisted-friendly — vitest keeps in-factory mocks intact.
vi.mock('@/lib/notification-push', () => ({
  pushNotification: vi.fn(),
}));

vi.mock('@/lib/env', () => ({
  env: {
    JOB_SCHEDULER_ENABLED: 'true',
    JOB_SCHEDULER_TIMEZONE: 'Europe/London',
    JOB_SCHEDULER_MAX_CONCURRENT: '5',
    JOB_SCHEDULER_DB_CONCURRENCY: '100',
    JOB_SCHEDULER_DEFAULT_CONCURRENCY: '1',
    JOB_SCHEDULER_DEFAULT_TIMEOUT_MS: '300000',
    JOB_SCHEDULER_BOOT_REGISTRY: 'true',
    JOB_SCHEDULER_DRYRUN_DEFAULT: 'false',
    PLATFORM_ORGANIZATION_ID: 'platform-org-123',
    },
}));

// base-service: we need to mock requirePlatformAdmin / logFailedAuth so
// the service tests run without a real role check
vi.mock('@/lib/services/base-service', () => ({
  requirePlatformAdmin: vi.fn(),
  requireTenantAdmin: vi.fn(),
  requireAnyAdmin: vi.fn(),
  resolveOrgScope: vi.fn(),
  logFailedAuth: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const adminCtx: ServiceContext = {
  userId: 'user-1',
  role: 'PLATFORM_ADMIN',
  organizationId: 'platform-org-123',
};

const memberCtx: ServiceContext = {
  userId: 'user-2',
  role: 'MEMBER',
  organizationId: 'org-other',
};

const noopHandler = async (ctx: { jobDefinitionId: string; platformOrgId: string }) => {
  return { ok: true, jobId: ctx.jobDefinitionId };
};

const throwingHandler = async () => {
  throw new Error('Handler boom');
};

/** Register a handler before a test, clean up after. */
beforeEach(() => {
  vi.clearAllMocks();
  // Reset globalThis handler registry
  (globalThis as any).jobSchedulerHandlerRegistry = new Map();
});

// ---------------------------------------------------------------------------
// parseSchedule
// ---------------------------------------------------------------------------

describe('parseSchedule', () => {
  it('parses a valid interval', () => {
    expect(parseSchedule('{"kind":"interval","everyMs":60000}')).toEqual({
      kind: 'interval',
      everyMs: 60000,
     });
  });

  it('parses a valid cron', () => {
    expect(parseSchedule('{"kind":"cron","expr":"*/5 * * * *"}')).toEqual({
      kind: 'cron',
      expr: '*/5 * * * *',
      timezone: undefined,
     });
  });

  it('parses cron with timezone', () => {
    expect(parseSchedule('{"kind":"cron","expr":"0 8 * * *","timezone":"Europe/London"}')).toEqual({
      kind: 'cron',
      expr: '0 8 * * *',
      timezone: 'Europe/London',
     });
  });

  it('parses a valid oneshot', () => {
    const result = parseSchedule('{"kind":"oneshot","at":"2026-01-01T00:00:00Z"}');
    expect(result).toEqual({ kind: 'oneshot', at: expect.any(String) });
  });

  it('throws ValidationError on invalid JSON', () => {
    expect(() => parseSchedule('not-json')).toThrow(ValidationError);
  });

  it('throws ValidationError on unknown kind', () => {
    expect(() => parseSchedule('{"kind":"bogus"}')).toThrow(ValidationError);
  });

  it('throws ValidationError on cron missing expr', () => {
    expect(() => parseSchedule('{"kind":"cron"}')).toThrow(ValidationError);
  });

  it('throws ValidationError on interval with non-positive everyMs', () => {
    expect(() => parseSchedule('{"kind":"interval","everyMs":0}')).toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// createJob / updateJob / enableJob / disableJob / disposeJob
// ---------------------------------------------------------------------------

describe('JobSchedulerService.createJob', () => {
  it('creates a job with a valid schedule and persists audit log', async () => {
    const result = await JobSchedulerService.createJob(adminCtx, {
      name: 'MyJob',
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
     });
    expect(result).toMatchObject({ name: 'MyJob', handlerKey: 'noop' });
    expect(globalDb.jobDefinition.create).toHaveBeenCalledOnce();
    expect((globalDb.jobDefinition.create as any).mock.calls[0][0].data.enabled).toBe(false);
  });

  it('throws ValidationError when scheduleExpr is invalid', async () => {
    await expect(
      JobSchedulerService.createJob(adminCtx, {
        name: 'BadJob',
        handlerKey: 'noop',
        scheduleExpr: 'not-json',
        }),
       ).rejects.toThrow(ValidationError);
  });

  it('throws ConflictError on P2002 (duplicate name)', async () => {
    (globalDb.jobDefinition.create as any).mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
     );
    await expect(
      JobSchedulerService.createJob(adminCtx, {
        name: 'DupJob',
        handlerKey: 'noop',
        scheduleExpr: '{"kind":"interval","everyMs":60000}',
        }),
      ).rejects.toThrow(ConflictError);
   });

  it('requires PLATFORM_ADMIN — MEMBER context throws ForbiddenError', async () => {
    const { requirePlatformAdmin } = await import('@/lib/services/base-service');
    (requirePlatformAdmin as any).mockImplementationOnce((ctx: ServiceContext) => {
      if (ctx.role !== 'PLATFORM_ADMIN') {
        throw new ForbiddenError('Platform Admin access required');
         }
      });
    expect(
      async () =>
        JobSchedulerService.createJob(memberCtx, {
          name: 'x',
          handlerKey: 'noop',
          scheduleExpr: '{"kind":"interval","everyMs":60000}',
          }),
     ).rejects.toThrow(ForbiddenError);
    });
});

describe('JobSchedulerService.updateJob', () => {
  it('updates a job and rejects invalid scheduleExpr', async () => {
    await expect(
      JobSchedulerService.updateJob(adminCtx, 'job-1', { scheduleExpr: 'garbage' }),
     ).rejects.toThrow(ValidationError);
  });

  it('updates the enabled flag', async () => {
    const result = await JobSchedulerService.updateJob(adminCtx, 'job-1', { enabled: true });
    expect(result).toMatchObject({ enabled: true });
  });
});

describe('JobSchedulerService.enableJob / disableJob', () => {
  it('enableJob sets enabled=true', async () => {
    const result = await JobSchedulerService.enableJob(adminCtx, 'job-1');
    expect(result).toMatchObject({ enabled: true });
  });

  it('disableJob sets enabled=false', async () => {
    const result = await JobSchedulerService.disableJob(adminCtx, 'job-1');
    expect(result).toMatchObject({ enabled: false });
  });
});

describe('JobSchedulerService.disposeJob', () => {
  it('deletes a job and returns { id, deleted: true }', async () => {
    const result = await JobSchedulerService.disposeJob(adminCtx, 'job-1');
    expect(result).toEqual({ id: 'job-1', deleted: true });
    expect(globalDb.jobDefinition.delete).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// runJob — the engine-facing execution path
// ---------------------------------------------------------------------------

describe('JobSchedulerService.runJob', () => {
  it('executes successfully for an enabled job with a registered handler', async () => {
    registerHandler('noop', noopHandler);
    // The claim gate (updateMany) returns count=1 so the claim succeeds
    (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
    // JobExecution.create and .update both succeed
    (globalDb.jobExecution.create as any).mockResolvedValue({
      id: 'exec-1',
      jobDefinitionId: 'job-1',
      platformOrgId: 'org-1',
     });
    (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-1' });
    // jobDefinition.update for lastRunStatus is a no-op
    (globalDb.jobDefinition.update as any).mockResolvedValue({ id: 'job-1' });

    const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({
      jobDefinitionId: 'job-1',
      executionId: 'exec-1',
      status: 'SUCCEEDED',
      claimed: true,
      });
     expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ priority: expect.anything(), title: expect.stringContaining('Job completed') }),
     );
   });

  it('returns SKIPPED when not yet enabled (findUnique returns null)', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce(null);
    const result = await JobSchedulerService.runJob('unknown-job', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({ status: 'SKIPPED', claimed: false });
  });

  it('returns SKIPPED when the claim gate fails (already claimed)', async () => {
    registerHandler('noop', noopHandler);
    (globalDb.jobDefinition.updateMany as any).mockResolvedValueOnce({ count: 0 });
    const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({ status: 'SKIPPED', claimed: false });
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('claim gate also matches jobs that have NEVER run (lastRunAt = NULL)', async () => {
    // Regression: in Postgres, `WHERE "lastRunAt" < $x` matches ZERO rows when
    // lastRunAt is NULL (NULL comparisons are never true). A freshly created +
    // approved + enabled job therefore lost its claim on every tick and was
    // silently SKIPPED forever — no execution row, no SSE notification.
    registerHandler('noop', noopHandler);
    (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
    (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-null-claim' });
    (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-null-claim' });
    (globalDb.jobDefinition.update as any).mockResolvedValue({ id: 'job-1' });

    const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({ status: 'SUCCEEDED', claimed: true });

    const claimCall = (globalDb.jobDefinition.updateMany as any).mock.calls.at(-1)![0];
    // The WHERE must cover BOTH null and past lastRunAt, not just `{ lt }`.
    expect(claimCall.where.OR).toEqual([
      { lastRunAt: null },
      { lastRunAt: { lt: expect.any(Date) } },
    ]);
  });

  it('returns FAILED when handler is not registered', async () => {
    // The claim gate succeeds but no handler is registered
    (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
    const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({ status: 'FAILED', claimed: true });
    expect(mockPush).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Job failed'), priority: expect.anything() }),
     );
   });

  it('emits a JOB priority notification on success for a scheduled run', async () => {
    registerHandler('noop', async () => ({ ok: true }));
    (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
    (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-2' });
    (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-2' });
    (globalDb.jobDefinition.update as any).mockResolvedValue({ id: 'job-1' });
    await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    const callArgs = mockPush.mock.calls.at(-1)![0];
    expect(callArgs.priority).toBe('JOB');
    expect(callArgs.title).toContain('Job completed');
  });

  it('returns FAILED and emits ERROR notification when handler throws', async () => {
    registerHandler('throwing', throwingHandler);
    (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
    (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-3' });
    const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });
    expect(result).toMatchObject({ status: 'FAILED', claimed: true });
    const callArgs = mockPush.mock.calls.at(-1)![0];
    expect(callArgs.priority).toBe('ERROR');
    expect(callArgs.title).toContain('Job failed');
  });

  it('bypasses the claim gate for MANUAL trigger', async () => {
    registerHandler('noop', noopHandler);
    // The updateMany mock is not called — MANUAL trigger skips the claim
    const updateManySpy = vi.fn();
    (globalDb.jobDefinition.updateMany as any) = updateManySpy;
    (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-4' });
    (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-4' });
    (globalDb.jobDefinition.update as any).mockResolvedValue({ id: 'job-1' });
    const { JobSchedulerService: svc } = await import('@/services/job-scheduler-service');
    await svc.triggerJob(adminCtx, 'job-1', { note: 'hello' });
    // updateMany should not be called when trigger is MANUAL
    expect(updateManySpy).not.toHaveBeenCalled();
   });
});

// ---------------------------------------------------------------------------
// listJobs / getExecutionHistory
// ---------------------------------------------------------------------------

describe('JobSchedulerService.listJobs', () => {
  it('lists enabled jobs for the platform org', async () => {
    (globalDb.jobDefinition.findMany as any)
      .mockResolvedValueOnce([{ id: 'job-1', enabled: true }, { id: 'job-2', enabled: false }])
      .mockResolvedValueOnce([{ id: 'job-1', enabled: true }]);
    const all = await JobSchedulerService.listJobs(adminCtx);
    expect(all).toHaveLength(2);
    const enabledOnly = await JobSchedulerService.listJobs(adminCtx, { enabled: true });
    expect(enabledOnly).toHaveLength(1);
    });
});

describe('JobSchedulerService.getExecutionHistory', () => {
  it('lists execution history newest-first', async () => {
    (globalDb.jobExecution.findMany as any).mockResolvedValueOnce([
      { id: 'exec-1', status: 'SUCCEEDED' },
      { id: 'exec-2', status: 'FAILED' },
     ]);
    const result = await JobSchedulerService.getExecutionHistory(adminCtx, { limit: 50 });
    expect(result).toHaveLength(2);
   });
});

// ---------------------------------------------------------------------------
// triggerJob authorization
// ---------------------------------------------------------------------------

describe('JobSchedulerService.triggerJob', () => {
  it('throws ForbiddenError when job is disabled', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
      id: 'job-1',
      name: 'DisabledJob',
      platformOrgId: 'platform-org-123',
      enabled: false,
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
      timeoutMs: 300000,
      lastRunAt: null,
      lastRunStatus: null,
     });
    expect(
      async () => JobSchedulerService.triggerJob(adminCtx, 'job-1'),
     ).rejects.toThrow(ForbiddenError);
   });
});

// ---------------------------------------------------------------------------
// Approval gate — the control that lets a job move from "defined" to "may run"
// ---------------------------------------------------------------------------

describe('JobSchedulerService.approval gate', () => {
  it('createJob starts a job unapproved and disabled', async () => {
    const job = await JobSchedulerService.createJob(adminCtx, {
      name: 'Unapproved',
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
       });
    expect((globalDb.jobDefinition.create as any).mock.calls[0][0].data.approved).toBe(false);
    expect((globalDb.jobDefinition.create as any).mock.calls[0][0].data.enabled).toBe(false);
     });

  it('enableJob throws ForbiddenError when the job is not yet approved', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
      id: 'job-1',
      name: 'Unapproved',
      platformOrgId: 'platform-org-123',
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
      enabled: false,
      approved: false,
       });
    await expect(
      JobSchedulerService.enableJob(adminCtx, 'job-1'),
      ).rejects.toThrow(ForbiddenError);
     });

  it('updateJob cannot enable an unapproved job via a patch', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
      id: 'job-1',
      name: 'Unapproved',
      platformOrgId: 'platform-org-123',
      handlerKey: 'noop',
      scheduleExpr: '{"kind":"interval","everyMs":60000}',
      enabled: false,
       approved: false,
        });
    await expect(
      JobSchedulerService.updateJob(adminCtx, 'job-1', { enabled: true }),
      ).rejects.toThrow(ForbiddenError);
      });

  it('approveJob sets approved=true, records the approver and an audit entry', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
     id: 'job-1',
     name: 'Unapproved',
     platformOrgId: 'platform-org-123',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     enabled: false,
     approved: false,
       });
   (globalDb.jobDefinition.update as any).mockResolvedValue({
     id: 'job-1',
     name: 'Unapproved',
     approved: true,
     approvedBy: 'user-1',
       });
   const { recordAuditLog } = await import('@/lib/audit-log');
   const updated = await JobSchedulerService.approveJob(adminCtx, 'job-1', { note: 'ok' });
    expect((globalDb.jobDefinition.update as any).mock.calls.at(-1)[0].data.approved).toBe(true);
   expect(updated).toMatchObject({ approved: true, approvedBy: 'user-1' });
   expect((recordAuditLog as any)).toHaveBeenCalledWith(
     expect.objectContaining({ action: 'job.approved', resourceId: 'job-1' }),
      );
     });

  it('approveJob is a no-op when the job is already approved', async () => {
   // Default findUnique already returns approved:true.
   const { recordAuditLog } = await import('@/lib/audit-log');
    const updated = await JobSchedulerService.approveJob(adminCtx, 'job-1');
    expect(updated.approved).toBe(true);
   expect((globalDb.jobDefinition.update as any)).not.toHaveBeenCalled();
   expect((recordAuditLog as any)).not.toHaveBeenCalled();
    });

  it('rejectJob clears approval and disables the job', async () => {
   (globalDb.jobDefinition.update as any).mockResolvedValue({
     id: 'job-1',
     name: 'Test Job',
     approved: false,
     enabled: false,
       });
   const { recordAuditLog } = await import('@/lib/audit-log');
   const updated = await JobSchedulerService.rejectJob(adminCtx, 'job-1', { note: 'no' });
   expect((globalDb.jobDefinition.update as any).mock.calls.at(-1)[0].data.approved).toBe(false);
   expect((globalDb.jobDefinition.update as any).mock.calls.at(-1)[0].data.enabled).toBe(false);
   expect(updated).toMatchObject({ approved: false, enabled: false });
   expect((recordAuditLog as any)).toHaveBeenCalledWith(
     expect.objectContaining({ action: 'job.rejected', resourceId: 'job-1' }),
      );
     });

  it('triggerJob throws ForbiddenError when the job is not approved', async () => {
   (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
     id: 'job-1',
     name: 'EnabledButUnapproved',
     platformOrgId: 'platform-org-123',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     enabled: true,
     approved: false,
      });
   await expect(
     JobSchedulerService.triggerJob(adminCtx, 'job-1'),
     ).rejects.toThrow(ForbiddenError);
    });
});

// ---------------------------------------------------------------------------
// updateJob — requires job to be found in the org
// ---------------------------------------------------------------------------

describe('JobSchedulerService.updateJob', () => {
  it('throws NotFoundError when job is not found', async () => {
    (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce(null);
    await expect(
      JobSchedulerService.updateJob(adminCtx, 'nonexistent', { name: 'new name' }),
     ).rejects.toThrow(NotFoundError);
   });
});

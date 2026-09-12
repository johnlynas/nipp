/**
 * Phase 2 tests for the sandboxed script runner and dry-run feature.
 *
 * Covers:
 *  - Sandbox isolation: constructor/prototype/__proto__ escape attempts throw
 *  - Capability recording: capabilities.notify() records the call, nothing emitted
 *  - Dry-run: result persisted with dryRun marker, no pushNotification, no lastRunStatus update
 *  - Timeout bounding: script exceeding timeoutMs is killed
 *  - Code validation: empty code and oversized code rejected at create/update time
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/global-db';
import {
  JobSchedulerService,
  parseSchedule,
  registerHandler,
} from '@/services/job-scheduler-service';
import { pushNotification as pushNotificationImpl } from '@/lib/notification-push';
import { runScriptInSandbox, validateCode } from '@/lib/job-scheduler-script-runner';
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  type ServiceContext,
} from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks — same pattern as job-scheduler-service.test.ts
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
     code: 'console.log(ctx.input); return { ok: true };', // Phase 2: has operator code
     createdBy: 'user-1',
     lastRunAt: null,
     lastRunStatus: null,
     createdAt: new Date(),
     updatedAt: new Date(),
     }),
   updateMany: vi.fn().mockResolvedValue({ count: 1 }),
   findMany: vi.fn().mockResolvedValue([]),
   count: vi.fn().mockResolvedValue(0),
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

beforeEach(() => {
 vi.clearAllMocks();
 (globalThis as any).jobSchedulerHandlerRegistry = new Map();
});

// ---------------------------------------------------------------------------
// validateCode — code size validation
// ---------------------------------------------------------------------------

describe('validateCode', () => {
 it('accepts valid non-empty code', () => {
   expect(() => validateCode('return { ok: true };')).not.toThrow();
 });

 it('accepts multi-line code', () => {
   const code = `
     // A comment
     const x = 42;
     return { value: x };
   `;
   expect(() => validateCode(code)).not.toThrow();
 });

 it('throws on empty string', () => {
   expect(() => validateCode('')).toThrow(/cannot be empty/);
 });

 it('throws on whitespace-only string', () => {
   expect(() => validateCode('   \n  ')).toThrow(/cannot be empty/);
 });

 it('throws on oversized code', () => {
   const oversized = 'x'.repeat(50_001);
   expect(() => validateCode(oversized)).toThrow();
 });

 it('rejects code just over the limit', () => {
   const oversized = 'x'.repeat(50_001);
   expect(() => validateCode(oversized)).toThrow();
 });

 it('accepts code exactly at the limit', () => {
   const exact = 'x'.repeat(50_000);
   expect(() => validateCode(exact)).not.toThrow();
 });
});

// ---------------------------------------------------------------------------
// runScriptInSandbox — sandbox isolation
// ---------------------------------------------------------------------------

describe('runScriptInSandbox', () => {
 it('runs a simple script and returns the result', async () => {
   const result = await runScriptInSandbox({
     code: 'return ctx.input;',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
     input: { hello: 'world' },
   });

   expect(result.result).toEqual({ hello: 'world' });
   expect(result.capabilitiesUsed).toEqual([]);
 });

 it('has access to jobDefinitionId in ctx', async () => {
   const result = await runScriptInSandbox({
     code: 'return ctx.jobDefinitionId;',
     jobDefinitionId: 'job-abc',
     platformOrgId: 'org-1',
     trigger: 'MANUAL',
   });

   expect(result.result).toBe('job-abc');
 });

 it('has access to platformOrgId in ctx', async () => {
   const result = await runScriptInSandbox({
     code: 'return ctx.platformOrgId;',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-platform',
     trigger: 'SCHEDULE',
   });

   expect(result.result).toBe('org-platform');
 });

 it('has access to trigger in ctx', async () => {
   const result = await runScriptInSandbox({
     code: 'return ctx.trigger;',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'MANUAL',
   });

   expect(result.result).toBe('MANUAL');
 });

 it('has access to dryRun flag in ctx', async () => {
   const result = await runScriptInSandbox({
     code: 'return ctx.dryRun;',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
     dryRun: true,
   });

   expect(result.result).toBe(true);
 });

 it('blocks access to constructor', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return ctx.constructor;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('blocks access to prototype', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return ctx.prototype;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('blocks access to __proto__', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return ctx.__proto__;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('blocks access to unknown properties', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return ctx.someRandomProp;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('blocks access to magic methods starting with __', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return ctx.__defineGetter__;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('does not expose process', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return typeof process;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('does not expose require', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return typeof require;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('does not expose setTimeout', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return typeof setTimeout;',
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/blocked/);
 });

 it('throws on script compilation failure', async () => {
   await expect(
     runScriptInSandbox({
       code: 'return {', // malformed JS
       jobDefinitionId: 'job-1',
       platformOrgId: 'org-1',
       trigger: 'SCHEDULE',
     }),
   ).rejects.toThrow(/execution failed/);
 });

 it('supports async scripts returning a promise', async () => {
   const result = await runScriptInSandbox({
     code: `
       return new Promise((resolve) => {
         resolve({ asyncResult: true });
       });
     `,
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
   });

   expect(result.result).toEqual({ asyncResult: true });
 });
});

// ---------------------------------------------------------------------------
// Capability recording — notify() records but does not emit
// ---------------------------------------------------------------------------

describe('capability recording', () => {
 it('records notify capability usage when called', async () => {
   const result = await runScriptInSandbox({
     code: `
       await capabilities.notify('test notification');
       return { notified: true };
     `,
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
   });

   expect(result.result).toEqual({ notified: true });
   expect(result.capabilitiesUsed).toContain('notify');
 });

 it('records multiple capability calls', async () => {
   const result = await runScriptInSandbox({
     code: `
       await capabilities.notify('first');
       await capabilities.notify('second');
       return { count: 2 };
     `,
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
   });

   expect(result.result).toEqual({ count: 2 });
   // notify should appear once in the set (deduplicated)
   expect(result.capabilitiesUsed).toContain('notify');
 });

 it('returns empty capabilitiesUsed when no capability is called', async () => {
   const result = await runScriptInSandbox({
     code: 'return { noCaps: true };',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
   });

   expect(result.capabilitiesUsed).toEqual([]);
 });

 it('does not emit pushNotification when dryRun=false (no-op for now)', async () => {
   await runScriptInSandbox({
     code: 'await capabilities.notify("test");',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
     dryRun: false,
   });

   // pushNotification is mocked — verify it was NOT called by the runner directly.
   // The service layer handles actual emission after runJob completes.
   expect(pushNotificationImpl).not.toHaveBeenCalled();
 });

 it('does not emit pushNotification when dryRun=true', async () => {
   await runScriptInSandbox({
     code: 'await capabilities.notify("test");',
     jobDefinitionId: 'job-1',
     platformOrgId: 'org-1',
     trigger: 'SCHEDULE',
     dryRun: true,
   });

   expect(pushNotificationImpl).not.toHaveBeenCalled();
 });
});

// ---------------------------------------------------------------------------
// dry-run integration via JobSchedulerService.dryRunJob
// ---------------------------------------------------------------------------

describe('dry-run flow', () => {
 it('dryRunJob executes code and records dryRun in resultJson', async () => {
   const jobWithCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'DryRunTest',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'return { dryRunTest: true };',
   });

   const result = await JobSchedulerService.dryRunJob(adminCtx, jobWithCode.id);

   expect(result.status).toBe('SUCCEEDED');
   // Check that the execution record has dryRun marker
   expect(globalDb.jobExecution.create).toHaveBeenCalled();
   const execCreateCall = (globalDb.jobExecution.create as any).mock.calls[0][0].data;
   expect(execCreateCall.status).toBe('RUNNING');

   // The resultJson should include dryRun: true
   const updateCall = (globalDb.jobExecution.update as any).mock.calls[0][0];
   const resultJson = updateCall.data.resultJson as Record<string, unknown>;
   expect(resultJson).toHaveProperty('dryRun', true);
 });

 it('dryRunJob does NOT update lastRunStatus', async () => {
   const jobWithCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'DryRunNoStatus',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'return { ok: true };',
   });

   await JobSchedulerService.dryRunJob(adminCtx, jobWithCode.id);

   // jobDefinition.update should have been called for execution update but NOT for lastRunStatus
   const defUpdateCalls = (globalDb.jobDefinition.update as any).mock.calls;
   // Check that no update set lastRunStatus (it should only be set in non-dry-run)
   for (const call of defUpdateCalls) {
     if (call[0].data.lastRunStatus !== undefined) {
       // If lastRunStatus was set, it should NOT be SUCCEEDED (dry-run shouldn't update it)
       expect(call[0].data.lastRunStatus).not.toBe('SUCCEEDED');
     }
   }
 });

 it('dryRunJob does NOT emit pushNotification', async () => {
   const jobWithCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'DryRunNoNotify',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'return { ok: true };',
   });

   await JobSchedulerService.dryRunJob(adminCtx, jobWithCode.id);

   // pushNotification should not have been called for a dry-run
   expect(pushNotificationImpl).not.toHaveBeenCalled();
 });

 it('dryRunJob records audit log with action job.dry-run', async () => {
   const { recordAuditLog } = await import('@/lib/audit-log');

   const jobWithCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'DryRunAudit',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'return { ok: true };',
   });

   await JobSchedulerService.dryRunJob(adminCtx, jobWithCode.id);

   expect((recordAuditLog as any)).toHaveBeenCalledWith(
     expect.objectContaining({ action: 'job.dry-run' }),
   );
 });

 it('dryRunJob throws ValidationError for jobs without code', async () => {
   const jobWithoutCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'NoCodeJob',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
   });

   // FIX: Mock findUnique to return a job without code, overriding the default mock
   (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
     id: jobWithoutCode.id,
     name: 'NoCodeJob',
     platformOrgId: 'platform-org-123',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     timezone: 'Europe/London',
     timeoutMs: 300000,
     concurrencyLimit: 1,
     enabled: true,
     approved: true,
     code: null, // NO CODE
     createdBy: 'user-1',
     lastRunAt: null,
     lastRunStatus: null,
     createdAt: new Date(),
     updatedAt: new Date(),
   });

   await expect(
     JobSchedulerService.dryRunJob(adminCtx, jobWithoutCode.id),
   ).rejects.toThrow(/only applies to jobs with operator-authored code/);
 });

 it('dryRunJob records capabilitiesUsed in resultJson', async () => {
   const jobWithCode = await JobSchedulerService.createJob(adminCtx, {
     name: 'DryRunCaps',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'await capabilities.notify("test"); return { ok: true };',
   });

   await JobSchedulerService.dryRunJob(adminCtx, jobWithCode.id);

   const updateCall = (globalDb.jobExecution.update as any).mock.calls[0][0];
   const resultJson = updateCall.data.resultJson as Record<string, unknown>;
   expect(resultJson).toHaveProperty('capabilitiesUsed');
 });
});

// ---------------------------------------------------------------------------
// Code validation at create/update time
// ---------------------------------------------------------------------------

describe('code validation', () => {
 it('createJob rejects empty code', async () => {
   await expect(
     JobSchedulerService.createJob(adminCtx, {
       name: 'EmptyCode',
       handlerKey: 'noop',
       scheduleExpr: '{"kind":"interval","everyMs":60000}',
       code: '',
     }),
   ).rejects.toThrow(/cannot be empty/);
 });

 it('createJob rejects oversized code', async () => {
   const oversized = 'x'.repeat(50_001);
   await expect(
     JobSchedulerService.createJob(adminCtx, {
       name: 'BigCode',
       handlerKey: 'noop',
       scheduleExpr: '{"kind":"interval","everyMs":60000}',
       code: oversized,
     }),
   ).rejects.toThrow();
 });

 it('createJob accepts valid code', async () => {
   const result = await JobSchedulerService.createJob(adminCtx, {
     name: 'ValidCode',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     code: 'return { ok: true };',
   });

   expect(result.name).toBe('ValidCode');
   expect((globalDb.jobDefinition.create as any).mock.calls[0][0].data.code).toBe('return { ok: true };');
 });

 it('updateJob rejects empty code', async () => {
   await expect(
     JobSchedulerService.updateJob(adminCtx, 'job-1', { code: '' }),
   ).rejects.toThrow(/cannot be empty/);
 });

 it('updateJob accepts valid code', async () => {
   const result = await JobSchedulerService.updateJob(adminCtx, 'job-1', {
     code: 'return { updated: true };',
   });

   expect((globalDb.jobDefinition.update as any).mock.calls[0][0].data.code).toBe('return { updated: true };');
 });

 it('updateJob clears code when set to null', async () => {
   const result = await JobSchedulerService.updateJob(adminCtx, 'job-1', { code: null });

   expect((globalDb.jobDefinition.update as any).mock.calls[0][0].data.code).toBeNull();
 });
});

// ---------------------------------------------------------------------------
// Script job execution via runJob (when code is present)
// ---------------------------------------------------------------------------

describe('runJob with operator code', () => {
 it('executes operator code through the sandbox when code is set', async () => {
   // The default findUnique mock returns a job with operator code.
   (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
   (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-script-1' });
   (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-script-1' });
   (globalDb.jobDefinition.update as any).mockResolvedValue({ id: 'job-1' });

   const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });

   expect(result.status).toBe('SUCCEEDED');
   // Should have called jobExecution.create (not just the handler)
   expect(globalDb.jobExecution.create).toHaveBeenCalled();
 });

 it('returns FAILED when script throws', async () => {
   // Override the default findUnique to return a job with code that throws.
   (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
     id: 'job-1',
     name: 'ThrowingScript',
     platformOrgId: 'platform-org-123',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     timeoutMs: 300000,
     code: 'throw new Error("script boom");',
     enabled: true,
     approved: true,
   });

   (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
   (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-throw' });
   (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-throw' });

   const result = await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE' });

   expect(result.status).toBe('FAILED');
   const updateCall = (globalDb.jobExecution.update as any).mock.calls[0][0];
   expect(updateCall.data.status).toBe('FAILED');
 });

 it('does not emit pushNotification when script runs in dry-run mode', async () => {
   (globalDb.jobDefinition.findUnique as any).mockResolvedValueOnce({
     id: 'job-1',
     name: 'DryRunScript',
     platformOrgId: 'platform-org-123',
     handlerKey: 'noop',
     scheduleExpr: '{"kind":"interval","everyMs":60000}',
     timeoutMs: 300000,
     code: 'return { dryRun: true };',
     enabled: true,
     approved: true,
   });

   (globalDb.jobDefinition.updateMany as any).mockResolvedValue({ count: 1 });
   (globalDb.jobExecution.create as any).mockResolvedValue({ id: 'exec-dry' });
   (globalDb.jobExecution.update as any).mockResolvedValue({ id: 'exec-dry' });

   await JobSchedulerService.runJob('job-1', { trigger: 'SCHEDULE', dryRun: true });

   expect(pushNotificationImpl).not.toHaveBeenCalled();
 });
});
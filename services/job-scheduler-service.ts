/**
 * Job Scheduler Service (job-scheduler-service)
 *
 * The single, platform-organization-facing interface to the background job
 * engine (Bree, see lib/job-scheduler-engine.ts). It owns:
 *
 *    - the JobDefinition / JobExecution data model (CRUD + history),
 *    - the DB-backed idempotency / restart-safety claim gate (atomic
 *      `lastRunAt` update — Bree carries no job state in the DB),
 *    - a trusted built-in handler registry (`handlerKey` → handler),
 *    - execution lifecycle + SSE notification (NotificationPriority.JOB / ERROR),
 *    - audit logging (recordAuditLog) on create/update/enable/disable/trigger.
 *
 * Layering: this service does NOT import Bree. It is pure orchestration over
 * `globalDb` + `pushNotification` + `recordAuditLog`, which is why it is
 * unit-testable by mocking those three (mirrors
 * tests/unit/calendar-event-scheduler.test.ts). The engine boots a Bree
 * instance and, on each tick, calls `JobSchedulerService.runJob(jobId, …)`;
 * switching to per-worker execution (Phase 2) is an *internal* change to the
 * engine's handler path, invisible to callers.
 *
 * Authorization: every public call runs `requirePlatformAdmin(ctx)`; the
 * highest-risk manual trigger additionally gates on `verifySuperAdmin`.
 * This surface is the platform organization only — tenant users cannot define,
 * view, trigger, or cancel jobs.
 */

import {
  JobDefinition,
  NotificationPriority,
  NotificationScope,
  Prisma,
} from '@prisma/client';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import { env } from '@/lib/env';
import {
  ServiceContext,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from '@/lib/services/types';
import { requirePlatformAdmin } from '@/lib/services/base-service';
import { recordAuditLog } from '@/lib/audit-log';
import { pushNotification } from '@/lib/notification-push';

// Phase 2: sandboxed script runner for operator-authored code.
import { runScriptInSandbox, validateCode } from '@/lib/job-scheduler-script-runner';

/**
 * True when this module copy is running inside a Bree job-scheduler worker
 * thread (the per-fork bootstrap sets the marker before requiring this file).
 * Used to skip SSE emission in workers: live subscribers only exist in the
 * parent thread, so a worker push would persist + log but deliver nothing.
 * The engine re-emits lifecycle notifications on the parent on receipt. Not an
 * isMainThread check on purpose: vitest test workers are also non-main threads
 * and must keep the full notification behavior for assertions.
 */
export function isJobSchedulerWorker(): boolean {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  return g.jobSchedulerWorker === true;
}

// ---------------------------------------------------------------------------
// Schedule model
// ---------------------------------------------------------------------------

/**
 * A job schedule. Stored as JSON in `JobDefinition.scheduleExpr`.
 */
export type Schedule =
   | { kind: 'cron'; expr: string; timezone?: string }
   | { kind: 'interval'; everyMs: number }
   | { kind: 'oneshot'; at: string }; // ISO 8601 instant

type ParsedSchedule = Schedule;

/** Parse and validate a `scheduleExpr` JSON string into a Schedule. */
export function parseSchedule(expr: string): ParsedSchedule {
  let raw: unknown;
  try {
    raw = JSON.parse(expr);
   } catch {
    throw new ValidationError('scheduleExpr must be valid JSON');
   }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ValidationError('scheduleExpr must be a schedule object');
   }
  const obj = raw as Record<string, unknown>;
  switch (obj.kind) {
    case 'cron': {
      if (typeof obj.expr !== 'string' || obj.expr.trim() === '') {
        throw new ValidationError('cron schedule requires a non-empty `expr`');
       }
      return {
        kind: 'cron',
        expr: obj.expr,
        timezone: typeof obj.timezone === 'string' ? obj.timezone : undefined,
       };
     }
    case 'interval': {
      const ms = Number(obj.everyMs);
      if (!Number.isFinite(ms) || ms <= 0) {
        throw new ValidationError('interval schedule requires positive `everyMs`');
       }
      return { kind: 'interval', everyMs: Math.round(ms) };
     }
    case 'oneshot': {
      const at = new Date(String(obj.at ?? ''));
      if (Number.isNaN(at.getTime())) {
        throw new ValidationError('oneshot schedule requires a valid ISO `at`');
       }
      return { kind: 'oneshot', at: at.toISOString() };
     }
    default:
      throw new ValidationError(`Unknown schedule kind: ${String(obj.kind)}`);
   }
}

// ---------------------------------------------------------------------------
// Handler registry (trusted built-ins in Phase 1; untrusted scripts Phase 2)
// ---------------------------------------------------------------------------

/**
 * Context passed to a handler. Carries the resolved job definition plus enough
 * context for the handler to act through scoped service calls (no ambient
 * `globalDb`/RLS is exposed — that is Phase 2's restricted surface).
 */
export interface JobRunContext {
  jobDefinitionId: string;
  platformOrgId: string;
  trigger: 'SCHEDULE' | 'MANUAL';
   /** Free-form input the caller attached to this run (manual triggers, etc.). */
  input?: unknown;
}

/** A job handler. Returns a JSON-serializable result (persisted to resultJson). */
export type JobHandler = (ctx: JobRunContext) => Promise<unknown>;

/**
 * Registry of trusted built-in handlers, keyed by `handlerKey`. In Phase 1 this
 * is the complete, trusted set; Phase 2 adds operator-authored scripts behind
 * the same `handlerKey` → handler resolution (materialized to a tmp file and
 * run in a Bree worker — never eval'd).
 *
 * The registry lives on `globalThis` so the Next.js dev double-evaluation of the
 * module never produces two diverging maps (same pattern as the SSE/health
 * schedulers).
 */
function getHandlerRegistry(): Map<string, JobHandler> {
  const g = globalThis as unknown as Record<string, Map<string, JobHandler> | undefined>;
  if (!g.jobSchedulerHandlerRegistry) {
    g.jobSchedulerHandlerRegistry = new Map<string, JobHandler>();
    }
  return g.jobSchedulerHandlerRegistry;
}

/**
 * Register (or replace) a built-in handler under a key. Idempotent-safe.
 * Used by the engine to wire built-ins.
 */
export function registerHandler(key: string, handler: JobHandler): void {
  getHandlerRegistry().set(key, handler);
}

function getHandler(key: string): JobHandler | undefined {
  return getHandlerRegistry().get(key);
}

// ---------------------------------------------------------------------------
// Config defaults (from validated env — see lib/env-schema.ts)
// ---------------------------------------------------------------------------

function numEnv(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function defaultTimeoutMs(): number {
  return numEnv(env.JOB_SCHEDULER_DEFAULT_TIMEOUT_MS ?? undefined, 300_000);
}
function defaultConcurrency(): number {
  return numEnv(env.JOB_SCHEDULER_DEFAULT_CONCURRENCY ?? undefined, 1);
}
function defaultTimezone(): string {
  return env.JOB_SCHEDULER_TIMEZONE ?? 'Europe/London';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateJobInput {
  name: string;
  description?: string | null;
  handlerKey: string;
  scheduleExpr: string; // JSON string, parsed via parseSchedule
  timezone?: string;
  timeoutMs?: number;
  concurrencyLimit?: number;
  enabled?: boolean;
   /** Operator/script source — Phase 2; materialized to a tmp file at exec time. */
  code?: string | null;
}

export interface UpdateJobInput {
  name?: string;
  description?: string | null;
  handlerKey?: string;
  scheduleExpr?: string;
  timezone?: string;
  timeoutMs?: number;
  concurrencyLimit?: number;
  enabled?: boolean;
  code?: string | null;
}

export type JobStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

/** Result returned by runJob / triggerJob. */
export interface RunResult {
  jobDefinitionId: string;
  executionId?: string;
  status: JobStatus | 'SKIPPED';
  claimed: boolean; // false → another tick already claimed this instant
  /** Human-readable failure reason (present when status === 'FAILED'). Used
   * by the engine's parent thread to emit the failure notification in worker
   * mode, where the run itself cannot broadcast SSE. */
  error?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Service responsible for the background job scheduler. Decouples callers from
 * the engine (Bree) and from direct Prisma operations. All methods are
 * platform-admin only.
 */
export const JobSchedulerService = {
   /**
    * Create a job definition. Validates the schedule, records an audit entry.
    * The engine picks up `enabled: true` jobs on its next boot/registry sync.
    */
  async createJob(ctx: ServiceContext, input: CreateJobInput) {
    requirePlatformAdmin(ctx);
    if (!input.name || input.name.trim() === '') {
      throw new ValidationError('name is required');
     }
    if (!input.handlerKey) {
      throw new ValidationError('handlerKey is required');
     }
     // Validate schedule up front — fail loud before writing a row.
    parseSchedule(input.scheduleExpr);

    // Phase 2: validate operator code if present.

    if (input.code !== undefined && input.code !== null) {
      try { validateCode(input.code); } catch (err) {
        throw new ValidationError(err instanceof Error ? err.message : String(err));
      }
    }

    const platformOrgId = await resolvePlatformOrgId(ctx);

    try {
      const job = await globalDb.jobDefinition.create({
        data: {
          platformOrgId,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          handlerKey: input.handlerKey,
          scheduleExpr: input.scheduleExpr,
          timezone: input.timezone ?? defaultTimezone(),
          timeoutMs: input.timeoutMs ?? defaultTimeoutMs(),
          concurrencyLimit: input.concurrencyLimit ?? defaultConcurrency(),
          enabled: input.enabled ?? false,
          // New jobs start unapproved: a platform admin must approve a job
          // before it can be enabled or triggered (approval gate, Phase 1).
          approved: false,
          code: input.code ?? null,
          createdBy: ctx.userId,
         },
        });

      await recordAuditLog({
        userId: ctx.userId,
        action: 'job.created',
        resourceType: 'JobDefinition',
        resourceId: job.id,
        organizationId: platformOrgId,
        success: true,
        metadata: { name: job.name },
       });
      logger.info({ jobId: job.id, name: job.name }, 'Job created');
      return job;
     } catch (error) {
      if (
        (error as { code?: string }).code === 'P2002'
       ) {
        throw new ConflictError(
           `A job named "${input.name}" already exists in this platform org`,
        );
       }
      throw error;
     }
   },

   /** Update an existing job definition (by id, platform-org scoped). */
  async updateJob(ctx: ServiceContext, id: string, input: UpdateJobInput) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const existing = await assertJobInOrg(id, platformOrgId);

    const data: Record<string, unknown> = {};
    // Approval gate: enabling a job via a patch is only allowed once approved,
    // mirroring enableJob(). Prevents bypassing the gate by flipping `enabled`.
    if (input.enabled === true && !existing.approved) {
      throw new ForbiddenError('Job is not approved — approve it before enabling');
      }
    if (input.name !== undefined) {
      if (input.name.trim() === '') throw new ValidationError('name cannot be empty');
      data.name = input.name.trim();
     }
    if (input.description !== undefined) {
      data.description = input.description?.trim() || null;
     }
    if (input.handlerKey !== undefined) data.handlerKey = input.handlerKey;
    if (input.scheduleExpr !== undefined) {
      parseSchedule(input.scheduleExpr); // validate
      data.scheduleExpr = input.scheduleExpr;
     }
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.timeoutMs !== undefined) {
      if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
        throw new ValidationError('timeoutMs must be a positive number');
       }
      data.timeoutMs = input.timeoutMs;
     }
    if (input.concurrencyLimit !== undefined) {
      if (!Number.isFinite(input.concurrencyLimit) || input.concurrencyLimit < 1) {
        throw new ValidationError('concurrencyLimit must be >= 1');
       }
      data.concurrencyLimit = input.concurrencyLimit;
     }
    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.code !== undefined) {
      if (input.code !== null && input.code.trim().length === 0) {
        throw new ValidationError('code cannot be empty');
      }
      if (input.code !== null) {
        try { validateCode(input.code); } catch (err) {
          throw new ValidationError(err instanceof Error ? err.message : String(err));
        }
      }
      data.code = input.code;
     }

    const updated = await globalDb.jobDefinition.update({
      where: { id: existing.id },
      data,
     });
    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.updated',
      resourceType: 'JobDefinition',
      resourceId: updated.id,
      organizationId: platformOrgId,
      success: true,
      metadata: { changes: Object.keys(data) },
     });
    return updated;
   },

   /** Enable a job so the engine will schedule it. */
  async enableJob(ctx: ServiceContext, id: string) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const job = await assertJobInOrg(id, platformOrgId);
    // Approval gate: a job cannot be enabled until a platform admin has
    // approved it.
    if (!job.approved) {
      throw new ForbiddenError('Job is not approved — approve it before enabling');
      }
    const updated = await globalDb.jobDefinition.update({
      where: { id },
      data: { enabled: true },
      });
    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.enabled',
      resourceType: 'JobDefinition',
      resourceId: id,
      organizationId: platformOrgId,
      success: true,
     });
    return updated;
   },

   /** Disable a job (the engine stops scheduling it; in-flight ticks finish). */
  async disableJob(ctx: ServiceContext, id: string) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    await assertJobInOrg(id, platformOrgId);
    const updated = await globalDb.jobDefinition.update({
      where: { id },
      data: { enabled: false },
     });
    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.disabled',
      resourceType: 'JobDefinition',
      resourceId: id,
      organizationId: platformOrgId,
      success: true,
     });
    return updated;
   },

   /**
    * Approve a job so it may be enabled and executed. Records the approver,
    * timestamp, and an optional note, plus a durable audit entry. Idempotent:
    * re-approving an already-approved job refreshes the approver/timestamp.
    */
   async approveJob(
   ctx: ServiceContext,
   id: string,
   opts: { note?: string } = {},
   ): Promise<JobDefinition> {
   requirePlatformAdmin(ctx);
   const platformOrgId = await resolvePlatformOrgId(ctx);
   const job = await assertJobInOrg(id, platformOrgId);

   if (job.approved) {
     // Already approved — refresh approver/timestamp but don't re-audit churn.
     logger.info({ jobId: id, name: job.name }, 'Job already approved (no-op)');
     return job;
     }

   const updated = await globalDb.jobDefinition.update({
     where: { id },
     data: {
       approved: true,
       approvedBy: ctx.userId,
       approvedAt: new Date(),
       approvalNote: opts.note ?? null,
       },
     });

   await recordAuditLog({
     userId: ctx.userId,
     action: 'job.approved',
     resourceType: 'JobDefinition',
     resourceId: id,
     organizationId: platformOrgId,
     success: true,
     metadata: { note: opts.note ?? null, name: job.name },
     });
   logger.info({ jobId: id, name: job.name, actor: ctx.userId }, 'Job approved');
   return updated;
   },

   /**
    * Reject an unapproved job: clears approval and disables it so the engine
    * stops scheduling it. Records the actor, optional note, and an audit entry.
    */
   async rejectJob(
   ctx: ServiceContext,
   id: string,
   opts: { note?: string } = {},
   ): Promise<JobDefinition> {
   requirePlatformAdmin(ctx);
   const platformOrgId = await resolvePlatformOrgId(ctx);
   const job = await assertJobInOrg(id, platformOrgId);

   const updated = await globalDb.jobDefinition.update({
     where: { id },
     data: {
       approved: false,
       approvedBy: ctx.userId,
       approvedAt: new Date(),
       approvalNote: opts.note ?? null,
       enabled: false,
       },
     });

   await recordAuditLog({
     userId: ctx.userId,
     action: 'job.rejected',
     resourceType: 'JobDefinition',
     resourceId: id,
     organizationId: platformOrgId,
     success: true,
     metadata: { note: opts.note ?? null, name: job.name },
     });
   logger.warn({ jobId: id, name: job.name, actor: ctx.userId }, 'Job rejected');
   return updated;
   },

   /** Delete a job definition (its execution history cascades). */
   async disposeJob(ctx: ServiceContext, id: string) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const job = await assertJobInOrg(id, platformOrgId);
    await globalDb.jobDefinition.delete({ where: { id: job.id } });
    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.disposed',
      resourceType: 'JobDefinition',
      resourceId: job.id,
      organizationId: platformOrgId,
      success: true,
      metadata: { name: job.name },
     });
    return { id: job.id, deleted: true as const };
   },

   /**
    * Execute a job now (manual trigger). Highest-risk action. Goes through the
    * same lifecycle as a scheduled tick but does not participate in the
    * idempotency gate (an operator override is always an explicit intent).
    */
  async triggerJob(
    ctx: ServiceContext,
    id: string,
    input?: unknown,
  ): Promise<RunResult> {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const job = await assertJobInOrg(id, platformOrgId);
    if (!job.enabled) {
      throw new ForbiddenError('Job is disabled — enable it before triggering');
      }
    if (!job.approved) {
      throw new ForbiddenError('Job is not approved — approve it before triggering');
      }
    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.triggered',
      resourceType: 'JobDefinition',
      resourceId: job.id,
      organizationId: platformOrgId,
      success: true,
      metadata: { trigger: 'MANUAL' },
     });
    return this.runJob(job.id, { trigger: 'MANUAL', actorId: ctx.userId, input });
   },

   /**
    * Dry-run a job: execute operator-authored code in the sandbox with dryRun=true.
    * Capabilities are recorded as no-ops; nothing is committed or emitted for real.
    * Super-admin only, rate-limited by the route layer.
    */
  async dryRunJob(
    ctx: ServiceContext,
    id: string,
    input?: unknown,
  ): Promise<RunResult> {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const job = await assertJobInOrg(id, platformOrgId);

    // Only jobs with operator code can be dry-run.
    const hasCode = typeof job.code === 'string' && job.code.trim().length > 0;
    if (!hasCode) {
      throw new ValidationError('dry-run only applies to jobs with operator-authored code');
     }

    await recordAuditLog({
      userId: ctx.userId,
      action: 'job.dry-run',
      resourceType: 'JobDefinition',
      resourceId: job.id,
      organizationId: platformOrgId,
      success: true,
      metadata: { dryRun: true },
     });

    return this.runJob(job.id, { trigger: 'MANUAL', actorId: ctx.userId, input, dryRun: true });
   },

   /** List jobs for the platform org (optionally filtered by enabled). */
  async listJobs(
    ctx: ServiceContext,
    opts: { enabled?: boolean; approved?: boolean; limit?: number } = {},
  ) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const where: Prisma.JobDefinitionWhereInput = { platformOrgId };
    if (opts.enabled !== undefined) where.enabled = opts.enabled;
    if (opts.approved !== undefined) where.approved = opts.approved;
    return globalDb.jobDefinition.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: opts.limit ? Math.min(Math.max(opts.limit, 1), 500) : undefined,
      });
    },

   /**
    * List jobs for the platform org with pagination. Returns the page of jobs
    * plus a `pagination` summary ({ page, pageSize, total }) so the client can
    * compute the total page count.
    */
  async listJobsPaginated(
    ctx: ServiceContext,
    opts: { enabled?: boolean; approved?: boolean; lastRunStatus?: string; search?: string; page?: number; pageSize?: number } = {},
  ) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const page = Math.max(opts.page ?? 1, 1);
    const pageSize = Math.min(Math.max(opts.pageSize ?? 20, 1), 100);

    const where: Prisma.JobDefinitionWhereInput = { platformOrgId };
    if (opts.enabled !== undefined) where.enabled = opts.enabled;
    if (opts.approved !== undefined) where.approved = opts.approved;
    if (opts.lastRunStatus) where.lastRunStatus = opts.lastRunStatus;
    if (opts.search && opts.search.trim()) {
      where.OR = [
        { name: { contains: opts.search, mode: 'insensitive' } },
        { description: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    // `total` (filtered) drives pagination. The stat-card counts are always
    // from the full platform-org dataset, independent of filters — same
    // pattern as the notifications log.
    const [items, total, totalCount, approvedCount, enabledCount] = await Promise.all([
      globalDb.jobDefinition.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      globalDb.jobDefinition.count({ where }),
      globalDb.jobDefinition.count({ where: { platformOrgId } }),
      globalDb.jobDefinition.count({ where: { platformOrgId, approved: true } }),
      globalDb.jobDefinition.count({ where: { platformOrgId, enabled: true } }),
    ]);

    return {
      items,
      pagination: { page, pageSize, total },
      counts: {
        totalCount,
        approvedCount,
        unapprovedCount: totalCount - approvedCount,
        enabledCount,
        disabledCount: totalCount - enabledCount,
      },
    };
   },

   /**
    * Read a single job by id (platform-org scoped). Throws NotFoundError if
    * the job does not exist in the caller's platform org.
    */
   async getJob(ctx: ServiceContext, id: string): Promise<JobDefinition> {
   requirePlatformAdmin(ctx);
   const platformOrgId = await resolvePlatformOrgId(ctx);
   return assertJobInOrg(id, platformOrgId);
   },

   /**
    * Execution history for a job (or across the platform org when `jobId` is
    * omitted), most-recent first, newest within `limit`.
    */
  async getExecutionHistory(
    ctx: ServiceContext,
    opts: { jobId?: string; limit?: number; status?: string } = {},
  ) {
    requirePlatformAdmin(ctx);
    const platformOrgId = await resolvePlatformOrgId(ctx);
    const where: Prisma.JobExecutionWhereInput = { platformOrgId };
    if (opts.jobId) where.jobDefinitionId = opts.jobId;
    if (opts.status) where.status = opts.status;
    return globalDb.jobExecution.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(opts.limit ?? 50, 1), 500),
      });
   },

   // -----------------------------------------------------------------------
   // Execution — the engine calls runJob on each tick.
   // -----------------------------------------------------------------------

   /**
    * Run a job: claim the instant (atomic `lastRunAt` gate), open a
    * `JobExecution`, invoke the registered handler, record the outcome, and
    * emit an SSE notification. The claim is taken *before* the handler runs so
    * overlapping ticks or a restart cannot double-execute a recurring job.
    *
    * @throws NotFoundError if the job is not found.
    */
  async runJob(
    jobDefinitionId: string,
    opts: { trigger: 'SCHEDULE' | 'MANUAL'; actorId?: string; input?: unknown; dryRun?: boolean } = {
      trigger: 'SCHEDULE',
     },
  ): Promise<RunResult> {
    const job = await globalDb.jobDefinition.findUnique({
      where: { id: jobDefinitionId },
     });
    if (!job || !job.enabled) {
      return { jobDefinitionId, status: 'SKIPPED', claimed: false };
     }

     // Build the claim instant. For a scheduled tick, only one tick at this
     // instant wins; for a manual trigger we bypass the gate (override intent).
    const claimInstant = new Date();

    let executed = true; // for scheduled, true only if we won the claim
    if (opts.trigger === 'SCHEDULE') {
      const claim = await globalDb.jobDefinition.updateMany({
        where: {
          id: jobDefinitionId,
          lastRunAt: { lt: claimInstant },
         },
        data: { lastRunAt: claimInstant, lastRunStatus: 'RUNNING' },
       });
      executed = claim.count > 0;
      if (!executed) {
        return { jobDefinitionId, status: 'SKIPPED', claimed: false };
       }
     }

    // Phase 2: if the job carries operator-authored code, run it through the
    // sandboxed script runner instead of a built-in handler. The dryRun flag
    // makes capabilities no-op recorders and the result is persisted with a
    // dryRun marker so nothing is committed/emitted for real.
    const hasCode = typeof job.code === 'string' && job.code.trim().length > 0;

    if (hasCode) {
      try {
        await runScriptJob(job, opts);
        // runScriptJob handles execution record creation + result persistence.
        return { jobDefinitionId: job.id, status: 'SUCCEEDED', claimed: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { jobDefinitionId: job.id, status: 'FAILED', claimed: true, error: message };
      }
    }

    // Resolve the handler. Phase 1 built-ins live in the registry; a missing
     // handler is a real failure (the job was created pointing at nothing).
    const handler = getHandler(job.handlerKey);
    if (!handler) {
      await failExecution(job, claimInstant, { trigger: opts.trigger, actorId: opts.actorId },
         `No handler registered for key "${job.handlerKey}"`);
      return { jobDefinitionId, status: 'FAILED', claimed: true,
        error: `No handler registered for key "${job.handlerKey}"` };
     }

     // Open the execution record.
    const execution = await globalDb.jobExecution.create({
      data: {
        jobDefinitionId: job.id,
        platformOrgId: job.platformOrgId,
        status: 'RUNNING',
        trigger: opts.trigger,
        actorId: opts.actorId ?? null,
        source: 'job-scheduler:execution',
       },
     });

     // Run the handler with a wall-clock timeout.
    const handlerCtx: JobRunContext = {
      jobDefinitionId: job.id,
      platformOrgId: job.platformOrgId,
      trigger: opts.trigger,
      input: opts.input,
     };
    const timeoutMs = job.timeoutMs ?? defaultTimeoutMs();

    try {
      const result = await withTimeout(handler(handlerCtx), timeoutMs);
      await globalDb.jobExecution.update({
        where: { id: execution.id },
        data: {
          status: 'SUCCEEDED',
          finishedAt: new Date(),
          resultJson: toJsonValue(result) as Prisma.InputJsonValue | undefined,
          },
       });
      if (opts.trigger === 'SCHEDULE') {
        await globalDb.jobDefinition.update({
          where: { id: job.id },
          data: { lastRunStatus: 'SUCCEEDED' },
         });
       }
      // Worker guard: live SSE subscribers only exist in the parent thread; a
      // worker's copy of the subscriber map is empty, so its push would persist
      // and log but deliver nothing. The engine (parent) re-emits on receipt —
      // DB dedup collapses the double. Inline/trigger runs are never marked as
      // scheduler workers, so they deliver directly.
      if (!isJobSchedulerWorker()) {
        await notifyExecution(job.name, job.platformOrgId, 'SUCCEEDED');
      }
      logger.info({ jobId: job.id, executionId: execution.id }, 'Job succeeded');
      return { jobDefinitionId: job.id, executionId: execution.id, status: 'SUCCEEDED', claimed: true };
     } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failExecution(
         job,
         claimInstant,
         { trigger: opts.trigger, actorId: opts.actorId, executionId: execution.id },
         message,
        );
      logger.error(
         { jobId: job.id, executionId: execution.id, error: message },
         'Job failed',
       );
      return { jobDefinitionId: job.id, executionId: execution.id, status: 'FAILED', claimed: true };
     }
   },

   /**
    * Register a batch of built-in handlers. Called once by the engine at start.
    * Each entry is `{ key, handler }`. Idempotent — safe to call multiple times.
    */
  registerBuiltins(registration: Array<{ key: string; handler: JobHandler }>): void {
    for (const { key, handler } of registration) registerHandler(key, handler);
   },
};

// ---------------------------------------------------------------------------
// Internal helpers — free functions for testability
// ---------------------------------------------------------------------------

/** Read once and cache the relevant env values (avoid re-reading per tick). */
const jobSchedulerEnv = {
  platformOrgId: undefined as string | undefined,
  get() {
    if (jobSchedulerEnv.platformOrgId === undefined) {
      const id = env.PLATFORM_ORGANIZATION_ID;
      jobSchedulerEnv.platformOrgId =
        typeof id === 'string' && id.length > 0 ? id : undefined;
     }
    return jobSchedulerEnv.platformOrgId;
   },
};

/**
 * Resolve the platform organization ID with fallback chain:
 * 1. Context-provided organizationId (for API routes that pass it)
 * 2. Environment variable PLATFORM_ORGANIZATION_ID
 * 3. Database lookup for platform organization
 */
async function resolvePlatformOrgId(ctx: ServiceContext): Promise<string> {
  // 1. Check context-provided organizationId
  if (ctx.organizationId) {
    return ctx.organizationId;
  }

  // 2. Check environment variable (cached)
  const fromEnv = jobSchedulerEnv.get();
  if (fromEnv) {
    return fromEnv;
  }

  // 3. Fallback to database lookup
  const org = await globalDb.organization.findFirst({
    where: { slug: 'platform' },
    select: { id: true },
  });

  if (!org) {
    throw new ForbiddenError('Platform organization not found. Run the seed script.');
  }

  return org.id;
}

async function assertJobInOrg(
  id: string,
  platformOrgId: string | undefined,
): Promise<JobDefinition> {
  if (!platformOrgId) {
    throw new ForbiddenError('A platform organization context is required');
   }
  const job = await globalDb.jobDefinition.findUnique({ where: { id } });
  if (!job || job.platformOrgId !== platformOrgId) {
    throw new NotFoundError(`Job not found in platform org: ${id}`);
   }
  return job;
}

async function failExecution(
  job: { id: string; platformOrgId: string; name: string },
  _claimInstant: Date,
  opts: { trigger: 'SCHEDULE' | 'MANUAL'; actorId?: string; executionId?: string },
  message: string,
): Promise<void> {
  try {
    if (opts.executionId) {
      await globalDb.jobExecution.update({
        where: { id: opts.executionId },
        data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 4000) },
       });
     } else {
       await globalDb.jobExecution.create({
         data: {
            jobDefinitionId: job.id,
            platformOrgId: job.platformOrgId,
            status: 'FAILED',
            trigger: opts.trigger,
            actorId: opts.actorId ?? null,
            error: message.slice(0, 4000),
            source: 'job-scheduler:execution',
            startedAt: new Date(),
            finishedAt: new Date(),
           },
         });
       }
       await globalDb.jobDefinition.update({
         where: { id: job.id },
          data: { lastRunStatus: 'FAILED' },
        });
      } catch (dbError) {
       // Swallow secondary DB failures but keep them visible.
      logger.error({ error: dbError }, 'jobScheduler: failed to persist failure state');
      }
      // A failed job run is a platform-visible event. Worker guard: only the
      // parent thread reaches live SSE subscribers (see SUCCEEDED path above);
      // in worker mode the engine re-emits on receipt. Inline/trigger runs
      // deliver directly here.
      if (!isJobSchedulerWorker()) {
        void notifyExecution(job.name, job.platformOrgId, 'FAILED', message);
      }
    }

async function notifyExecution(
  name: string,
  platformOrgId: string,
  status: 'SUCCEEDED' | 'FAILED',
  error?: string,
): Promise<void> {
  try {
    if (status === 'FAILED') {
      await pushNotification({
        title: `Job failed: ${name}`,
        message: error
          ? `Job "${name}" failed: ${error}`
          : `Job "${name}" failed.`,
        priority: NotificationPriority.ERROR,
        scope: NotificationScope.GLOBAL,
        source: 'job-scheduler:failure',
        organizationId: platformOrgId,
       });
     } else {
       await pushNotification({
         title: `Job completed: ${name}`,
         message: `Job "${name}" completed successfully.`,
         priority: NotificationPriority.JOB,
         scope: NotificationScope.GLOBAL,
         source: 'job-scheduler:execution',
         organizationId: platformOrgId,
         });
       }
   } catch {
      // A broken notification channel must not take down a job run.
       // pino handles the error; we just swallow here.
     }
}

/** Run a promise with a wall-clock timeout; rejects if it exceeds `ms`. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Job exceeded timeout of ${ms}ms`)), ms);
    });
  try {
    return await Promise.race([promise, timeout]);
    } finally {
    if (timer) clearTimeout(timer);
    }
}

/** Coerce a handler result into a Json-safe value (best effort). */
function toJsonValue(
  value: unknown,
):
   | Record<string, unknown>
   | string
   | number
   | boolean
   | null
   | undefined {
  if (value === undefined) return undefined;
  if (value instanceof Date) return { _asIso: value.toISOString() };
  if (typeof value === 'bigint') return String(value);
  if (value === null || typeof value !== 'object') return value as string | number | boolean;
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
   } catch {
    return { toString: String(value) };
   }
}

// ---------------------------------------------------------------------------
// Phase 2 — sandboxed script execution helper
// ---------------------------------------------------------------------------

/**
 * Run a job whose `code` field carries operator-authored source. Executes the
 * code in a vm sandbox, records capabilities used, and persists the outcome —
 * including a `dryRun` marker when applicable. Nothing is committed/emitted for
 * real in dry-run mode (no pushNotification, no lastRunStatus update).
 */
async function runScriptJob(
  job: { id: string; platformOrgId: string; name: string; timeoutMs?: number | null },
  opts: { trigger: 'SCHEDULE' | 'MANUAL'; actorId?: string; input?: unknown; dryRun?: boolean },
): Promise<void> {
  const code = (job as { id: string; platformOrgId: string; name: string; timeoutMs?: number | null; code?: unknown }).code as string | undefined;
  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('Job has no operator code to execute');
   }

  const dryRun = opts.dryRun ?? false;
  const timeoutMs = job.timeoutMs ?? defaultTimeoutMs();

  // Open the execution record.
  const execution = await globalDb.jobExecution.create({
    data: {
      jobDefinitionId: job.id,
      platformOrgId: job.platformOrgId,
      status: 'RUNNING',
      trigger: opts.trigger,
      actorId: opts.actorId ?? null,
      source: 'job-scheduler:execution',
     },
   });

  try {
    const result = await withTimeout(
      runScriptInSandbox({
        code,
        jobDefinitionId: job.id,
        platformOrgId: job.platformOrgId,
        trigger: opts.trigger,
        input: opts.input,
        dryRun,
      }),
      timeoutMs,
    );

    // Build the persisted result — include capabilitiesUsed and dryRun marker.
    const resultJson: Record<string, unknown> = {
      ...(result.result as Record<string, unknown> ?? {}),
      capabilitiesUsed: result.capabilitiesUsed,
    };
    if (dryRun) {
      resultJson.dryRun = true;
     }

    await globalDb.jobExecution.update({
      where: { id: execution.id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: new Date(),
        resultJson: toJsonValue(resultJson) as Prisma.InputJsonValue,
       },
     });

    // In dry-run mode: do NOT update lastRunStatus, do NOT emit SSE.
    if (!dryRun) {
      await globalDb.jobDefinition.update({
        where: { id: job.id },
        data: { lastRunStatus: 'SUCCEEDED' },
       });
      // Worker guard: only the parent thread can reach live SSE subscribers;
      // in worker mode the engine (parent) re-emits on receipt and DB dedup
      // collapses the double. See the identical guard in runJob's handler path.
      if (!isJobSchedulerWorker()) {
        await notifyExecution(job.name, job.platformOrgId, 'SUCCEEDED');
      }
     }

    logger.info(
      { jobId: job.id, executionId: execution.id, dryRun },
      'Script job succeeded',
    );
   } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Persistence runs in every thread; the failure notification is parent-only
    // (worker mode re-emits on receipt — see above). Inline mode delivers here.
    await globalDb.jobExecution.update({
      where: { id: execution.id },
      data: { status: 'FAILED', finishedAt: new Date(), error: message.slice(0, 4000) },
     });

    if (!dryRun) {
      await globalDb.jobDefinition.update({
        where: { id: job.id },
        data: { lastRunStatus: 'FAILED' },
       });
      if (!isJobSchedulerWorker()) {
        void notifyExecution(job.name, job.platformOrgId, 'FAILED', message);
      }
     }

    logger.error(
      { jobId: job.id, executionId: execution.id, error: message },
      'Script job failed',
    );
    
    // Re-throw so runJob can return FAILED status
    throw error;
   }
}

export default JobSchedulerService;
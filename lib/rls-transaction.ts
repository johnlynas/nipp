/**
 * RLS transaction primitives — the ONLY places app.current_* GUCs are bound to
 * a connection (RLS plan Tasks 1C/3A, as-built Phase 3 wiring).
 *
 * Design choice: NO policy reads `app.current_user_id` (verified against live
 * pg_policies — only app.current_org_id / app.is_platform_admin /
 * app.platform_org_id are read). The GUC binding is therefore driven from the
 * async-localStorage tenant context (orgId + platform-admin flag), set once at
 * the route boundary from server-verified inputs. `userId` stays available in
 * the ALS context for auditing/app layers; it is bound into the GUC statement
 * when present but never gates DB visibility.
 *
 *   withTenantRLS(op)    binds the current ALS RLS context (fail-closed when a
 *                        full verified context (userId+orgId) is not active)
 *                        and runs `op` with GUCs + one pinned connection.
 *   withEnvPlatformContext(op)     out-of-request background processes (health
 *                        check / calendar scanner / job scheduler parent):
 *                        binds the env-verified platform org, flag=1. Passes
 *                        through UNBOUND when PLATFORM_ORGANIZATION_ID is unset
 *                        (unit-test mocks; non-platform deployments) rather
 *                        than crashing — production guards guarantee presence.
 *   withPlatformContextForDB(orgId, op)  explicit binding for out-of-request /
 *                        bootstrap callers (no ALS): env platform org, flag=1,
 *                        platformOrgId set — used by cache warming and
 *                        admin/platform routes that scope to the platform org.
 *   withPlatformOperator(userId, op)     out-of-request platform processes with
 *                        a verified operator id (job scheduler engine/bree).
 *   runWithRLS(ctx, op)  low-level: bind an explicit RLSContext + run `op` on
 *                        the pinned interactive tx (kept for tests/jobs).
 *
 * Connection-pinning + local-scope semantics were verified empirically against
 * this exact Prisma/Postgres build (scripts/rls-phase3-probe.mjs, Phase 3 log):
 * GUCs are visible inside the txn and reset after commit; $extends callbacks
 * fire on interactive-tx clients. Nested `prisma.$transaction` reuses the
 * pinned connection, so service-level transactions stay covered end-to-end.
 */
import type { PrismaClient } from '@prisma/client';
import prisma from './db';
import { buildRLSContextQueries, type RLSContext } from './rls-context';
// Re-exported so downstream callers (lib/platform-db.ts) import the verified
// context TYPE from this module — the single choke point — and never touch
// lib/rls-context directly (enforced by ESLint no-restricted-imports).
export type { RLSContext };
import { getRLSContext, runWithTenantContext } from './tenant-context';
import { makeRLSTxSlot, wrapWithActiveRLSTx } from './db-context';
import { diagLogMaxDepth } from './db-context';

/** Interactive-transaction surface needed by callers of runWithRLS. */
export interface RLSTx {
  $executeRawUnsafe(query: string): Promise<unknown>;
}

function assertRLSContext(ctx: RLSContext | null | undefined, label: string): asserts ctx is RLSContext {
  if (!ctx || !ctx.orgId) {
    throw new Error(`${label}: RLS context invalid — orgId required (fail-closed)`);
  }
}

function bindAndRun<T>(ctx: RLSContext, op: () => T | Promise<T>, opts?: { txTimeoutMs?: number }): Promise<T> {
  assertRLSContext(ctx, 'bindAndRun');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(buildRLSContextQueries({ ...ctx, userId: ctx.userId || '' }));
    // `op` runs on the base client by design: nested tenantDb model access
    // resolves to THIS pinned interactive tx via lib/db-context (ALS-scoped for
    // exactly this operation tree; proxy in lib/tenant-db.ts reuses this connection
    // for nested $transaction and serializes sibling model ops through the slot's
    // lock) — GUCs stay in scope for the whole operation.
    const slot = makeRLSTxSlot(tx);
    return wrapWithActiveRLSTx(slot, () => op()).then(
      (res) => { diagLogMaxDepth(tx); return res; },
      (err) => { diagLogMaxDepth(tx); throw err; },
    );
  }, opts?.txTimeoutMs ? { timeout: opts.txTimeoutMs } : undefined);
}

/** Bind an explicit verified context (never derived from request input). */
export async function withExplicitRLS<T>(ctx: RLSContext, op: () => T | Promise<T>): Promise<T> {
  return bindAndRun(ctx, op);
}

/**
 * The standard route-boundary wrapper (Phase 3): establishes the full ALS
 * tenant context for `op` (app-layer extension scoping) AND binds the matching
 * GUCs on one pinned interactive connection (DB-layer RLS). One call per
 * request handler — services and scoped helpers inside it keep working via ALS.
 */
export async function withRLSContext<T>(
  tenantCtx: { userId: string; orgId?: string; isPlatformAdmin?: boolean },
  op: () => T | Promise<T>
): Promise<T> {
  return bindAndRun(
    { userId: tenantCtx.userId, orgId: tenantCtx.orgId as string, isPlatformAdmin: tenantCtx.isPlatformAdmin ?? false },
    () => runWithTenantContext({ userId: tenantCtx.userId, orgId: tenantCtx.orgId, isPlatformAdmin: tenantCtx.isPlatformAdmin }, op)
  );
}

/**
 * Run `op` with the CURRENT ALS tenant context bound as GUCs on one pinned
 * interactive transaction. Fail-closed: throws when no full verified context
 * (userId + orgId) is active — a not-yet-wrapped call site gets an error,
 * never unscoped rows.
 */
export async function withTenantRLS<T>(op: () => T | Promise<T>): Promise<T> {
  const ctx = getRLSContext();
  if (!ctx || !ctx.userId || !ctx.orgId) {
    throw new Error(
      'withTenantRLS: no verified tenant context (runWithTenantContext required at the route boundary; fail-closed).'
    );
  }
  return bindAndRun(ctx, op);
}

/**
 * Explicit platform-context binding for callers outside a request's ALS scope.
 * orgId MUST be env-verified (platform org id) by the caller — never input.
 *
 * `txTimeoutMs` overrides Prisma's interactive-transaction lifetime (default
 * 5000 ms) for runs that do real work inside the bound context — e.g. the Bree
 * job worker, whose runJob executes a handler up to the per-job cap. Callers
 * doing only short model ops can omit it; long callers MUST pass at least
 * their worst-case duration (+ margin), or the pinned tx is auto-terminated
 * mid-run (P2028). The caller owns pool implications: one pinned pooled
 * connection for the whole window.
 */
export async function withPlatformContextForDB<T>(
  orgId: string,
  op: () => T | Promise<T>,
  opts?: { txTimeoutMs?: number },
): Promise<T> {
  return bindAndRun({ userId: '', orgId, isPlatformAdmin: true, platformOrgId: orgId }, op, opts);
}

/**
 * Env-sourced platform binding for OUT-OF-REQUEST background processes
 * (30 s health checker, calendar scanner, job-scheduler parent thread).
 * These run with no request ALS and no verified session user; the only
 * server-derived identity available is PLATFORM_ORGANIZATION_ID. Binding it
 * (flag=1) is what lets their Notification INSERTs pass RLS's rls_notification_insert
 * platform branch, and their cross-tenant reads (JobDefinition / CalendarEvent)
 * return rows — a context-less write 42501s under the non-owner app role, and
 * a context-less read silently returns zero rows (fail-closed) instead.
 *
 * Passes through UNBOUND when PLATFORM_ORGANIZATION_ID is unset so mock-client
 * unit tests keep running; live deployments seed it, and the RLS layer stays
 * fail-closed for anything that truly has no context (e.g. the Bree worker
 * fork itself — see lib/job-scheduler-engine.ts).
 */
export async function withEnvPlatformContext<T>(op: () => T | Promise<T>): Promise<T> {
  const platformOrgId = process.env.PLATFORM_ORGANIZATION_ID;
  if (!platformOrgId) return op();
  return bindAndRun({ userId: '', orgId: platformOrgId, isPlatformAdmin: true, platformOrgId }, op);
}

/** Out-of-request platform process with a verified operator user id (jobs). */
export async function withPlatformOperator<T>(operatorUserId: string, op: () => T | Promise<T>): Promise<T> {
  if (!operatorUserId) throw new Error('withPlatformOperator: verified operator user id required (fail-closed)');
  const platformOrgId = process.env.PLATFORM_ORGANIZATION_ID || '';
  return bindAndRun(
    { userId: operatorUserId, orgId: platformOrgId, isPlatformAdmin: true, platformOrgId },
    op
  );
}

/**
 * Low-level primitive: bind an explicit RLSContext on a NEW interactive tx of
 * `client` and run `op(tx)` on it (GUCs + queries share the pinned conn). The
 * db-context slot is set for the call, so tenantDb routes to `tx`.
 */
export async function runWithRLS<T>(
  client: PrismaClient,
  ctx: RLSContext,
  op: (tx: RLSTx & Record<string, unknown>) => Promise<T> | T
): Promise<T> {
  assertRLSContext(ctx, 'runWithRLS');
  const c = client as unknown as { $transaction(fn: (t: never) => Promise<T>): Promise<T> };
  return c.$transaction(async (txRaw) => {
    const tx = txRaw as RLSTx & Record<string, unknown>;
    await tx.$executeRawUnsafe(buildRLSContextQueries({ ...ctx, userId: ctx.userId || '' }));
    // ALS-scoped for exactly this operation tree — see bindAndRun. `op(tx)` gets
    // the raw tx; sibling tenantDb model ops inside are serialized via the slot's lock.
    return wrapWithActiveRLSTx(makeRLSTxSlot(tx), async () => op(tx));
  });
}

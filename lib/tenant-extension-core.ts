/**
 * Tenant isolation Prisma client core (lib/tenant-db.ts).
 *
 * APP LAYER (first line): every tenant-scoped model operation gets `organizationId`
 * (= `orgId` on Member) forced into its where/data by `enforceScoping`, resolved from
 * the async-localStorage tenant context and failing closed when no verified org context
 * is active. Platform-admin contexts (flag=1, verified at the route boundary) pass
 * through — RLS is authoritative for them (cross-tenant; design §3.2).
 *
 * The scoping handlers have two equivalent application sites:
 *   1. $extends on the base client — covers every query OUTSIDE a bound RLS tx.
 *   2. `wrapScopedModel` proxy — inside a pinned interactive-tx, where Prisma CANNOT
 *      $extends (verified live on 6.19.3: `tx.$extends` is undefined). The proxy feeds
 *      each handler the exact same ({args, query}) shape $extensions use, with `query`
 *      calling the raw tx model op.
 *
 * DB LAYER (second line): inside a withRLS/withExplicitRLS transaction GUCs are set via
 * $executeRawUnsafe on the pinned connection, so Postgres RLS evaluates on that one
 * physical connection — covering ALL 18 tables (beyond the app-layer model list) for the
 * whole operation tree. The two lines compose: RLS backstops the insert paths whose
 * policies carry no WITH CHECK (Notification/Organization/AuditLog INSERT).
 */

import { getCurrentOrgId as readCurrentOrgId, getTenantContext } from './tenant-context';

/**
 * Tenant-scoped Prisma models — the EXACT set of schema models that carry a
 * required org column (organizationId; orgId for the BetterAuth-owned models).
 * Cross-checked at unit-test time against prisma/schema.prisma itself
 * (tests/unit/tenant-db-hardening.test.ts parses the schema), so a renamed
 * model or a new org-scoped model fails the suite instead of silently losing
 * scoping. Regeneration guard: if you touch this list, run
 * `npm test` — coverage drift is a release-blocking failure (design §5.2).
 */
export const TENANT_SCOPED_MODELS = ['Role', 'RolePermission', 'MemberRole', 'Member', 'Invitation', 'SentInvitation', 'Team', 'TeamMember', 'TeamRole', 'Calendar', 'CalendarEvent'] as const;

/** Compile-time name type for any tenant-scoped model. */
export type TenantScopedModelName = (typeof TENANT_SCOPED_MODELS)[number];

/** Structural type for Prisma extension query callbacks. */
type QueryArgs = Record<string, unknown>;

interface ExtensionCallback {
  args: QueryArgs;
  query: (args: QueryArgs) => Promise<unknown>;
}

/** One per-model tenant-isolation extension (shape accepted by client.$extends). */
export interface TenantExtension {
  name: string;
  model: Record<string, unknown>;
}

function requireOrg(): string {
  const orgId = readCurrentOrgId();
  if (!orgId) throw new Error('Tenant context missing for scoped query.');
  return orgId;
}

/** True when a verified platform-admin context is active (RLS authoritative). */
function getFlag(): boolean {
  return getTenantContext()?.isPlatformAdmin === '1';
}

function orgFieldFor(name: string): string {
  return name === 'Member' ? 'orgId' : 'organizationId';
}

/**
 * The single scoping rule for one model, shared by both application sites.
 * Throws fail-closed when a non-platform context is missing its org.
 */
function enforceScoping(model: string, args: QueryArgs): void {
  if (getFlag()) return; // platform ctx: RLS authoritative — no pre-narrowing
  const orgId = requireOrg();
  args.where = { ...(args.where as QueryArgs), [orgFieldFor(model)]: orgId };
}

/** The per-model handler map consumed by BOTH the $extends path and the proxy path. */
function makeHandlers(model: string): Record<string, (cb: ExtensionCallback) => Promise<unknown>> {
  const scopeWhere = ({ args, query }: ExtensionCallback): Promise<unknown> => {
    enforceScoping(model, args);
    return query(args);
  };

  return {
    findUnique: scopeWhere,
    findFirst: scopeWhere,
    findMany: scopeWhere,
    update: scopeWhere,
    updateMany: scopeWhere,
    delete: scopeWhere,
    deleteMany: scopeWhere,
    // Task 4B (design §5.2): aggregate-shaped ops accept the same `where` —
    // same scoping rule closes the silent count/aggregate/groupBy gap.
    count: scopeWhere,
    aggregate: scopeWhere,
    groupBy: scopeWhere,

    create: ({ args, query }: ExtensionCallback): Promise<unknown> => {
      if (getFlag()) return query(args); // platform ctx: caller sets org explicitly; RLS checks it
      args.data = { ...(args.data as QueryArgs), [orgFieldFor(model)]: requireOrg() };
      return query(args);
    },

    upsert: ({ args, query }: ExtensionCallback): Promise<unknown> => {
      if (getFlag()) return query(args); // platform ctx: pass through (RLS authoritative)
      const orgId = requireOrg();
      args.where = { ...(args.where as QueryArgs), [orgFieldFor(model)]: orgId };
      if (args.create) args.create = { ...(args.create as QueryArgs), [orgFieldFor(model)]: orgId };
      if (args.update) args.update = { ...(args.update as QueryArgs), [orgFieldFor(model)]: orgId };
      return query(args);
    },
  };
}

/** One per-model $extends extension (outside-transaction base client). */
export function createTenantExtensionForModel(model: string): TenantExtension {
  return { name: `tenant-isolation-${model.toLowerCase()}`, model: { [model]: makeHandlers(model) } };
}

/** Build the tenant-isolation extensions for every scoped model. */
export function buildTenantExtensions(): TenantExtension[] {
  return TENANT_SCOPED_MODELS.map(createTenantExtensionForModel);
}

/** Test/inspection handle: the tenant-scoped model names (as an array). */
export const TENANT_SCOPED_MODELS_FOR_TEST: readonly string[] = [...TENANT_SCOPED_MODELS];

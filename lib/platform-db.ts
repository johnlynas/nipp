/**
 * Platform (super-admin) DB context helpers — verified-context wrappers for
 * routes that are NOT tenant org-scoped (admin dashboards, platform tables,
 * cross-tenant management of a target org).
 *
 * RLS plan Phase 3: these replace the unscoped globalDb client. Every operation
 * here runs under withRLS with a verified context built from:
 *   - userId     the confirmed super-admin session user (requireSuperAdmin)
 *   - isPlatformAdmin=true — this flag is what lets Postgres RLS expose
 *     cross-tenant rows to these operations (policies verified live)
 *   - platformOrgId env — JobDefinition/JobExecution visibility
 * Without a prior verification the corresponding wrapper cannot be reached:
 * routes only call these after requireSuperAdmin passed.
 */
import { env } from './env';
import { withExplicitRLS, type RLSContext } from './rls-transaction';
import { runWithTenantContext } from './tenant-context';

/** Fail-closed platform org id (env-sourced; seed guarantees presence). */
export function getVerifiedPlatformOrgId(): string {
  const id = env.PLATFORM_ORGANIZATION_ID;
  if (!id) {
    throw new Error('PLATFORM_ORGANIZATION_ID unset — platform operations are fail-closed');
  }
  return id;
}

/**
 * Build a verified PLATFORM context: scope GUCs to the platform org, admin
 * flag on. userId MUST come from the verified session (requireSuperAdmin) —
 * never request input.
 */
export function buildPlatformContext(userId: string): RLSContext {
  if (!userId) throw new Error('buildPlatformContext: userId required (fail-closed)');
  const platformOrgId = getVerifiedPlatformOrgId();
  return { userId, orgId: platformOrgId, isPlatformAdmin: true, platformOrgId };
}

/** Run `op` with a verified PLATFORM admin context (cross-tenant reads allowed). */
export async function withPlatformContext<T>(userId: string, op: () => T | Promise<T>): Promise<T> {
  const ctx = buildPlatformContext(userId);
  // GUCs bind on the pinned interactive-tx connection; ALS (runWithTenantContext)
  // resolves app-layer extension scoping for scoped models inside `op` — a
  // platform context WITHOUT orgId passes through to RLS (flag=1) rather than
  // being pre-narrowed (see lib/tenant-extension-core injectOrg).
  return withExplicitRLS(ctx, () => runWithTenantContext({ userId, isPlatformAdmin: true }, op));
}

/**
 * Build a TENANT-management context: platform super admin acting on a specific
 * target org (the route's [orgId]/[id] param). Scoped model queries inside `op`
 * resolve to this org; the admin flag permits cross-tenant platform tables.
 * Used by /api/admin/organizations/[orgId]/* and the dashboard management routes.
 */
export function buildTenantAdminContext(userId: string, targetOrgId: string): RLSContext {
  if (!userId) throw new Error('buildTenantAdminContext: userId required (fail-closed)');
  if (!targetOrgId) throw new Error('buildTenantAdminContext: targetOrgId required (fail-closed)');
  return {
    userId,
    orgId: targetOrgId,
    isPlatformAdmin: true,
    platformOrgId: getVerifiedPlatformOrgId(),
  };
}

/** Run `op` with a verified TENANT-management context on a specific target org. */
export async function withTenantAdminContext<T>(
  userId: string,
  targetOrgId: string,
  op: () => T | Promise<T>
): Promise<T> {
  const ctx = buildTenantAdminContext(userId, targetOrgId);
  // ALS mirrors the GUCs so tenant-db extension resolution sees a verified
  // platform context scoped to the target org (flag=1 pass-through; RLS binds
  // writes to current_org via WITH CHECK).
  return withExplicitRLS(ctx, () => runWithTenantContext({ userId, orgId: targetOrgId, isPlatformAdmin: true }, op));
}

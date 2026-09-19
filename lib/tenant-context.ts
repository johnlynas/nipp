import { AsyncLocalStorage } from 'async_hooks';

/**
 * Factory to create a new AsyncLocalStorage instance.
 */
export function createStorage<T>(): AsyncLocalStorage<T> {
  return new AsyncLocalStorage<T>();
}

/**
 * AsyncLocalStorage-based tenant context.
 *
 * Propagates the current organization ID through the request lifecycle,
 * making it available to all downstream operations without explicit parameter passing.
 */

const tenantContextStorage = createStorage<Record<string, string>>();

/** Full verified RLS/tenant context carried through a request (RLS plan Phase 1D). */
export interface TenantContextObject {
  orgId: string;
  /** Verified BetterAuth user id — server-derived only. */
  userId: string;
  /** true iff the caller is a verified platform-organization member. */
  isPlatformAdmin?: boolean;
}

function toStore(ctx: TenantContextObject): Record<string, string> {
  return { orgId: ctx.orgId, userId: ctx.userId, isPlatformAdmin: ctx.isPlatformAdmin ? '1' : '0' };
}

/**
 * Execute a function within a tenant context.
 * @param orgId - The organization ID to scope queries to
 * @param fn - Function to execute within the tenant context
 */
export function runWithTenant<T>(orgId: string, fn: () => T): T {
  return tenantContextStorage.run({ orgId }, fn);
}

/**
 * Execute a function within a fully verified RLS context (RLS plan Phase 1D).
 * Carries userId + isPlatformAdmin so the database layer (lib/rls-transaction.ts)
 * can bind GUCs per request. Backward-compatible with runWithTenant(orgId, fn).
 */
export function runWithTenantContext<T>(ctx: TenantContextObject, fn: () => T): T {
  if (!ctx.orgId) throw new Error('Tenant context invalid: orgId required (fail-closed)');
  if (!ctx.userId) throw new Error('Tenant context invalid: userId required (fail-closed)');
  return tenantContextStorage.run(toStore(ctx), fn);
}

/**
 * Get the current organization ID from the tenant context.
 * @returns The current organization ID, or null if no context is active
 */
export function getCurrentOrgId(): string | null {
  const store = tenantContextStorage.getStore();
  return store?.orgId ?? null;
}

/**
 * Get the full tenant context store.
 */
export function getTenantContext(): Record<string, string> | null {
  return tenantContextStorage.getStore() ?? null;
}

/** Current verified user id (only set under runWithTenantContext). */
export function getCurrentUserId(): string | null {
  return getTenantContext()?.userId ?? null;
}

/** '1'/'0' platform-admin flag from the store; null when no full context is active. */
export function getIsPlatformAdminFlag(): '1' | '0' | null {
  const v = getTenantContext()?.isPlatformAdmin;
  return v === undefined ? null : (v === '1' ? '1' : '0');
}

/**
 * Combine the propagated context into the GUC builder's input, or null when a
 * full verified context is not active (fail-closed: callers must treat null as "no RLS").
 */
export function getRLSContext(): { userId: string; orgId: string; isPlatformAdmin: boolean } | null {
  const store = getTenantContext();
  if (!store?.orgId || !store.userId) return null;
  return { userId: store.userId, orgId: store.orgId, isPlatformAdmin: store.isPlatformAdmin === '1' };
}

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

/**
 * Execute a function within a tenant context.
 * @param orgId - The organization ID to scope queries to
 * @param fn - Function to execute within the tenant context
 */
export function runWithTenant<T>(orgId: string, fn: () => T): T {
  return tenantContextStorage.run({ orgId }, fn);
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

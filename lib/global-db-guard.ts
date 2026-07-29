/**
 * ============================================================================
 * GLOBAL DATABASE CLIENT — SUPER ADMIN ONLY (WITH RUNTIME GUARD)
 * ============================================================================
 *
 * SECURITY (S7): This client BYPASSES tenant isolation. Unlike `@/lib/db`
 * (wrapped by the tenant-scoped client in `@/lib/tenant-db.ts`), this Prisma
 * client has NO organizationId filtering. Queries against org-scoped models
 * will return data from ALL organizations.
 *
 * RUNTIME GUARD: This module wraps globalDb with a runtime check that throws
 * if accessed outside a super-admin context. This prevents accidental use in
 * non-admin routes from silently bypassing tenant isolation.
 *
 * USAGE RULES:
 *   1. ONLY import and use through getGlobalDb() below.
 *   2. NEVER import globalDb directly from this file or from `@/lib/global-db`.
 *   3. NEVER use in middleware, client components, or Edge Runtime code.
 *   4. ALWAYS ensure the route is guarded by `withSuperAdmin()` or
 *      `requireSuperAdmin()` before calling getGlobalDb().
 *   5. Wrap any code that calls getGlobalDb() in superAdminStorage.run(true, ...)
 *      to scope the context to that async operation only.
 *
 * If you are unsure whether you should use this client, the answer is NO.
 * Use `@/lib/db` with tenant isolation instead.
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Prisma client singleton (same pattern as lib/db.ts)
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const globalDb =
  globalForPrisma.prisma || new PrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = globalDb;

// ---------------------------------------------------------------------------
// Runtime guard via AsyncLocalStorage (mirrors tenant-context.ts pattern)
// ---------------------------------------------------------------------------

import { createStorage } from '@/lib/tenant-context';

/**
 * AsyncLocalStorage that tracks whether the current request is in a
 * super-admin context. Set by `withSuperAdmin()` middleware after verifying
 * privileges; checked by getGlobalDb() to enforce runtime safety.
 *
 * IMPORTANT: Always use superAdminStorage.run(true, callback) to scope the
 * context to a specific async operation. Never use enterWith() — it leaks
 * across requests in connection-pooled environments.
 */
const superAdminStorage = createStorage<boolean>();

/**
 * Export for callers that need to wrap code in super-admin context.
 * Usage: superAdminStorage.run(true, () => { use getGlobalDb() here });
 */
export { superAdminStorage };

/**
 * Get the global (unscoped) Prisma client.
 *
 * SECURITY: Throws if called outside a super-admin context. This prevents
 * accidental use in non-admin routes from silently bypassing tenant isolation.
 */
export function getGlobalDb(): PrismaClient {
  const inSuperAdminContext = superAdminStorage.getStore();

  if (!inSuperAdminContext) {
    const error = new Error(
      'SECURITY: globalDb accessed outside super-admin context. ' +
      'Ensure the route is guarded by withSuperAdmin() or requireSuperAdmin().'
    );
    // Capture stack trace for debugging
    Error.captureStackTrace(error, getGlobalDb);
    throw error;
  }

  return globalDb;
}

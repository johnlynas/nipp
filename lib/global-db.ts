/**
 * ============================================================================
 * GLOBAL DATABASE CLIENT — SUPER ADMIN ONLY
 * ============================================================================
 *
 * WARNING: This client BYPASSES tenant isolation.
 *
 * Unlike `@/lib/db` (which is wrapped by the tenant-scoped client in
 * `@/lib/tenant-db.ts`), this Prisma client has NO organizationId filtering.
 * Queries against org-scoped models will return data from ALL organizations.
 *
 * USAGE RULES:
 *   1. ONLY import this client in API routes guarded by `requireSuperAdmin()`.
 *   2. NEVER import from middleware, client components, or Edge Runtime code.
 *   3. NEVER pass user-supplied values as model names (use allowlists).
 *
 * If you are unsure whether you should use this client, the answer is NO.
 * Use `@/lib/db` with tenant isolation instead.
 * ============================================================================
 */

import { PrismaClient } from '@prisma/client';
import { env } from '@/lib/env';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const globalDb =
  globalForPrisma.prisma || new PrismaClient();

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = globalDb;

export default globalDb;

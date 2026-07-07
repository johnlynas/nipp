/**
 * Permission resolver — fetches a user's resolved permissions from the database.
 *
 * Uses Redis caching with a 5-minute TTL for performance:
 *   1. Check Redis cache for the user's permission set
 *   2. If cache miss, fetch from database
 *   3. Store result in Redis with 5-minute TTL
 *
 * All database operations are scoped to the user's organization via Prisma.
 */

import prisma from '@/lib/db';
import { redisGet, redisSet, redisDel, redis } from '../redis';

const PERMISSION_CACHE_TTL = 5 * 60; // 5 minutes in seconds
const CACHE_KEY_PREFIX = 'perm:'; // Redis key prefix: perm:{userId}:{orgId}

/**
 * Resolve all permissions for a user in a given organization.
 *
 * Returns an array of permission keys (e.g., ['properties:view', 'tenants:create']).
 * On any error (DB failure, Redis failure), returns an empty array — never throws.
 */
export async function resolvePermissions(
  userId: string,
  orgId: string
): Promise<string[]> {
  try {
    // -----------------------------------------------------------------------
    // Step 1: Check Redis cache
    // -----------------------------------------------------------------------
    const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;
    const cached = await redisGet(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as string[];
      } catch {
        // Corrupted cache entry — fall through to DB
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Cache miss — fetch from database
    // Member.role is a string (not FK to Role), so we query by name match.
    // -----------------------------------------------------------------------
    const member = await prisma.member.findFirst({
      where: { userId, orgId },
      select: { role: true },
    });

    if (!member) {
      return [];
    }

    const roles = await prisma.role.findMany({
      where: {
        organizationId: orgId,
        name: member.role, // Match the string role from Member
      },
      select: {
        permissions: {
          select: {
            permission: {
              select: {
                key: true,
              },
            },
          },
        },
      },
    });

    // Flatten to unique permission keys
    const permissions: string[] = Array.from(
      new Set(
        roles.flatMap((role) =>
          role.permissions.map((rp) => rp.permission.key)
        )
      )
    );

    // -----------------------------------------------------------------------
    // Step 3: Store in Redis with TTL
    // -----------------------------------------------------------------------
    await redisSet(cacheKey, JSON.stringify(permissions), PERMISSION_CACHE_TTL);

    return permissions;
  } catch {
    // CRITICAL: Never throw — permission resolution failures must not
    // invalidate valid sessions. Return empty array as safe default.
    return [];
  }
}

/**
 * Invalidate the Redis cache for a user in an organization.
 * Call this when roles or permissions are updated.
 */
export async function invalidatePermissionCache(userId: string, orgId: string): Promise<void> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;
  await redisDel(cacheKey);
}

/**
 * Invalidate all permission caches for a user across all organizations.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  // We can't easily scan for all keys without knowing orgIds, so we use a pattern.
  // In production with high traffic, consider using Redis keyspace notifications
  // or a distributed cache invalidation strategy.
  if (!redis) return;
  try {
    const pattern = `${CACHE_KEY_PREFIX}${userId}:*`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const keys: string[] = await (redis as any).keys(pattern);
    if (keys.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (redis as any).del(...keys);
    }
  } catch {
    // Silently fail
  }
}

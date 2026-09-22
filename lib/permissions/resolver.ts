import tenantDb from '@/lib/tenant-db';
// RLS Phase 3: this is the SHARED permission-resolution read (Member →
// MemberRole → Role → RolePermission → Permission, all RLS-scoped). It runs on
// a fresh connection with NO bound GUCs unless wrapped here — unscoped it fails
// closed to zero permissions for everyone. The verified target-org context
// (flag=1) exposes the catalog read; the orgId is the very org permissions are
// being resolved against, so app-layer extension scoping agrees with it.
import { withTenantAdminContext } from '@/lib/platform-db';

const CACHE_KEY_PREFIX = 'perm:';

/**
 * Resolve all permissions for a user in a given organization.
 * Uses L1 (in-memory) + L2 (Redis) caching with fallback to database.
 *
 * Read path: L1 → Redis → DB (with write-through on miss)
 * Stampede protection ensures only one DB query per unique key, even
 * when multiple callers miss simultaneously.
 */
export async function resolvePermissions(
  userId: string,
  orgId: string
): Promise<string[]> {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;

    // Use hybrid cache layer (L1 → L2 → resolver)
    const { cacheGet } = await import('../cache/hybrid');

    const cached = await cacheGet<string[]>(
      cacheKey,
      // Resolver: fetch from database on cache miss — under the verified
      // target-org context (see module header) for RLS visibility.
      () => withTenantAdminContext(userId, orgId, async () => {
        const memberWithRoles = await tenantDb.member.findFirst({
          where: { userId, orgId },
          select: {
            memberRoles: {
              select: {
                role: {
                  select: {
                    permissions: {
                      select: {
                        permission: { select: { key: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (!memberWithRoles?.memberRoles) {
          return [];
        }

        // Flatten: MemberRole[] → Role[] → RolePermission[] → Permission.key
        const permissions: string[] = memberWithRoles.memberRoles.flatMap(
          (mr) => mr.role.permissions.map((rp) => rp.permission.key)
        );

        return Array.from(new Set(permissions));
      }),
      { ttlType: 'volatile' } // Permissions can change with role updates
    );

    return cached ?? [];
  } catch (error) {
    // Log error for debugging
    console.error('Permission resolution error:', error);
    return [];
  }
}

/**
 * Invalidate the cache for a user in an organization.
 * Deletes from both L1 and L2, then publishes invalidation event via Pub/Sub.
 */
export async function invalidatePermissionCache(userId: string, orgId: string): Promise<void> {
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;
  const { cacheDel } = await import('../cache/hybrid');
  await cacheDel(cacheKey);
}

/**
 * Invalidate all permission caches for a user across all organizations.
 * Uses SCAN instead of KEYS to avoid blocking Redis in production.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  const { getRedis } = await import('../redis');
  const redis = getRedis();
  if (!redis) return;

  try {
    const pattern = `${CACHE_KEY_PREFIX}${userId}:*`;
    let cursor = '0';
    const keysToDelete: string[] = [];

    do {
      // Use SCAN instead of KEYS to avoid blocking Redis event loop.
      // SCAN returns results incrementally, allowing Redis to handle
      // other requests between iterations (O(1) per call vs O(N) for KEYS).
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = String(result[0]);
      const matchedKeys = result[1];

      if (matchedKeys.length > 0) {
        keysToDelete.push(...matchedKeys);

        // Delete in batches to avoid memory issues with large key sets
        if (keysToDelete.length >= 100) {
          await redis.del(...keysToDelete.splice(0, 100));
        }
      }
    } while (cursor !== '0');

    // Delete any remaining keys
    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }

    // Also evict from L1 cache on this instance
    const { invalidate } = await import('../cache/lru');
    for (const key of keysToDelete) {
      invalidate(key);
    }
  } catch (error) {
    console.error('[PermissionCache] Failed to invalidate user cache:', error, { userId });
  }
}

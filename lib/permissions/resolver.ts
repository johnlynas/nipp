import tenantDb from '@/lib/tenant-db';

const PERMISSION_CACHE_TTL = 5 * 60; // 5 minutes
const CACHE_KEY_PREFIX = 'perm:';

/**
 * Resolve all permissions for a user in a given organization.
 * Uses Redis caching with fallback to database.
 */
export async function resolvePermissions(
  userId: string,
  orgId: string
): Promise<string[]> {
  try {
    // Lazy-load Redis helpers to avoid Edge Runtime issues
    const { redisGet, redisSet } = await import('../redis');
    
    const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;
    const cached = await redisGet(cacheKey);

    if (cached) {
      try {
        return JSON.parse(cached) as string[];
      } catch {
        // Corrupted cache — fall through to DB
      }
    }

    // Fetch from database with optimized single query approach
    const memberWithRole = await tenantDb.member.findFirst({
      where: { userId, orgId },
      select: {
        role: {
          select: { 
            permissions: { 
              select: { permission: { select: { key: true } } }
            }
          }
        }
      }
    });

    if (!memberWithRole?.role) {
      return [];
    }

    // Debug: Log what we got back for troubleshooting
    const permissions = memberWithRole.role.permissions.map(
      (rp) => rp.permission.key
    );

    const uniquePermissions = Array.from(new Set(permissions));
    
    await redisSet(cacheKey, JSON.stringify(uniquePermissions), PERMISSION_CACHE_TTL);

    return uniquePermissions;
  } catch (error) {
    // Log error for debugging
    console.error('Permission resolution error:', error);
    return [];
  }
}

/**
 * Invalidate the Redis cache for a user in an organization.
 */
export async function invalidatePermissionCache(userId: string, orgId: string): Promise<void> {
  const { redisDel } = await import('../redis');
  const cacheKey = `${CACHE_KEY_PREFIX}${userId}:${orgId}`;
  await redisDel(cacheKey);
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
  } catch (error) {
    console.error('[PermissionCache] Failed to invalidate user cache:', error, { userId });
  }
}
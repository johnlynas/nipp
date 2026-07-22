import prisma from '@/lib/db';

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
    const memberWithRole = await prisma.member.findFirst({
      where: { userId, orgId },
      include: {
        role: {
          include: { 
            permissions: { 
              include: { permission: true } 
            }
          }
        }
      }
    });

    if (!memberWithRole || !memberWithRole.role) {
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
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  const { getRedis } = await import('../redis');
  const redis = getRedis();
  if (!redis) return;
  
  try {
    const pattern = `${CACHE_KEY_PREFIX}${userId}:*`;
    const keys: string[] = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Silently fail
  }
}
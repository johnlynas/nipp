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

    // Fetch from database
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
        name: member.role,
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

    const permissions: string[] = Array.from(
      new Set(
        roles.flatMap((role) =>
          role.permissions.map((rp) => rp.permission.key)
        )
      )
    );

    await redisSet(cacheKey, JSON.stringify(permissions), PERMISSION_CACHE_TTL);

    return permissions;
  } catch {
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
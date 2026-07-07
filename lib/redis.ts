/**
 * Redis client singleton for permission caching.
 *
 * Provides a connection to Redis with graceful degradation — if the
 * REDIS_URL environment variable is not set or the connection fails,
 * all operations become no-ops (permissions are still fetched from DB).
 *
 * ioredis is loaded dynamically to avoid webpack bundling issues.
 * Next.js webpack cannot handle node: scheme imports that ioredis uses.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _redis: any = null;

/** @deprecated Use `getRedis()` instead. Kept for backward compatibility with resolver.ts. */
export let redis: any = null;

interface RedisGlobal {
  redis?: unknown;
}

const globalForRedis = globalThis as unknown as RedisGlobal;

/**
 * Get the Redis client instance. Returns null if Redis is unavailable.
 */
export function getRedis(): unknown {
  return globalForRedis.redis ?? null;
}

const redisUrl = process.env.REDIS_URL;

if (redisUrl) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis');

    if (!globalForRedis.redis) {
      globalForRedis.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        retryStrategy(times) {
          if (times > 3) {
            // eslint-disable-next-line no-console
            console.warn(`[Redis] Connection failed after ${times} retries. Permission caching disabled.`);
            return null;
          }
          return Math.min(times * 200, 1000);
        },
      });

      globalForRedis.redis.on('error', (err: Error) => {
        // eslint-disable-next-line no-console
        console.warn('[Redis] Connection error:', err.message);
      });

      globalForRedis.redis.connect().catch(() => {
        // Connection failed — operations will be no-ops
      });
    }
    _redis = globalForRedis.redis;
    redis = _redis;
  } catch {
    // ioredis not available — all operations are no-ops
    _redis = null;
  }
}

/**
 * Get a value from Redis. Returns null if Redis is unavailable or the key doesn't exist.
 */
export async function redisGet(key: string): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (client as any).get(key);
  } catch {
    return null;
  }
}

/**
 * Set a value in Redis with an optional TTL (in seconds).
 */
export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (ttlSeconds) {
      await (client as any).setex(key, ttlSeconds, value);
    } else {
      await (client as any).set(key, value);
    }
  } catch {
    // Silently fail — permission resolution falls back to DB
  }
}

/**
 * Delete a key from Redis.
 */
export async function redisDel(key: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (client as any).del(key);
  } catch {
    // Silently fail
  }
}

/**
 * Close the Redis connection gracefully. Called on process shutdown.
 */
export async function redisClose(): Promise<void> {
  const client = getRedis();
  if (client) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any).quit();
    } catch {
      // Ignore on shutdown
    }
  }
}

import { Redis } from 'ioredis';

let redisInstance: Redis | null = null;

/**
 * Returns the Redis client instance.
 * Returns null if REDIS_URL is not configured.
 */
export function getRedis(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!redisInstance) {
    redisInstance = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 200, 2000);
      },
    });

    redisInstance.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });
  }

  return redisInstance;
}

// --- Helper Functions ---

export async function redisGet(key: string): Promise<string | null> {
  const client = getRedis();
  if (!client) return null;
  return client.get(key);
}

export async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const client = getRedis();
  if (!client) return;
  await client.set(key, value, 'EX', ttlSeconds);
}

export async function redisDel(key: string): Promise<void> {
  const client = getRedis();
  if (!client) return;
  await client.del(key);
}
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
        if (times > 5) return null; // Stop retrying after 5 attempts
        const delay = Math.min(times * 100, 2000);
        return delay;
      },
      reconnectOnError(err) {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return 1; // Only retry on READONLY errors
        }
        return false;
      },
      lazyConnect: true, // Don't connect immediately, wait for first command
    });

    redisInstance.on('error', (err) => {
      console.error('[Redis] Connection error:', err.message);
    });

    redisInstance.on('connect', () => {
      console.log('[Redis] Connected successfully');
    });

    redisInstance.on('reconnecting', (delay) => {
      console.log(`[Redis] Reconnecting in ${delay}ms...`);
    });

    redisInstance.on('ready', () => {
      console.log('[Redis] Ready to accept commands');
    });
  }

  return redisInstance;
}

/**
 * Force reconnects the Redis client.
 * Useful for health checks to ensure fresh connection state.
 */
export async function forceRedisReconnect(): Promise<void> {
  if (!redisInstance) return;

  try {
    // Check if client is in a bad state and force reconnect
    if (redisInstance.status === 'close' || redisInstance.status === 'end') {
      await redisInstance.connect();
    }
  } catch (error) {
    console.error('[Redis] Force reconnect failed:', error);
  }
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
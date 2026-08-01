import { Redis } from 'ioredis';
import { env } from '@/lib/env';

let redisInstance: Redis | null = null;
let lastKnownState: 'connected' | 'disconnected' | null = null;

/**
 * Returns the Redis client instance.
 * Returns null if REDIS_URL is not configured.
 */
export function getRedis(): Redis | null {
  if (!env.REDIS_URL) {
    return null;
  }

  if (!redisInstance) {
    redisInstance = new Redis(env.REDIS_URL, {
      retryStrategy: (times) => {
        if (times > 10) {
          return null;
        }
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
    });

    // Only log on state changes
    redisInstance.on('connect', () => {
      if (lastKnownState !== 'connected') {
        console.log('[Redis] Connected');
        lastKnownState = 'connected';
      }
    });

    redisInstance.on('ready', () => {
      if (lastKnownState !== 'connected') {
        console.log('[Redis] Ready');
        lastKnownState = 'connected';

        // Start Pub/Sub subscriber for cross-instance cache invalidation
        startInvalidationSubscriber();
      }
    });

    redisInstance.on('error', (err) => {
      if (lastKnownState !== 'disconnected') {
        console.error('[Redis] Connection error:', err.message);
        lastKnownState = 'disconnected';
      }
    });

    redisInstance.on('end', () => {
      if (lastKnownState !== 'disconnected') {
        console.log('[Redis] Connection closed');
        lastKnownState = 'disconnected';
      }
    });
  }

  return redisInstance;
}

/**
 * Start the Pub/Sub subscriber for cross-instance cache invalidation.
 * Listens on 'cache:invalidations' channel and evicts keys from L1 cache.
 */
function startInvalidationSubscriber(): void {
  if (!redisInstance) return;

  const subscriber = redisInstance.duplicate();

  subscriber.on('message', async (_channel, message) => {
    try {
      const { key } = JSON.parse(message);
      if (key) {
        // Evict the key from L1 cache on this instance
        const { invalidate } = await import('./cache/lru');
        invalidate(key);
      }
    } catch {
      // Malformed message — ignore silently
    }
  });

  subscriber.on('error', (err) => {
    console.error('[Redis] Pub/Sub subscriber error:', err.message);
  });

  // Subscribe to the invalidation channel
  subscriber.subscribe('cache:invalidations', (err) => {
    if (err) {
      console.error('[Redis] Failed to subscribe to cache:invalidations:', err.message);
    } else {
      console.log('[Redis] Subscribed to cache:invalidations channel');
    }
  });
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

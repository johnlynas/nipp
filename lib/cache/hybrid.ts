/**
 * Hybrid Cache Layer — L1 (in-memory) + L2 (Redis) Orchestration
 *
 * Provides a unified cache interface that checks L1 first, falls back to
 * Redis (L2), then calls a resolver function. Write-through ensures both
 * layers stay in sync. Stampede protection deduplicates concurrent misses.
 */

import { getLruCache, recordL1Hit, recordL1Miss } from './lru';
import { getOrSet } from './stampede';
import { redisGet, redisSet, redisDel } from '../redis';
import { recordL2Hit, recordL2Miss } from './health';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_TTL_SECONDS = 300; // 5 minutes for Redis (L2)

/**
 * Adaptive TTL configuration by data type.
 * - 'permanent': No TTL (entries only evicted on explicit delete)
 * - 'stable': Long TTL for data that changes infrequently
 * - 'volatile': Short TTL for data that changes frequently
 */
export const ADAPTIVE_TTLS = {
  permanent: Infinity, // No TTL — entries only evicted on explicit delete
  stable: 3600,        // 1 hour — for orgs, users, roles
  volatile: 300,       // 5 minutes — for permissions (can change with role updates)
  search: 30,          // 30 seconds — for search results (relatively stable)
} as const;

export type AdaptiveTTLType = keyof typeof ADAPTIVE_TTLS;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheOptions {
  /** Time-to-live in seconds for Redis (L2) cache. Default: 300 */
  ttlSeconds?: number;
  /** Adaptive TTL type for automatic TTL selection. Overrides ttlSeconds if set. */
  ttlType?: AdaptiveTTLType;
}

// ---------------------------------------------------------------------------
// Read Path: L1 → L2 → Resolver
// ---------------------------------------------------------------------------

/**
 * Get a cached value, checking L1 first, then L2 (Redis), then calling the
 * resolver function on a miss. Results are written through to both layers.
 *
 * Stampede protection ensures only one resolver invocation per unique key,
 * even when multiple callers miss simultaneously.
 *
 * @param key - The cache key
 * @param resolver - Function that resolves the value on a cache miss
 * @param options - Optional TTL configuration
 * @returns The cached or resolved value, or null if resolution fails
 */
export async function cacheGet<T>(
  key: string,
  resolver: () => Promise<T>,
  options?: CacheOptions,
): Promise<T | null> {
  // Determine TTL: explicit ttlSeconds > ttlType > default
  const ttlSeconds = options?.ttlSeconds ?? (options?.ttlType ? ADAPTIVE_TTLS[options.ttlType] : DEFAULT_TTL_SECONDS);

  // 1. Check L1 (in-memory)
  const lru = getLruCache();
  if (lru?.has(key)) {
    const cached = lru.get(key);
    if (cached !== undefined) {
      recordL1Hit();
      return JSON.parse(cached) as T;
    }
  }

  // L1 miss
  recordL1Miss();

  // 2. Check L2 (Redis) — with stampede protection
  const result = await getOrSet(key, async () => {
    // Check Redis first (within the deduplicated promise)
    const redisVal = await redisGet(key);
    if (redisVal !== null && lru) {
      try {
        const parsed = JSON.parse(redisVal) as T;
        // Populate L1 on L2 hit
        lru.set(key, redisVal);
        recordL2Hit();
        return parsed;
      } catch {
        // Corrupted Redis value — fall through to resolver (do NOT record miss)
      }
    } else {
      // Redis had no value — this is an L2 miss
      recordL2Miss();
    }

    // 3. L2 miss — call the resolver (DB query, etc.)
    const resolved = await resolver();

    // 4. Write-through to both layers
    if (resolved !== null && resolved !== undefined) {
      const serialized = JSON.stringify(resolved);

      // Write to Redis (L2) first — source of truth
      await redisSet(key, serialized, ttlSeconds);

      // Write to L1 (in-memory)
      if (lru) {
        lru.set(key, serialized);
      }

      // Publish invalidation event for cross-instance sync
      await publishInvalidation(key);
    }

    return resolved;
  });

  return result as T | null;
}

// ---------------------------------------------------------------------------
// Write Path: Write-Through to Both Layers
// ---------------------------------------------------------------------------

/**
 * Set a value in both L1 and L2 caches (write-through).
 * Redis is written first as the source of truth.
 *
 * @param key - The cache key
 * @param value - The value to cache (will be JSON-serialized)
 * @param options - Optional TTL configuration
 */
export async function cacheSet<T>(
  key: string,
  value: T,
  options?: CacheOptions,
): Promise<void> {
  // Determine TTL: explicit ttlSeconds > ttlType > default
  const ttlSeconds = options?.ttlSeconds ?? (options?.ttlType ? ADAPTIVE_TTLS[options.ttlType] : DEFAULT_TTL_SECONDS);
  const serialized = JSON.stringify(value);

  // Write to Redis (L2) first — source of truth
  await redisSet(key, serialized, ttlSeconds);

  // Write to L1 (in-memory)
  const lru = getLruCache();
  if (lru) {
    lru.set(key, serialized);
  }

  // Publish invalidation event for cross-instance sync
  await publishInvalidation(key);
}

// ---------------------------------------------------------------------------
// Delete Path: Remove from Both Layers + Pub/Sub
// ---------------------------------------------------------------------------

/**
 * Delete a key from both L1 and L2 caches, then publish an invalidation
 * event so other instances can evict the key from their L1 caches.
 *
 * @param key - The cache key to delete
 */
export async function cacheDel(key: string): Promise<void> {
  // Delete from L1 (in-memory)
  const lru = getLruCache();
  if (lru) {
    lru.delete(key);
  }

  // Delete from L2 (Redis)
  await redisDel(key);

  // Publish invalidation event for cross-instance sync
  await publishInvalidation(key);
}

// ---------------------------------------------------------------------------
// Pub/Sub Invalidation (Cross-Instance Sync)
// ---------------------------------------------------------------------------

const INVALIDATION_CHANNEL = 'cache:invalidations';

/**
 * Publish an invalidation event to Redis Pub/Sub.
 * All instances subscribe to this channel and evict the key from their L1 cache.
 */
async function publishInvalidation(key: string): Promise<void> {
  const { getRedis } = await import('../redis');
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.publish(
      INVALIDATION_CHANNEL,
      JSON.stringify({ key }),
    );
  } catch {
    // Pub/Sub failure is non-critical — cache will eventually expire via TTL
  }
}

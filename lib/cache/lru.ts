/**
 * L1 In-Memory LRU Cache Singleton
 *
 * Provides a high-performance in-memory cache for frequently accessed data.
 * Only active on Node.js runtime (disabled on Edge where state is per-request).
 *
 * Configuration:
 * - L1_CACHE_MAX_ENTRIES: max cache entries (default 1000)
 * - L1_CACHE_TTL_MS: max TTL in milliseconds (default 60000)
 * - ENABLE_L1_CACHE: feature flag to disable entirely (default true)
 */

import { LRUCache } from 'lru-cache';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ENTRIES = parseInt(process.env.L1_CACHE_MAX_ENTRIES ?? '1000', 10);
const TTL_MS = parseInt(process.env.L1_CACHE_TTL_MS ?? '60000', 10);
const ENABLED = process.env.ENABLE_L1_CACHE !== 'false';

// ---------------------------------------------------------------------------
// Runtime Detection
// ---------------------------------------------------------------------------

const isEdge = process.env.NEXT_RUNTIME === 'edge';

/**
 * LRU cache instance — null on Edge runtime or when disabled via feature flag.
 */
export const lruCache: LRUCache<string, string> | null =
  ENABLED && !isEdge
    ? new LRUCache<string, string>({
        max: MAX_ENTRIES,
        ttl: TTL_MS,
        ttlResolution: 1000, // Check TTL every second
        allowStale: false,
        sizeCalculation: (value) => Buffer.byteLength(value),
        maxEntrySize: 10_000, // Reject entries > 10KB
        noDeleteOnFetchRejection: true,
      })
    : null;

// ---------------------------------------------------------------------------
// Metrics Counters (module-level, updated by hybrid layer)
// ---------------------------------------------------------------------------

let l1Hits = 0;
let l1Misses = 0;

/**
 * Increment L1 hit counter. Called by hybrid layer on cache hits.
 */
export function recordL1Hit(): void {
  l1Hits++;
}

/**
 * Increment L1 miss counter. Called by hybrid layer on cache misses.
 */
export function recordL1Miss(): void {
  l1Misses++;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the LRU cache singleton. Returns null on Edge runtime or when disabled.
 */
export function getLruCache(): LRUCache<string, string> | null {
  return lruCache;
}

/**
 * Invalidate a single key from the L1 cache.
 */
export function invalidate(key: string): void {
  lruCache?.delete(key);
}

/**
 * Clear all entries from the L1 cache.
 */
export function clear(): void {
  lruCache?.clear();
}

/**
 * Get cache metrics for monitoring.
 */
export function getMetrics(): {
  l1Hits: number;
  l1Misses: number;
  l1Size: number;
  // Note: lru-cache doesn't expose totalByteSize directly
  l1MemoryBytes: number;
  l1HitRate: number;
} {
  const total = l1Hits + l1Misses;
  return {
    l1Hits,
    l1Misses,
    l1Size: lruCache?.size ?? 0,
    // Note: lru-cache doesn't expose totalByteSize directly
    l1MemoryBytes: 0,
    l1HitRate: total > 0 ? (l1Hits / total) * 100 : 0,
  };
}

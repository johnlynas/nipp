/**
 * L1 In-Memory LRU Cache Singleton
 *
 * Provides a high-performance in-memory cache for frequently accessed data.
 * Only active on Node.js runtime (disabled on Edge where state is per-request).
 *
 * Uses globalThis to ensure a single instance across all Next.js route bundles.
 *
 * Configuration:
 * - L1_CACHE_MAX_ENTRIES: max cache entries (default 1000)
 * - L1_CACHE_TTL_MS: max TTL in milliseconds (default 60000)
 * - ENABLE_L1_CACHE: feature flag to disable entirely (default true)
 */

import { LRUCache } from 'lru-cache';
import { incL1Hit, incL1Miss, getL1Counters } from './metrics';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_ENTRIES = parseInt(process.env.L1_CACHE_MAX_ENTRIES ?? '1000', 10);
const TTL_MS = parseInt(process.env.L1_CACHE_TTL_MS ?? '60000', 10);
const ENABLED = process.env.ENABLE_L1_CACHE !== 'false';

// ---------------------------------------------------------------------------
// Runtime Detection
// ---------------------------------------------------------------------------

// Singleton stored on globalThis — guaranteed single instance across all bundles.
// Initialized lazily at call time so that Next.js 15 dev mode (which runs
// instrumentation on both Edge and Node runtimes) doesn't lock the cache to null.
let lruCacheInstance: LRUCache<string, string> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the LRU cache singleton. Returns null on Edge runtime or when disabled.
 */
export function getLruCache(): LRUCache<string, string> | null {
  if (lruCacheInstance !== null) return lruCacheInstance;

  // Lazy init — re-check runtime at call time so Edge-first loads don't block Node.js
  if (!ENABLED || process.env.NEXT_RUNTIME === 'edge') {
    lruCacheInstance = null;
    return null;
  }

  // Double-check globalThis in case another bundle already initialized it
  const existing = (globalThis as unknown as { __lruCache?: LRUCache<string, string> }).__lruCache;
  if (existing) {
    lruCacheInstance = existing;
    return existing;
  }

  lruCacheInstance = ((globalThis as unknown as { __lruCache: LRUCache<string, string> }).__lruCache =
    new LRUCache<string, string>({
      max: MAX_ENTRIES,
      ttl: TTL_MS,
      ttlResolution: 1000,
      allowStale: false,
      sizeCalculation: (value) => Buffer.byteLength(value),
      maxEntrySize: 10_000,
      noDeleteOnFetchRejection: true,
    }));

  return lruCacheInstance;
}

/**
 * Increment L1 hit counter. Called by hybrid layer on cache hits.
 */
export function recordL1Hit(): void {
  incL1Hit();
}

/**
 * Increment L1 miss counter. Called by hybrid layer on cache misses.
 */
export function recordL1Miss(): void {
  incL1Miss();
}

/**
 * Invalidate a single key from the L1 cache.
 */
export function invalidate(key: string): void {
  lruCacheInstance?.delete(key);
}

/**
 * Clear all entries from the L1 cache.
 */
export function clear(): void {
  lruCacheInstance?.clear();
}

/**
 * Get cache metrics for monitoring.
 */
export function getMetrics(): {
  l1Hits: number;
  l1Misses: number;
  l1Size: number;
  /**
   * Approximate memory usage. lru-cache v12 does not expose totalByteSize
   * publicly, so we estimate from entry count × average size.
   */
  l1MemoryBytes: number;
  l1HitRate: number;
} {
  const counters = getL1Counters();
  const total = counters.l1Hits + counters.l1Misses;
  const size = lruCacheInstance?.size ?? 0;
  // Estimate: each entry is a JSON string ~200 bytes average (key + value overhead)
  const estimatedBytes = size * 200;
  return {
    l1Hits: counters.l1Hits,
    l1Misses: counters.l1Misses,
    l1Size: size,
    l1MemoryBytes: estimatedBytes,
    l1HitRate: total > 0 ? (counters.l1Hits / total) * 100 : 0,
  };
}

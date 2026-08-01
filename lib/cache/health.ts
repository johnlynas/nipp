/**
 * Cache Health and Metrics Reporting
 *
 * Exposes cache performance metrics for monitoring dashboards and health
 * endpoints. Tracks hit/miss ratios, entry counts, memory usage, and
 * Redis connection state.
 */

import { getMetrics as getLruMetrics } from './lru';
import { getRedis } from '../redis';
import { incL2Hit, incL2Miss, getL2Counters, resetL2Counters } from './metrics';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheMetrics {
  /** Number of L1 cache hits */
  l1Hits: number;
  /** Number of L1 cache misses */
  l1Misses: number;
  /** Number of L2 (Redis) cache hits */
  l2Hits: number;
  /** Number of L2 (Redis) cache misses */
  l2Misses: number;
  /** Current number of entries in L1 cache */
  l1Size: number;
  /** Approximate memory usage of L1 cache in bytes */
  l1MemoryBytes: number;
  /** L1 hit rate as a percentage (0–100) */
  l1HitRate: number;
  /** Redis connection state */
  redisConnected: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Increment L2 (Redis) hit counter. Called by hybrid layer on Redis hits.
 */
export function recordL2Hit(): void {
  incL2Hit();
}

/**
 * Increment L2 (Redis) miss counter. Called by hybrid layer on Redis misses.
 */
export function recordL2Miss(): void {
  incL2Miss();
}

/**
 * Get comprehensive cache metrics for monitoring.
 */
export function getCacheMetrics(): CacheMetrics {
  const lru = getLruMetrics();
  const redis = getRedis();
  const l2Counters = getL2Counters();

  return {
    l1Hits: lru.l1Hits,
    l1Misses: lru.l1Misses,
    l2Hits: l2Counters.hits,
    l2Misses: l2Counters.misses,
    l1Size: lru.l1Size,
    l1MemoryBytes: lru.l1MemoryBytes,
    l1HitRate: lru.l1HitRate,
    redisConnected: !!redis && !['error', 'close', 'end'].includes(redis.status),
  };
}

/**
 * Reset all metrics counters (useful for testing or periodic resets).
 */
export function resetMetrics(): void {
  resetL2Counters();
}

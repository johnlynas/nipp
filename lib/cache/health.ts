/**
 * Cache Health and Metrics Reporting
 *
 * Exposes cache performance metrics for monitoring dashboards and health
 * endpoints. Tracks hit/miss ratios, entry counts, memory usage, and
 * Redis connection state.
 */

import { getMetrics as getLruMetrics } from './lru';
import { getRedis } from '../redis';

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
// Metrics Counters (module-level, updated by hybrid layer)
// ---------------------------------------------------------------------------

let l2Hits = 0;
let l2Misses = 0;

/**
 * Increment L2 (Redis) hit counter. Called by hybrid layer on Redis hits.
 */
export function recordL2Hit(): void {
  l2Hits++;
}

/**
 * Increment L2 (Redis) miss counter. Called by hybrid layer on Redis misses.
 */
export function recordL2Miss(): void {
  l2Misses++;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get comprehensive cache metrics for monitoring.
 */
export function getCacheMetrics(): CacheMetrics {
  const lru = getLruMetrics();
  const redis = getRedis();

  return {
    l1Hits: lru.l1Hits,
    l1Misses: lru.l1Misses,
    l2Hits,
    l2Misses,
    l1Size: lru.l1Size,
    l1MemoryBytes: lru.l1MemoryBytes,
    l1HitRate: lru.l1HitRate,
    redisConnected: redis?.status === 'ready' || redis?.status === 'connect',
  };
}

/**
 * Reset all metrics counters (useful for testing or periodic resets).
 */
export function resetMetrics(): void {
  l2Hits = 0;
  l2Misses = 0;
}

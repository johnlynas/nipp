/**
 * Shared Cache Metrics Singleton
 * 
 * Provides a single source of truth for L1/L2 cache counters.
 * Uses globalThis to ensure there's only one instance across all
 * Next.js route handler bundles.
 */

interface CacheMetricsState {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
}

// Singleton stored on globalThis — guaranteed single instance across all bundles
const state = (globalThis as unknown as { __cacheMetrics?: CacheMetricsState }).__cacheMetrics
  ?? ((globalThis as unknown as { __cacheMetrics: CacheMetricsState }).__cacheMetrics = {
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
  });

export function incL1Hit(): void { state.l1Hits++; }
export function incL1Miss(): void { state.l1Misses++; }

export function getL1Counters(): { l1Hits: number; l1Misses: number } {
  return { l1Hits: state.l1Hits, l1Misses: state.l1Misses };
}

export function resetL1Counters(): void {
  state.l1Hits = 0;
  state.l1Misses = 0;
}

export function incL2Hit(): void { state.l2Hits++; }
export function incL2Miss(): void { state.l2Misses++; }

export function getL2Counters(): { hits: number; misses: number } {
  return { hits: state.l2Hits, misses: state.l2Misses };
}

export function resetL2Counters(): void {
  state.l2Hits = 0;
  state.l2Misses = 0;
}

export function resetAllCounters(): void {
  state.l1Hits = 0;
  state.l1Misses = 0;
  state.l2Hits = 0;
  state.l2Misses = 0;
}

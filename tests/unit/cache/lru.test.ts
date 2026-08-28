/**
 * Unit tests for L1 In-Memory LRU Cache singleton (lib/cache/lru.ts)
 *
 * The module reads env config at import time and lazily builds the singleton
 * on globalThis, so each scenario loads a FRESH module instance with stubbed
 * env (vi.resetModules + dynamic import) after wiping globalThis.__lruCache.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LRUCache } from 'lru-cache';
import { resetL1Counters } from '@/lib/cache/metrics';

type LruModule = typeof import('@/lib/cache/lru');

const globalHolder = globalThis as unknown as Record<string, unknown>;

/**
 * Load a freshly-reset copy of lib/cache/lru with the given env overrides,
 * ensuring no leftover singleton survives from a previous scenario.
 */
async function loadFreshLruModule(env: Record<string, string> = {}): Promise<LruModule> {
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_RUNTIME', 'node'); // explicit non-Edge default for every scenario
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  delete globalHolder.__lruCache;
  vi.resetModules();
  return import('@/lib/cache/lru');
}

beforeEach(() => {
  vi.unstubAllEnvs();
  delete globalHolder.__lruCache;
  resetL1Counters();
});

describe('getLruCache — singleton lifecycle', () => {
  it('lazily creates an instance honoring L1_CACHE_MAX_ENTRIES and L1_CACHE_TTL_MS', async () => {
    const lru = await loadFreshLruModule({
      L1_CACHE_MAX_ENTRIES: '5',
      L1_CACHE_TTL_MS: '123456',
    });

    const cache = lru.getLruCache();

    expect(cache).not.toBeNull();
    expect(cache!.max).toBe(5);
    expect(cache!.ttl).toBe(123456);
  });

  it('stores the same instance on globalThis so other bundles share it', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache();

    expect(globalHolder.__lruCache).toBe(cache);
  });

  it('returns the identical instance on repeated calls (entries persist across calls)', async () => {
    const lru = await loadFreshLruModule();

    const first = lru.getLruCache();
    first!.set('k', 'v');

    const second = lru.getLruCache();

    expect(second).toBe(first);
    expect(second!.get('k')).toBe('v');
  });

  it('adopts an already-initialized globalThis instance instead of creating a new one', async () => {
    const lru = await loadFreshLruModule();

    // Simulate another bundle having initialized the cache before this
    // bundle's first getLruCache() call (lru.ts checks globalThis lazily)
    const seeded = new LRUCache<string, string>({ max: 3 });
    seeded.set('pre-existing', 'true');
    globalHolder.__lruCache = seeded;

    const cache = lru.getLruCache();

    expect(cache).toBe(seeded);
    expect(cache!.get('pre-existing')).toBe('true');
  });

  it('returns null on Edge runtime and stays null without touching globalThis', async () => {
    const lru = await loadFreshLruModule({ NEXT_RUNTIME: 'edge' });

    expect(lru.getLruCache()).toBeNull();
    expect(lru.getLruCache()).toBeNull(); // cached null — no accidental later init
    expect(globalHolder.__lruCache).toBeUndefined();
  });

  it('returns null when disabled via ENABLE_L1_CACHE=false', async () => {
    const lru = await loadFreshLruModule({ ENABLE_L1_CACHE: 'false' });

    expect(lru.getLruCache()).toBeNull();
    expect(globalHolder.__lruCache).toBeUndefined();
  });
});

describe('invalidate / clear', () => {
  it('invalidate removes only the specified key', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache()!;

    cache.set('a', '1');
    cache.set('b', '2');

    lru.invalidate('a');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
  });

  it('invalidate is a safe no-op when the cache has not been initialized', async () => {
    const lru = await loadFreshLruModule();

    expect(() => lru.invalidate('never-created')).not.toThrow();
  });

  it('clear removes every entry from the cache', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache()!;

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    lru.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('clear is a safe no-op when the cache has not been initialized', async () => {
    const lru = await loadFreshLruModule();

    expect(() => lru.clear()).not.toThrow();
  });
});

describe('metrics (recordL1Hit / recordL1Miss / getMetrics)', () => {
  it('starts at a 0% hit rate when no hits or misses have been recorded', async () => {
    const lru = await loadFreshLruModule();

    const metrics = lru.getMetrics();

    expect(metrics.l1Hits).toBe(0);
    expect(metrics.l1Misses).toBe(0);
    expect(metrics.l1HitRate).toBe(0);
  });

  it('counters increment and hit rate reflects the recorded ratio', async () => {
    const lru = await loadFreshLruModule();

    lru.recordL1Hit();
    lru.recordL1Hit();
    lru.recordL1Miss();
    lru.recordL1Miss();

    const metrics = lru.getMetrics();

    expect(metrics.l1Hits).toBe(2);
    expect(metrics.l1Misses).toBe(2);
    expect(metrics.l1HitRate).toBeCloseTo(50, 5);
  });

  it('l1Size and memory estimate track the number of cached entries', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache()!;

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    const metrics = lru.getMetrics();

    expect(metrics.l1Size).toBe(3);
    // Estimate formula: 200 bytes per entry
    expect(metrics.l1MemoryBytes).toBe(600);
  });

  it('reports zero size and memory when the cache is disabled (e.g. Edge)', async () => {
    const lru = await loadFreshLruModule({ NEXT_RUNTIME: 'edge' });
    lru.recordL1Miss();

    const metrics = lru.getMetrics();

    expect(metrics.l1Size).toBe(0);
    expect(metrics.l1MemoryBytes).toBe(0);
    expect(metrics.l1HitRate).toBe(0); // 0 hits / 1 miss
  });
});

describe('entry limits through the singleton', () => {
  it('refuses entries larger than the 10KB maxEntrySize', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache()!;

    cache.set('oversized', 'x'.repeat(10_001));

    expect(cache.get('oversized')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('still accepts entries exactly at the 10KB limit', async () => {
    const lru = await loadFreshLruModule();
    const cache = lru.getLruCache()!;

    cache.set('at-limit', 'x'.repeat(10_000));

    expect(cache.get('at-limit')).toBe('x'.repeat(10_000));
  });

  it('evicts least recently used entries once the max entry count is exceeded', async () => {
    const lru = await loadFreshLruModule({ L1_CACHE_MAX_ENTRIES: '3' });
    const cache = lru.getLruCache()!;

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Touch 'a' so 'b' becomes the LRU entry
    cache.get('a');

    cache.set('d', '4');

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });
});

describe('lru-cache semantics exercised by the production configuration', () => {
  it('expires entries after their TTL elapses (lazy expiry on read)', async () => {
    const cache = new LRUCache<string, string>({
      max: 100,
      ttl: 50,
      ttlResolution: 10,
      allowStale: false,
    });

    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.get('key')).toBeUndefined();
  });

  it('round-trips JSON-serialized payloads (the shape cached by the hybrid layer)', () => {
    const cache = new LRUCache<string, string>({
      max: 100,
      sizeCalculation: (value) => Buffer.byteLength(value),
      maxEntrySize: 10_000,
    });

    const value = { permissions: ['orgs:view', 'users:create'], timestamp: Date.now() };
    const serialized = JSON.stringify(value);

    cache.set('perm:test:123', serialized);

    expect(cache.get('perm:test:123')).toBe(serialized);
    expect(JSON.parse(cache.get('perm:test:123')!)).toEqual(value);
  });

  it('sizeCalculation measures values in bytes (drives maxEntrySize enforcement)', () => {
    const sizeCalculation = (value: string) => Buffer.byteLength(value);

    expect(sizeCalculation('hi')).toBe(2);
    expect(sizeCalculation('hello world')).toBe(11);
    // multibyte characters count as multiple bytes
    expect(sizeCalculation('ééé')).toBe(6);
  });
});

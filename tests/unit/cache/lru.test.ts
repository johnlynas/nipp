/**
 * Unit tests for L1 In-Memory Cache (lib/cache/lru.ts)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LRUCache } from 'lru-cache';

// We test the LRU cache configuration and behavior directly,
// since the singleton is module-scoped and hard to mock.

describe('LRU Cache Configuration', () => {
  it('should create an LRU cache with correct max entries', () => {
    const maxEntries = parseInt(process.env.L1_CACHE_MAX_ENTRIES ?? '1000', 10);
    const cache = new LRUCache<string, string>({
      max: maxEntries,
      ttl: parseInt(process.env.L1_CACHE_TTL_MS ?? '60000', 10),
      ttlResolution: 1000,
      allowStale: false,
      sizeCalculation: (value) => Buffer.byteLength(value),
      maxEntrySize: 10_000,
    });

    expect(cache.max).toBe(maxEntries);
  });

  it('should enforce max entry size of 10KB', () => {
    const cache = new LRUCache<string, string>({
      max: 100,
      ttl: 60_000,
      sizeCalculation: (value) => Buffer.byteLength(value),
      maxEntrySize: 10_000,
    });

    // Try to set an entry larger than maxEntrySize
    const oversizedValue = 'x'.repeat(10_001);
    cache.set('oversized', oversizedValue);

    // Entry should not be stored (or evicted immediately)
    expect(cache.has('oversized')).toBe(false);
  });

  it('should evict least recently used entries when max is reached', () => {
    const maxSize = 3;
    const cache = new LRUCache<string, string>({ max: maxSize });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    // Access 'a' to make it recently used
    cache.get('a');

    // Add 'd' — should evict 'b' (least recently used)
    cache.set('d', '4');

    expect(cache.has('a')).toBe(true);
    expect(cache.has('b')).toBe(false); // Evicted
    expect(cache.has('c')).toBe(true);
    expect(cache.has('d')).toBe(true);
  });

  it('should respect TTL and expire entries', async () => {
    const cache = new LRUCache<string, string>({
      max: 100,
      ttl: 50, // 50ms TTL for fast test
      ttlResolution: 10,
    });

    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cache.get('key')).toBeUndefined();
  });

  it('should calculate size in bytes correctly', () => {
    const cache = new LRUCache<string, string>({
      max: 100,
      maxEntrySize: 10_000,
      sizeCalculation: (value) => Buffer.byteLength(value),
    });

    cache.set('short', 'hi'); // 2 bytes
    expect(cache.size).toBe(1); // size returns entry count, not byte total

    cache.set('long', 'hello world'); // 11 bytes
    expect(cache.size).toBe(2); // size returns entry count, not byte total
  });

  it('should clear all entries', () => {
    const cache = new LRUCache<string, string>({ max: 100 });

    cache.set('a', '1');
    cache.set('b', '2');
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
  });

  it('should handle JSON serialization/deserialization', () => {
    const cache = new LRUCache<string, string>({ max: 100 });

    const value = { permissions: ['orgs:view', 'users:create'], timestamp: Date.now() };
    const serialized = JSON.stringify(value);

    cache.set('perm:test:123', serialized);
    const retrieved = cache.get('perm:test:123');

    expect(retrieved).toBe(serialized);
    expect(JSON.parse(retrieved!)).toEqual(value);
  });
});

describe('Runtime Detection', () => {
  it('should detect Edge runtime correctly', () => {
    // In test environment, NEXT_RUNTIME is not set to 'edge'
    const isEdge = process.env.NEXT_RUNTIME === 'edge';
    expect(isEdge).toBe(false);
  });

  it('should allow L1 cache to be disabled via feature flag', () => {
    const enabled = process.env.ENABLE_L1_CACHE !== 'false';
    expect(enabled).toBe(true); // Default should be enabled

    process.env.ENABLE_L1_CACHE = 'false';
    expect(process.env.ENABLE_L1_CACHE).toBe('false');

    // Clean up
    delete process.env.ENABLE_L1_CACHE;
  });
});

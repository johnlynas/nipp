/**
 * Unit tests for Hybrid Cache Layer (lib/cache/hybrid.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as lruModule from '@/lib/cache/lru';
import * as stampedeModule from '@/lib/cache/stampede';
import * as redisModule from '@/lib/redis';

// Mock dependencies
vi.mock('@/lib/cache/lru', () => ({
  getLruCache: vi.fn(),
  recordL1Hit: vi.fn(),
  recordL1Miss: vi.fn(),
}));

vi.mock('@/lib/cache/stampede', () => ({
  getOrSet: vi.fn(async (key: string, resolver: () => Promise<string>) => {
    return resolver();
  }),
}));

vi.mock('@/lib/redis', () => ({
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
  getRedis: vi.fn(),
}));

describe('Hybrid Cache Layer', () => {
  let cacheGet: typeof import('@/lib/cache/hybrid').cacheGet;
  let cacheSet: typeof import('@/lib/cache/hybrid').cacheSet;
  let cacheDel: typeof import('@/lib/cache/hybrid').cacheDel;

  beforeEach(async () => {
    // Import after mocking
    const hybrid = await import('@/lib/cache/hybrid');
    cacheGet = hybrid.cacheGet;
    cacheSet = hybrid.cacheSet;
    cacheDel = hybrid.cacheDel;

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cacheGet', () => {
    it('should return cached value from L1 on hit', async () => {
      const mockLru = {
        has: vi.fn().mockReturnValue(true),
        get: vi.fn().mockReturnValue(JSON.stringify(['perm:view', 'orgs:create'])),
      };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);

      const resolver = vi.fn();

      const result = await cacheGet('perm:user:123', resolver);

      expect(result).toEqual(['perm:view', 'orgs:create']);
      expect(resolver).not.toHaveBeenCalled(); // Should not call resolver on L1 hit
      expect(lruModule.recordL1Hit).toHaveBeenCalled();
    });

    it('should fall through to L2 on L1 miss', async () => {
      const mockLru = {
        has: vi.fn().mockReturnValue(false),
        get: vi.fn(),
        set: vi.fn(),
      };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);
      // Redis has a value (L2 hit)
      vi.mocked(redisModule.redisGet).mockResolvedValue(JSON.stringify(['perm:view']));

      const resolver = vi.fn().mockResolvedValue(['perm:db']);

      // Mock stampede to call resolver (but it shouldn't be called since L2 has value)
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      const result = await cacheGet('perm:user:123', resolver);

      // Should return Redis value, not call resolver
      expect(result).toEqual(['perm:view']);
      expect(resolver).not.toHaveBeenCalled(); // Resolver not called on L2 hit
    });

    it('should write through to both layers on cache miss', async () => {
      const mockLru = {
        has: vi.fn().mockReturnValue(false),
        get: vi.fn(),
        set: vi.fn(),
      };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);
      vi.mocked(redisModule.redisGet).mockResolvedValue(null); // L2 miss

      const resolver = vi.fn().mockResolvedValue(['perm:new']);
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      await cacheGet('perm:user:123', resolver);

      expect(redisModule.redisSet).toHaveBeenCalledWith(
        'perm:user:123',
        JSON.stringify(['perm:new']),
        300 // Default TTL
      );
      expect(mockLru.set).toHaveBeenCalledWith(
        'perm:user:123',
        JSON.stringify(['perm:new'])
      );
    });

    it('should use custom TTL when provided', async () => {
      const mockLru = { has: vi.fn().mockReturnValue(false), get: vi.fn(), set: vi.fn() };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);
      vi.mocked(redisModule.redisGet).mockResolvedValue(null);

      const resolver = vi.fn().mockResolvedValue(['perm:test']);
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      await cacheGet('search:org:test', resolver, { ttlSeconds: 30 });

      expect(redisModule.redisSet).toHaveBeenCalledWith(
        'search:org:test',
        JSON.stringify(['perm:test']),
        30 // Custom TTL
      );
    });

    it('should record L1 miss when L1 does not have the key', async () => {
      const mockLru = { has: vi.fn().mockReturnValue(false), get: vi.fn(), set: vi.fn() };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);
      vi.mocked(redisModule.redisGet).mockResolvedValue(null);

      const resolver = vi.fn().mockResolvedValue(['perm:test']);
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      await cacheGet('perm:user:123', resolver);

      expect(lruModule.recordL1Miss).toHaveBeenCalled();
    });
  });

  describe('cacheSet', () => {
    it('should write through to both L1 and L2', async () => {
      const mockLru = { set: vi.fn() };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);

      await cacheSet('perm:user:123', ['perm:view', 'orgs:create']);

      expect(redisModule.redisSet).toHaveBeenCalledWith(
        'perm:user:123',
        JSON.stringify(['perm:view', 'orgs:create']),
        300 // Default TTL
      );
      expect(mockLru.set).toHaveBeenCalledWith(
        'perm:user:123',
        JSON.stringify(['perm:view', 'orgs:create'])
      );
    });

    it('should use custom TTL when provided', async () => {
      const mockLru = { set: vi.fn() };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);

      await cacheSet('search:org:test', ['org1'], { ttlSeconds: 30 });

      expect(redisModule.redisSet).toHaveBeenCalledWith(
        'search:org:test',
        JSON.stringify(['org1']),
        30 // Custom TTL
      );
    });
  });

  describe('cacheDel', () => {
    it('should delete from both L1 and L2', async () => {
      const mockLru = { delete: vi.fn() };
      vi.mocked(lruModule.getLruCache).mockReturnValue(mockLru as any);

      await cacheDel('perm:user:123');

      expect(mockLru.delete).toHaveBeenCalledWith('perm:user:123');
      expect(redisModule.redisDel).toHaveBeenCalledWith('perm:user:123');
    });
  });

  describe('Edge Case Handling', () => {
    it('should handle null L1 cache (Edge runtime)', async () => {
      vi.mocked(lruModule.getLruCache).mockReturnValue(null);
      vi.mocked(redisModule.redisGet).mockResolvedValue(JSON.stringify(['perm:view']));

      const resolver = vi.fn().mockResolvedValue(['perm:db']);
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      const result = await cacheGet('perm:user:123', resolver);

      expect(result).toEqual(['perm:db']);
      expect(resolver).toHaveBeenCalled();
    });

    it('should handle Redis not configured', async () => {
      vi.mocked(lruModule.getLruCache).mockReturnValue(null);
      vi.mocked(redisModule.redisGet).mockResolvedValue(null);

      const resolver = vi.fn().mockResolvedValue(['perm:db']);
      vi.mocked(stampedeModule.getOrSet).mockImplementation(async (_key, resolver) => {
        return resolver();
      });

      const result = await cacheGet('perm:user:123', resolver);

      expect(result).toEqual(['perm:db']);
    });
  });
});

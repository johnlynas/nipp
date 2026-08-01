/**
 * Unit tests for Cache Health and Metrics (lib/cache/health.ts)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as lruModule from '@/lib/cache/lru';
import * as redisModule from '@/lib/redis';

// Mock dependencies
vi.mock('@/lib/cache/lru', () => ({
  getMetrics: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(),
}));

describe('Cache Health and Metrics', () => {
  let getCacheMetrics: typeof import('@/lib/cache/health').getCacheMetrics;
  let recordL2Hit: typeof import('@/lib/cache/health').recordL2Hit;
  let recordL2Miss: typeof import('@/lib/cache/health').recordL2Miss;
  let resetMetrics: typeof import('@/lib/cache/health').resetMetrics;

  beforeEach(async () => {
    vi.clearAllMocks();
    const health = await import('@/lib/cache/health');
    // Reset module-level L2 counters (they persist across tests)
    health.resetMetrics();
    getCacheMetrics = health.getCacheMetrics;
    recordL2Hit = health.recordL2Hit;
    recordL2Miss = health.recordL2Miss;
    resetMetrics = health.resetMetrics;

    // Default LRU metrics mock
    vi.mocked(lruModule.getMetrics).mockReturnValue({
      l1Hits: 80,
      l1Misses: 20,
      l1Size: 50,
      l1MemoryBytes: 10240,
      l1HitRate: 80,
    });

    // Default Redis mock (connected)
    vi.mocked(redisModule.getRedis).mockReturnValue({ status: 'ready' } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordL2Hit / recordL2Miss', () => {
    it('should increment L2 hit counter', async () => {
      recordL2Hit();
      const metrics = getCacheMetrics();
      expect(metrics.l2Hits).toBe(1);
    });

    it('should increment L2 miss counter', async () => {
      recordL2Miss();
      const metrics = getCacheMetrics();
      expect(metrics.l2Misses).toBe(1);
    });

    it('should track both hits and misses independently', async () => {
      recordL2Hit();
      recordL2Hit();
      recordL2Miss();

      const metrics = getCacheMetrics();
      expect(metrics.l2Hits).toBe(2);
      expect(metrics.l2Misses).toBe(1);
    });

    it('should start at zero after reset', async () => {
      recordL2Hit();
      recordL2Miss();
      resetMetrics();

      const metrics = getCacheMetrics();
      expect(metrics.l2Hits).toBe(0);
      expect(metrics.l2Misses).toBe(0);
    });
  });

  describe('getCacheMetrics', () => {
    it('should return combined L1 and L2 metrics', async () => {
      recordL2Hit();
      recordL2Miss();

      const metrics = getCacheMetrics();

      expect(metrics.l1Hits).toBe(80);
      expect(metrics.l1Misses).toBe(20);
      expect(metrics.l1Size).toBe(50);
      expect(metrics.l1MemoryBytes).toBe(10240);
      expect(metrics.l1HitRate).toBe(80);
      expect(metrics.l2Hits).toBe(1);
      expect(metrics.l2Misses).toBe(1);
    });

    it('should report redisConnected as true when Redis is ready', async () => {
      vi.mocked(redisModule.getRedis).mockReturnValue({ status: 'ready' } as any);
      const metrics = getCacheMetrics();
      expect(metrics.redisConnected).toBe(true);
    });

    it('should report redisConnected as true when Redis is connecting', async () => {
      vi.mocked(redisModule.getRedis).mockReturnValue({ status: 'connect' } as any);
      const metrics = getCacheMetrics();
      expect(metrics.redisConnected).toBe(true);
    });

    it('should report redisConnected as false when Redis is disconnected', async () => {
      vi.mocked(redisModule.getRedis).mockReturnValue({ status: 'end' } as any);
      const metrics = getCacheMetrics();
      expect(metrics.redisConnected).toBe(false);
    });

    it('should report redisConnected as false when Redis is null', async () => {
      vi.mocked(redisModule.getRedis).mockReturnValue(null);
      const metrics = getCacheMetrics();
      expect(metrics.redisConnected).toBe(false);
    });

    it('should return zero L2 counters on fresh start', async () => {
      const metrics = getCacheMetrics();
      expect(metrics.l2Hits).toBe(0);
      expect(metrics.l2Misses).toBe(0);
    });
  });
});

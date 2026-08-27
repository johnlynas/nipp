import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory L1 invalidation spy (resolver lazily imports this module)
const mockLruInvalidate = vi.fn();
vi.mock('@/lib/cache/lru', () => ({
  invalidate: (key: string) => mockLruInvalidate(key),
}));

// Create a mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
  scan: vi.fn(),
};

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => mockRedisClient),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock('@/lib/tenant-db', () => {
  const mockTenantDb = {
    member: { findFirst: vi.fn() },
  };
  return { default: mockTenantDb, tenantDb: mockTenantDb };
});

// Mock the hybrid cache layer (used by updated resolver)
vi.mock('@/lib/cache/hybrid', () => ({
  cacheGet: vi.fn(),
  cacheDel: vi.fn(),
}));

import { resolvePermissions, invalidatePermissionCache, invalidateUserCache } from '@/lib/permissions/resolver';
import { getRedis } from '@/lib/redis';
import tenantDb from '@/lib/tenant-db';
import * as hybridModule from '@/lib/cache/hybrid';

describe('resolvePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached permissions from hybrid layer when available', async () => {
    vi.mocked(hybridModule.cacheGet).mockResolvedValue(['properties:view']);

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view']);
    expect(hybridModule.cacheGet).toHaveBeenCalledWith(
      'perm:user-1:org-1',
      expect.any(Function),
      { ttlType: 'volatile' }
    );
  });

  it('runs the resolver callback on cache miss, flattens roles to unique permission keys', async () => {
    // Simulate a real hybrid-layer miss: invoke the caller-supplied resolver.
    vi.mocked(hybridModule.cacheGet).mockImplementation(async (_key, resolver) =>
      (resolver as () => Promise<string[]>)()
    );

    // Two roles; 'logs:view' is duplicated across them to exercise dedup.
    vi.mocked(tenantDb.member.findFirst).mockResolvedValue(
      {
        memberRoles: [
          {
            role: {
              permissions: [
                { permission: { key: 'properties:view' } },
                { permission: { key: 'logs:view' } },
              ],
            },
          },
          {
            role: {
              permissions: [{ permission: { key: 'logs:view' } }],
            },
          },
        ],
      } as never
    );

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view', 'logs:view']);
    expect(hybridModule.cacheGet).toHaveBeenCalledWith(
      'perm:user-1:org-1',
      expect.any(Function),
      { ttlType: 'volatile' }
    );
    // Resolver must query the member by (userId, orgId) with a permission select.
    expect(tenantDb.member.findFirst).toHaveBeenCalledTimes(1);
    expect(tenantDb.member.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', orgId: 'org-1' },
      select: expect.any(Object),
    });
  });

  it('returns [] when the user is not a member of the organization (no rows)', async () => {
    vi.mocked(hybridModule.cacheGet).mockImplementation(async (_key, resolver) =>
      (resolver as () => Promise<string[]>)()
    );
    vi.mocked(tenantDb.member.findFirst).mockResolvedValue(null);

    const result = await resolvePermissions('user-1', 'org-1');
    expect(result).toEqual([]);
  });

  it('returns [] when the member exists but has no role assignments', async () => {
    vi.mocked(hybridModule.cacheGet).mockImplementation(async (_key, resolver) =>
      (resolver as () => Promise<string[]>)()
    );
    vi.mocked(tenantDb.member.findFirst).mockResolvedValue({ memberRoles: [] } as never);

    const result = await resolvePermissions('user-1', 'org-1');
    expect(result).toEqual([]);
  });

  it('falls back to [] when cacheGet resolves to null/undefined', async () => {
    vi.mocked(hybridModule.cacheGet).mockResolvedValue(null as never);

    const result = await resolvePermissions('user-1', 'org-1');
    expect(result).toEqual([]);
  });

  it('returns [] and logs when the cache layer rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(hybridModule.cacheGet).mockRejectedValue(new Error('redis down'));

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Permission resolution error:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });

  it('returns [] and logs when the DB query rejects inside the resolver', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(hybridModule.cacheGet).mockImplementation(async (_key, resolver) =>
      (resolver as () => Promise<string[]>)()
    );
    vi.mocked(tenantDb.member.findFirst).mockRejectedValue(new Error('db down'));

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Permission resolution error:', expect.any(Error));
    consoleErrorSpy.mockRestore();
  });
});

describe('invalidatePermissionCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes the per-user/org cache key via the hybrid layer', async () => {
    await invalidatePermissionCache('user-1', 'org-1');

    expect(hybridModule.cacheDel).toHaveBeenCalledTimes(1);
    expect(hybridModule.cacheDel).toHaveBeenCalledWith('perm:user-1:org-1');
  });
});

describe('invalidateUserCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates all permission caches for a user across orgs', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);
    // Mock scan to return keys in two batches, then terminate with cursor '0'
    mockRedisClient.scan
      .mockResolvedValueOnce(['1', ['perm:user-1:org-1']])
      .mockResolvedValueOnce(['0', ['perm:user-1:org-2']]);

    await invalidateUserCache('user-1');

    expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
    expect(mockRedisClient.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'perm:user-1:*', 'COUNT', 100);
    expect(mockRedisClient.del).toHaveBeenCalledWith('perm:user-1:org-1', 'perm:user-1:org-2');
  });

  it('returns early when Redis is not configured', async () => {
    vi.mocked(getRedis).mockReturnValue(null);

    await invalidateUserCache('user-1');

    // Should not throw or make any calls
    expect(mockRedisClient.scan).not.toHaveBeenCalled();
  });

  it('deletes in batches of 100 while scanning continues', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);
    // First SCAN pass returns 150 keys (triggers the batched-del branch),
    // second pass terminates the scan.
    const firstBatch = Array.from({ length: 150 }, (_, i) => `perm:user-9:k${i}`);
    mockRedisClient.scan
      .mockResolvedValueOnce(['2', firstBatch])
      .mockResolvedValueOnce(['0', []]);

    await invalidateUserCache('user-9');

    // The 150 keys exceed the >= 100 threshold, so del is called mid-loop,
    // then the remaining 50 are deleted after the scan finishes.
    expect(mockRedisClient.del).toHaveBeenNthCalledWith(1, ...firstBatch.slice(0, 100));
    expect(mockRedisClient.del).toHaveBeenNthCalledWith(2, ...firstBatch.slice(100));
    expect(mockRedisClient.scan).toHaveBeenCalledTimes(2);
  });

  it('does not call del or L1 invalidate when no keys match the pattern', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);
    mockRedisClient.scan.mockResolvedValueOnce(['0', []]);

    await invalidateUserCache('user-1');

    expect(mockRedisClient.del).not.toHaveBeenCalled();
    expect(mockLruInvalidate).not.toHaveBeenCalled();
  });

  it('evicts every deleted key from the L1 cache', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);
    mockRedisClient.scan.mockResolvedValueOnce(['0', ['perm:user-1:org-1', 'perm:user-1:org-2']]);

    await invalidateUserCache('user-1');

    expect(mockLruInvalidate).toHaveBeenCalledTimes(2);
    expect(mockLruInvalidate).toHaveBeenCalledWith('perm:user-1:org-1');
    expect(mockLruInvalidate).toHaveBeenCalledWith('perm:user-1:org-2');
  });

  it('swallows Redis failures and logs them', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as never);
    mockRedisClient.scan.mockRejectedValue(new Error('redis down'));

    await expect(invalidateUserCache('user-1')).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[PermissionCache] Failed to invalidate user cache:',
      expect.any(Error),
      { userId: 'user-1' }
    );
    consoleErrorSpy.mockRestore();
  });
});

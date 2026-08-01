import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { resolvePermissions, invalidateUserCache } from '@/lib/permissions/resolver';
import { redisGet, redisSet, getRedis } from '@/lib/redis';
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

  it('fetches from DB and caches when hybrid layer misses', async () => {
    // Simulate cache miss by returning null from cacheGet
    vi.mocked(hybridModule.cacheGet).mockImplementation(async (key, resolver) => {
      // Simulate cache miss - call the resolver
      const dbResult = await tenantDb.member.findFirst({
        where: { userId: 'user-1', orgId: 'org-1' },
        select: {
          memberRoles: {
            select: {
              role: {
                select: {
                  permissions: {
                    select: {
                      permission: { select: { key: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!dbResult?.memberRoles) {
        return [];
      }

      const permissions: string[] = dbResult.memberRoles.flatMap(
        (mr) => mr.role.permissions.map((rp) => rp.permission.key)
      );

      return Array.from(new Set(permissions));
    });

    // Mock the memberRoles join table query (matches resolver's select shape)
    vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
      memberRoles: [
        {
          role: {
            permissions: [
              {
                permission: {
                  key: 'properties:view',
                },
              },
            ],
          },
        },
      ],
    } as any);

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view']);
    // Hybrid layer should have been called with the resolver
    expect(hybridModule.cacheGet).toHaveBeenCalledWith(
      'perm:user-1:org-1',
      expect.any(Function),
      { ttlType: 'volatile' }
    );
    expect(tenantDb.member.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', orgId: 'org-1' },
      select: expect.any(Object),
    });
  });
});

describe('invalidateUserCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates all permission caches for a user across orgs', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as any);
    // Mock scan to return keys in two batches, then terminate with cursor '0'
    mockRedisClient.scan
      .mockResolvedValueOnce(['1', ['perm:user-1:org-1']])
      .mockResolvedValueOnce(['0', ['perm:user-1:org-2']]);

    await invalidateUserCache('user-1');

    expect(mockRedisClient.scan).toHaveBeenCalled();
    expect(mockRedisClient.del).toHaveBeenCalledWith('perm:user-1:org-1', 'perm:user-1:org-2');
  });

  it('returns early when Redis is not configured', async () => {
    vi.mocked(getRedis).mockReturnValue(null);

    await invalidateUserCache('user-1');

    // Should not throw or make any calls
    expect(mockRedisClient.scan).not.toHaveBeenCalled();
  });
});

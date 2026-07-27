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

import { resolvePermissions, invalidateUserCache } from '@/lib/permissions/resolver';
import { redisGet, redisSet, getRedis } from '@/lib/redis';
import tenantDb from '@/lib/tenant-db';

describe('resolvePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns cached permissions from Redis when available', async () => {
    vi.mocked(redisGet).mockResolvedValue(JSON.stringify(['properties:view']));

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view']);
    expect(redisGet).toHaveBeenCalledWith('perm:user-1:org-1');
  });

  it('fetches from DB and caches when Redis misses', async () => {
    vi.mocked(redisGet).mockResolvedValue(null);
    // Mock the single query with nested includes (optimized approach)
    vi.mocked(tenantDb.member.findFirst).mockResolvedValue({
      id: 'member-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'user-1',
      orgId: 'org-1',
      role: {
        id: 'role-1',
        name: 'Admin',
        createdAt: new Date(),
        updatedAt: new Date(),
        organizationId: 'org-1',
        description: null,
        isDefault: false,
        permissions: [
          {
            permission: {
              key: 'properties:view',
            },
          },
        ],
      },
    });

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view']);
    expect(redisSet).toHaveBeenCalledWith('perm:user-1:org-1', JSON.stringify(['properties:view']), 300);
    expect(tenantDb.member.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', orgId: 'org-1' },
      select: expect.any(Object),
    });
  });
});

describe('invalidateUserCache', () => {
  it('invalidates all permission caches for a user across orgs', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as any);
    // Mock scan to return keys in two batches, then terminate with cursor '0'
    mockRedisClient.scan
      .mockResolvedValueOnce(['1', ['perm:user-1:org-1']])
      .mockResolvedValueOnce(['0', ['perm:user-1:org-2']]);
    vi.mocked(mockRedisClient.del).mockResolvedValue(2);

    await invalidateUserCache('user-1');

    expect(mockRedisClient.scan).toHaveBeenCalledWith('0', 'MATCH', 'perm:user-1:*', 'COUNT', 100);
    expect(mockRedisClient.del).toHaveBeenCalledWith('perm:user-1:org-1', 'perm:user-1:org-2');
  });

  it('does nothing if getRedis returns null', async () => {
    vi.mocked(getRedis).mockReturnValue(null);
    
    await invalidateUserCache('user-1');
    
    // Should not throw
  });
});
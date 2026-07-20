import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a mock Redis client
const mockRedisClient = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  keys: vi.fn(),
};

vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => mockRedisClient),
  redisGet: vi.fn(),
  redisSet: vi.fn(),
  redisDel: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const mockPrisma = {
    member: { findFirst: vi.fn() },
    role: { findMany: vi.fn() },
    rolePermission: { findMany: vi.fn() },
    permission: { findMany: vi.fn() },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

import { resolvePermissions, invalidateUserCache } from '@/lib/permissions/resolver';
import { redisGet, redisSet, getRedis } from '@/lib/redis';
import prisma from '@/lib/db';

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
    vi.mocked(prisma.member.findFirst).mockResolvedValue({
      id: 'member-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      userId: 'user-1',
      orgId: 'org-1',
      role: 'Admin',
    });
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      {
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
    ]);
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([
      {
        id: 'role-perm-1',
        createdAt: new Date(),
        roleId: 'role-1',
        permissionId: 'perm-1',
        organizationId: 'test-org-id',
      },
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([
      {
        id: 'perm-1',
        key: 'properties:view',
        createdAt: new Date(),
        updatedAt: new Date(),
        description: null,
        action: 'view',
        resource: 'properties',
      },
    ]);

    const result = await resolvePermissions('user-1', 'org-1');

    expect(result).toEqual(['properties:view']);
    expect(redisSet).toHaveBeenCalledWith('perm:user-1:org-1', JSON.stringify(['properties:view']), 300);
  });
});

describe('invalidateUserCache', () => {
  it('invalidates all permission caches for a user across orgs', async () => {
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as any);
    vi.mocked(mockRedisClient.keys).mockResolvedValue(['perm:user-1:org-1', 'perm:user-1:org-2']);
    vi.mocked(mockRedisClient.del).mockResolvedValue(2);

    await invalidateUserCache('user-1');

    expect(mockRedisClient.keys).toHaveBeenCalledWith('perm:user-1:*');
    expect(mockRedisClient.del).toHaveBeenCalledWith('perm:user-1:org-1', 'perm:user-1:org-2');
  });

  it('does nothing if getRedis returns null', async () => {
    vi.mocked(getRedis).mockReturnValue(null);
    
    await invalidateUserCache('user-1');
    
    // Should not throw
  });
});
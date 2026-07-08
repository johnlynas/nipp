import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis client
const mockRedisClient = {
  del: vi.fn(),
};

// Mock Prisma
vi.mock('@/lib/db', () => {
  const mockPrisma = {
    role: {
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    rolePermission: {
      createMany: vi.fn(),
    },
    permission: {
      findMany: vi.fn(),
    },
    member: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
    memberRole: {
      create: vi.fn(),
    },
  };
  return { prisma: mockPrisma };
});

// Mock Redis getter
vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => mockRedisClient),
}));

// Import AFTER mocks
import { bootstrapOrganizationRoles } from '@/lib/org-bootstrap';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';

describe('bootstrapOrganizationRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure getRedis returns our mock client for each test
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as any);
  });

  it('creates 7 default roles for a new organization', async () => {
    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 });
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'r1', name: 'Organization Admin' },
      { id: 'r2', name: 'Property Manager' },
      { id: 'r3', name: 'Letting Agent' },
      { id: 'r4', name: 'Accountant' },
      { id: 'r5', name: 'Maintenance Staff' },
      { id: 'r6', name: 'Tenant' },
      { id: 'r7', name: 'Contractor' },
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([
      { id: 'p1', name: 'properties:view' },
      { id: 'p2', name: 'properties:create' },
    ]);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 10 });
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1' });
    vi.mocked(prisma.memberRole.create).mockResolvedValue({});
    vi.mocked(prisma.member.findMany).mockResolvedValue([]);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.role.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: 'Organization Admin', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Property Manager', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Letting Agent', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Accountant', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Maintenance Staff', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Tenant', organizationId: 'org-1', isDefault: true }),
        expect.objectContaining({ name: 'Contractor', organizationId: 'org-1', isDefault: true }),
      ]),
    });
  });

  it('assigns creator as Organization Admin', async () => {
    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 });
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'admin-role-id', name: 'Organization Admin' },
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'existing-member' });
    vi.mocked(prisma.memberRole.create).mockResolvedValue({});
    vi.mocked(prisma.member.findMany).mockResolvedValue([]);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.memberRole.create).toHaveBeenCalledWith({
      data: {
        memberId: 'existing-member',
        roleId: 'admin-role-id',
        organizationId: 'org-1',
      },
    });
  });

  it('handles errors gracefully without throwing', async () => {
    vi.mocked(prisma.role.createMany).mockRejectedValue(new Error('DB error'));

    await expect(bootstrapOrganizationRoles('org-1', 'user-1')).resolves.not.toThrow();
  });
});
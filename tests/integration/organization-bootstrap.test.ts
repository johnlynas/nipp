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
      { id: 'r1', name: 'Organization Admin', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r2', name: 'Property Manager', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r3', name: 'Letting Agent', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r4', name: 'Accountant', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r5', name: 'Maintenance Staff', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r6', name: 'Tenant', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
      { id: 'r7', name: 'Contractor', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([
      { id: 'p1', key: 'properties:view', createdAt: new Date(), updatedAt: new Date(), description: null, action: 'view', resource: 'properties' },
      { id: 'p2', key: 'properties:create', createdAt: new Date(), updatedAt: new Date(), description: null, action: 'create', resource: 'properties' },
    ]);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 10 });
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1', orgId: 'org-1', role: 'admin' });
    vi.mocked(prisma.memberRole.create).mockResolvedValue({ id: 'test-id', createdAt: new Date(), organizationId: 'test-org-id', memberId: 'test-member-id', roleId: 'test-role-id' });
    vi.mocked(prisma.member.findMany).mockResolvedValue([]);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.role.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ name: 'Organization Admin', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Property Manager', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Letting Agent', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Accountant', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Maintenance Staff', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Tenant', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
        expect.objectContaining({ name: 'Contractor', organizationId: 'org-1', isDefault: true, createdAt: expect.any(Date), updatedAt: expect.any(Date) }),
      ]),
    });
  });

  it('assigns creator as Organization Admin', async () => {
    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 });
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'admin-role-id', name: 'Organization Admin', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true },
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([]);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1', orgId: 'org-1', role: 'admin' });
    vi.mocked(prisma.memberRole.create).mockResolvedValue({ id: 'test-id', createdAt: new Date(), organizationId: 'test-org-id', memberId: 'test-member-id', roleId: 'test-role-id' });
    vi.mocked(prisma.member.findMany).mockResolvedValue([]);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.memberRole.create).toHaveBeenCalledWith({
      data: {
        member: { connect: { id: 'member-1' } },
        role: { connect: { id: 'admin-role-id' } },
        organization: { connect: { id: 'org-1' } },
      },
    });
  });

  it('handles errors gracefully without throwing', async () => {
    vi.mocked(prisma.role.createMany).mockRejectedValue(new Error('DB error'));

    await expect(bootstrapOrganizationRoles('org-1', 'user-1')).resolves.not.toThrow();
  });
});
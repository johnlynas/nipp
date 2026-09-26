import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Redis client
const mockRedisClient = {
  del: vi.fn(),
};

// Mock Prisma
vi.mock('@/lib/db', () => {
  const mockPrisma = {
    $extends: vi.fn().mockReturnThis(),
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
      findFirst: vi.fn(),
    },
    team: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    teamMember: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    teamRole: {
      findMany: vi.fn(),
    },
  };
  return { default: mockPrisma, prisma: mockPrisma };
});

// Mock Redis getter
vi.mock('@/lib/redis', () => ({
  getRedis: vi.fn(() => mockRedisClient),
}));

// Mock the default-Teams enrollment so bootstrap tests stay deterministic;
// individual tests override to simulate failures.
vi.mock('@/lib/org-default-team', () => ({
  enrollInDefaultMembersTeam: vi.fn().mockResolvedValue(undefined),
}));

// Import AFTER mocks
import { bootstrapOrganizationRoles } from '@/lib/org-bootstrap';
import { prisma } from '@/lib/db';
import { getRedis } from '@/lib/redis';
import { enrollInDefaultMembersTeam } from '@/lib/org-default-team';

describe('bootstrapOrganizationRoles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure getRedis returns our mock client for each test
    vi.mocked(getRedis).mockReturnValue(mockRedisClient as any);
  });

  it('creates 7 default roles for a new organization', async () => {
    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 } as any);
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'r1', name: 'Organization Admin', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r2', name: 'Property Manager', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r3', name: 'Letting Agent', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r4', name: 'Accountant', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r5', name: 'Maintenance Staff', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r6', name: 'Tenant', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
      { id: 'r7', name: 'Contractor', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([
      { id: 'p1', key: 'properties:view', createdAt: new Date(), updatedAt: new Date(), description: null, action: 'view', resource: 'properties' } as any,
      { id: 'p2', key: 'properties:create', createdAt: new Date(), updatedAt: new Date(), description: null, action: 'create', resource: 'properties' } as any,
    ]);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 10 } as any);
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1', orgId: 'org-1', role: 'admin' } as any);
    vi.mocked(prisma.memberRole.create).mockResolvedValue({ id: 'test-id', createdAt: new Date(), updatedAt: new Date(), organizationId: 'test-org-id', memberId: 'test-member-id', roleId: 'test-role-id' } as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as any);

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
    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 } as any);
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'admin-role-id', name: 'Organization Admin', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1', orgId: 'org-1', role: 'admin' } as any);
    vi.mocked(prisma.memberRole.create).mockResolvedValue({ id: 'test-id', createdAt: new Date(), updatedAt: new Date(), organizationId: 'test-org-id', memberId: 'test-member-id', roleId: 'test-role-id' } as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as any);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.memberRole.create).toHaveBeenCalledWith({
      data: {
        memberId: 'member-1',
        organizationId: 'org-1',
        roleId: 'admin-role-id',
      },
    });
  });

  it('still assigns Organization Admin when Members-team enrollment fails', async () => {
    // Regression: a Teams-side failure (which is best-effort) must not stop
    // the creator from receiving the role — enrollment runs before the
    // memberRole.create and its error was previously swallowed, silently
    // demoting brand-new org creators.
    vi.mocked(enrollInDefaultMembersTeam).mockRejectedValue(new Error('Teams DB down'));

    vi.mocked(prisma.role.createMany).mockResolvedValue({ count: 7 } as any);
    vi.mocked(prisma.role.findMany).mockResolvedValue([
      { id: 'admin-role-id', name: 'Organization Admin', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', description: null, isDefault: true } as any,
    ]);
    vi.mocked(prisma.permission.findMany).mockResolvedValue([] as any);
    vi.mocked(prisma.rolePermission.createMany).mockResolvedValue({ count: 0 } as any);
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null as any);
    vi.mocked(prisma.member.create).mockResolvedValue({ id: 'member-1', createdAt: new Date(), updatedAt: new Date(), userId: 'user-1', orgId: 'org-1', role: 'admin' } as any);
    vi.mocked(prisma.memberRole.create).mockResolvedValue({ id: 'test-id', createdAt: new Date(), updatedAt: new Date(), organizationId: 'org-1', memberId: 'member-1', roleId: 'admin-role-id' } as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue([] as any);

    await bootstrapOrganizationRoles('org-1', 'user-1');

    expect(prisma.memberRole.create).toHaveBeenCalledWith({
      data: {
        memberId: 'member-1',
        organizationId: 'org-1',
        roleId: 'admin-role-id',
      },
    });
  });

  it('handles errors gracefully without throwing', async () => {
    vi.mocked(prisma.role.createMany).mockRejectedValue(new Error('DB error'));

    await expect(bootstrapOrganizationRoles('org-1', 'user-1')).resolves.not.toThrow();
  });
});

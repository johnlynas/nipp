/**
 * Unit tests for db.ts — Prisma Client extensions for slug generation and role inheritance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset module registry and globalThis cache between tests to ensure fresh Prisma instances
beforeEach(() => {
  vi.resetModules();
  (globalThis as any).prisma = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
});

const createMockPrismaClient = () => {
  const mockQuery = vi.fn(function(args: any) { return Promise.resolve(args.data); });
  
  const baseMock: any = {
    $extends: vi.fn(function(config: any) {
      return {
        team: {
          create: (args: any) => config.query.team.create({ args, query: mockQuery }),
          createMany: (args: any) => config.query.team.createMany({ args, query: mockQuery }),
        },
        teamMember: {
          create: async (args: any) => config.query.teamMember.create({ args, query: mockQuery }),
        },
        // Expose the base models so the extension can call them
        member: baseMock.member,
        teamRole: baseMock.teamRole,
        memberRole: baseMock.memberRole,
      };
    }),
    member: {
      findFirst: vi.fn(),
    },
    teamRole: {
      findMany: vi.fn(),
    },
    memberRole: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return baseMock;
};

describe('db.ts (Prisma extensions)', () => {
  let db: any;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = createMockPrismaClient();
    vi.doMock('@prisma/client', () => ({
      PrismaClient: vi.fn(function() { return mockPrisma; }),
    }));
    vi.doMock('@/lib/env', () => ({
      env: { NODE_ENV: 'test' },
    }));
    
    const module = await import('@/lib/db');
    db = module.default;
  });

  describe('generateSlug (via team.create)', () => {
    it('generates slug from name when slug is not provided', async () => {
      const result = await db.team.create({
        data: { name: 'My Awesome Team' },
      });
      expect(result.slug).toBe('my-awesome-team');
    });

    it('converts to lowercase and replaces special characters with hyphens', async () => {
      const result = await db.team.create({
        data: { name: 'Hello World! @2026' },
      });
      expect(result.slug).toBe('hello-world-2026');
    });

    it('collapses multiple hyphens and trims leading/trailing hyphens', async () => {
      const result = await db.team.create({
        data: { name: '---  Test   Name  ---' },
      });
      expect(result.slug).toBe('test-name');
    });

    it('truncates slug to 100 characters', async () => {
      const longName = 'a'.repeat(150);
      const result = await db.team.create({
        data: { name: longName },
      });
      expect(result.slug).toHaveLength(100);
    });

    it('does not override provided slug', async () => {
      const result = await db.team.create({
        data: { name: 'My Team', slug: 'custom-slug' },
      });
      expect(result.slug).toBe('custom-slug');
    });

    it('handles empty name gracefully', async () => {
      const result = await db.team.create({
        data: { name: '' },
      });
      expect(result.slug).toBeUndefined();
    });

    it('handles names with only special characters', async () => {
      const result = await db.team.create({
        data: { name: '!@#$%^&*()' },
      });
      expect(result.slug).toBe('');
    });
  });

  describe('team.createMany', () => {
    it('generates slugs for multiple teams', async () => {
      const result = await db.team.createMany({
        data: [
          { name: 'Team One' },
          { name: 'Team Two', slug: 'custom-two' },
          { name: 'Team Three!!!' },
        ],
      });
      
      expect(result[0].slug).toBe('team-one');
      expect(result[1].slug).toBe('custom-two');
      expect(result[2].slug).toBe('team-three');
    });

    it('handles empty array', async () => {
      const result = await db.team.createMany({ data: [] });
      expect(result).toEqual([]);
    });

    it('does not generate slug if name is missing', async () => {
      const result = await db.team.createMany({
        data: [{ id: '1' }],
      });
      expect(result[0].slug).toBeUndefined();
    });
  });

  describe('teamMember.create (role inheritance)', () => {
    const mockArgs = {
      data: { teamId: 'team-1', userId: 'user-1', organizationId: 'org-1' },
    };

    it('assigns team roles to the new member', async () => {
      mockPrisma.member.findFirst.mockResolvedValue({ id: 'member-1' });
      mockPrisma.teamRole.findMany.mockResolvedValue([{ roleId: 'role-1' }, { roleId: 'role-2' }]);
      mockPrisma.memberRole.findFirst.mockResolvedValue(null);

      const result = await db.teamMember.create(mockArgs);

      expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', orgId: 'org-1' },
      });
      expect(mockPrisma.teamRole.findMany).toHaveBeenCalledWith({
        where: { teamId: 'team-1', organizationId: 'org-1' },
        select: { roleId: true },
      });
      expect(mockPrisma.memberRole.findFirst).toHaveBeenCalledTimes(2);
      expect(mockPrisma.memberRole.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.memberRole.create).toHaveBeenCalledWith({
        data: {
          member: { connect: { id: 'member-1' } },
          role: { connect: { id: 'role-1' } },
          organization: { connect: { id: 'org-1' } },
        },
      });
      expect(mockPrisma.memberRole.create).toHaveBeenCalledWith({
        data: {
          member: { connect: { id: 'member-1' } },
          role: { connect: { id: 'role-2' } },
          organization: { connect: { id: 'org-1' } },
        },
      });
    });

    it('skips role assignment if member is not found', async () => {
      mockPrisma.member.findFirst.mockResolvedValue(null);

      await db.teamMember.create(mockArgs);

      expect(mockPrisma.teamRole.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('skips assigning roles that are already assigned', async () => {
      mockPrisma.member.findFirst.mockResolvedValue({ id: 'member-1' });
      mockPrisma.teamRole.findMany.mockResolvedValue([{ roleId: 'role-1' }]);
      mockPrisma.memberRole.findFirst.mockResolvedValue({ id: 'existing-mr' });

      await db.teamMember.create(mockArgs);

      expect(mockPrisma.memberRole.findFirst).toHaveBeenCalledWith({
        where: { memberId: 'member-1', roleId: 'role-1' },
      });
      expect(mockPrisma.memberRole.create).not.toHaveBeenCalled();
    });

    it('does nothing if teamId, userId, or organizationId is missing', async () => {
      await db.teamMember.create({ data: { teamId: 'team-1' } });
      expect(mockPrisma.member.findFirst).not.toHaveBeenCalled();
    });

    it('does nothing if team has no roles', async () => {
      mockPrisma.member.findFirst.mockResolvedValue({ id: 'member-1' });
      mockPrisma.teamRole.findMany.mockResolvedValue([]);

      await db.teamMember.create(mockArgs);

      expect(mockPrisma.memberRole.create).not.toHaveBeenCalled();
    });
  });

  describe('singleton pattern', () => {
    it('caches the prisma instance in globalThis during non-production environments', async () => {
      // The beforeEach already imports @/lib/db, which evaluates the module and sets globalThis.prisma
      const instance1 = db;
      
      // Subsequent imports use Vitest's module cache, returning the same instance
      const module2 = await import('@/lib/db');
      const instance2 = module2.default;
      
      expect(instance1).toBe(instance2);
      expect((globalThis as any).prisma).toBe(instance1);
    });
  });
});

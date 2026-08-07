/**
 * UserService — Full CRUD for the User model.
 *
 * Model locality: Global (non-org-scoped). Uses globalDb for all queries.
 * Tenant Admin access is enforced by filtering through the Member join table
 * (i.e., a Tenant Admin can only see/manage users who are members of their org).
 */

import { Prisma } from '@prisma/client';
import globalDb from '@/lib/global-db';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ForbiddenError, ValidationError } from '@/lib/services/types';
import { requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, UserFilters } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreateUserInput {
  email: string;
  name: string;
  password?: string;
  organizationId?: string;
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const UserService = {
  /**
   * Create a new user.
   * Platform Admin: global creation. Tenant Admin: create + add to own org via Member join.
   */
  async create(data: CreateUserInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const { email, name } = data;

    // Validate required fields
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!name) {
      throw new ValidationError('Name is required');
    }

    // Check for duplicate email
    const existing = await globalDb.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error('A user with this email already exists');
    }

    const user = await globalDb.user.create({
      data: { email, name },
    });

    // Tenant Admin creates a Member relationship for their own org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      await globalDb.member.create({
        data: { userId: user.id, orgId: ctx.organizationId, role: 'member' },
      });
    }

    // Platform Admin can optionally assign the user to a specific org
    if (ctx.role === 'PLATFORM_ADMIN' && ctx.organizationId) {
      await globalDb.member.create({
        data: { userId: user.id, orgId: ctx.organizationId, role: 'member' },
      });
    }

    logger.info(
      { userId: ctx.userId, createdUserId: user.id, method: 'UserService.create' },
      'User created',
    );

    return user;
  },

  /**
   * Retrieve a single user by ID.
   * Platform Admin: any user. Tenant Admin: own org members only (via Member join).
   */
  async getById(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const user = await globalDb.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only access users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await globalDb.member.findFirst({
        where: { userId: id, orgId: ctx.organizationId },
      });
      if (!member) {
        logFailedAuth(ctx, 'getById');
        throw new ForbiddenError('Cannot access users outside your organization');
      }
    }

    return user;
  },

  /**
   * Paginated list of users with optional filtering.
   * Platform Admin: all users. Tenant Admin: own org members only (via Member join).
   */
  async list(filters: UserFilters = {}, paginationInput: { page?: number; pageSize?: number } = {}, ctx: ServiceContext): Promise<PaginatedResult<Prisma.UserGetPayload<{ include: { _count: { select: { members: true } } } }>>> {
    requireAnyAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.UserWhereInput = {};
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    // Tenant Admin scope: only members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      where.members = {
        some: { orgId: ctx.organizationId },
      };

      // Apply role filter within the org context
      if (filters.role) {
        where.members = {
          ...where.members,
          some: { orgId: ctx.organizationId, role: filters.role },
        };
      }
    }

    // Platform Admin scope: filter by organization, role, or both
    if (ctx.role === 'PLATFORM_ADMIN') {
      const memberWhere: Prisma.MemberWhereInput = {};

      if (filters.organizationId) {
        memberWhere.orgId = filters.organizationId;
      }
      if (filters.role) {
        memberWhere.role = filters.role;
      }

      const matchingMembers = await globalDb.member.findMany({
        where: memberWhere,
        select: { userId: true },
      });
      const userIds = matchingMembers.map((m) => m.userId);

      if (userIds.length > 0) {
        where.id = { in: userIds };
      } else {
        // No users match the filter(s) — return empty
        where.id = { in: [] };
      }
    }

    const [users, total] = await Promise.all([
      globalDb.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true } },
          members: { take: 1, include: { organization: { select: { id: true, name: true } } } },
        },
      }),
      globalDb.user.count({ where }),
    ]);

    return {
      items: users,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a user.
   * Platform Admin: any user. Tenant Admin: own org members only.
   */
  async update(id: string, data: UpdateUserInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify user exists first
    const existingUser = await globalDb.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only update users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await globalDb.member.findFirst({
        where: { userId: id, orgId: ctx.organizationId },
      });
      if (!member) {
        logFailedAuth(ctx, 'update');
        throw new ForbiddenError('Cannot update users outside your organization');
      }
    }

    // Validate email uniqueness if changing
    if (data.email && data.email !== existingUser.email) {
      const emailExists = await globalDb.user.findUnique({ where: { email: data.email } });
      if (emailExists) {
        throw new Error('A user with this email already exists');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.UserUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;

    const updatedUser = await globalDb.user.update({
      where: { id },
      data: updateData,
    });

    logger.info(
      { userId: ctx.userId, targetUserId: id, method: 'UserService.update' },
      'User updated',
    );

    return updatedUser;
  },

  /**
   * Delete a user.
   * Platform Admin: any user. Tenant Admin: own org members only (removes Member relationship first).
   */
  async delete(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify user exists first
    const existingUser = await globalDb.user.findUnique({ where: { id } });
    if (!existingUser) {
      throw new NotFoundError('User not found');
    }

    // Tenant Admin can only delete users who are members of their org
    if (ctx.role === 'TENANT_ADMIN' && ctx.organizationId) {
      const member = await globalDb.member.findFirst({
        where: { userId: id, orgId: ctx.organizationId },
      });
      if (!member) {
        logFailedAuth(ctx, 'delete');
        throw new ForbiddenError('Cannot delete users outside your organization');
      }

      // Remove Member relationship first (User is global, so we can't cascade delete)
      await globalDb.member.deleteMany({ where: { userId: id } });
    }

    // Hard delete — cascading deletes handled by Prisma onDelete: Cascade relations
    await globalDb.user.delete({ where: { id } });

    logger.info(
      { userId: ctx.userId, targetUserId: id, method: 'UserService.delete' },
      'User deleted',
    );

    return { success: true };
  },
};

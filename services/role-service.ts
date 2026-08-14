/**
 * RoleService — Full CRUD for the Role model.
 *
 * Model locality: Org-scoped (organizationId required). Uses tenantDb within a tenant context.
 * All methods take an explicit `targetOrgId` parameter (never derived from ctx.organizationId,
 * because a Platform Admin's ctx org is the Platform org, not the target).
 *
 * Redis cache invalidation: Every update() and delete() call invalidates the Redis permission cache.
 */

import { Prisma } from '@prisma/client';
import globalDb from '@/lib/global-db';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ForbiddenError, ConflictError, ValidationError } from '@/lib/services/types';
import { requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, RoleFilters } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreateRoleInput {
  name: string;
  description?: string;
  isDefault?: boolean;
  organizationId?: string;
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
  organizationId?: string;
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const RoleService = {
  /**
   * Create a role in the specified organization.
   */
  async create(data: CreateRoleInput, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only create roles in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (targetOrgId !== ctx.organizationId) {
        logFailedAuth(ctx, 'create');
        throw new ForbiddenError('Cannot create roles outside your organization');
      }
    }

    // Validate required fields
    if (!data.name) {
      throw new ValidationError('Role name is required');
    }

    // Check for duplicate name within the org
    const existingRole = await globalDb.role.findFirst({
      where: { name: data.name, organizationId: targetOrgId },
    });
    if (existingRole) {
      throw new ConflictError('A role with this name already exists in this organization');
    }

    const role = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.create({
        data: {
          name: data.name,
          description: data.description || '',
          organizationId: targetOrgId,
          isDefault: data.isDefault ?? false,
        },
      });
    });

    logger.info(
      { userId: ctx.userId, orgId: targetOrgId, roleId: role.id, method: 'RoleService.create' },
      'Role created',
    );

    return role;
  },

  /**
   * Retrieve a single role by ID (scoped to the target org).
   */
  async getById(id: string, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only access roles in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (targetOrgId !== ctx.organizationId) {
        logFailedAuth(ctx, 'getById');
        throw new ForbiddenError('Cannot access roles outside your organization');
      }
    }

    const role = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.findUnique({
        where: { id },
        include: {
          permissions: { include: { permission: true } },
          _count: { select: { memberRoles: true } },
        },
      });
    });

    if (!role) {
      throw new NotFoundError('Role not found');
    }

    return role;
  },

  /**
   * Paginated list of roles within the target organization.
   */
  async list(targetOrgId: string, filters: RoleFilters = {}, paginationInput: { page?: number; pageSize?: number } = {}, ctx: ServiceContext): Promise<PaginatedResult<Prisma.RoleGetPayload<{ include: { _count: { select: { memberRoles: true } } } }>>> {
    requireAnyAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Tenant Admin can only list roles in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (targetOrgId !== ctx.organizationId) {
        logFailedAuth(ctx, 'list');
        throw new ForbiddenError('Cannot access roles outside your organization');
      }
    }

    // Build where clause
    const where: Prisma.RoleWhereInput = { organizationId: targetOrgId };

    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    if (filters.isDefault !== undefined) {
      where.isDefault = filters.isDefault;
    }

    const roles = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { memberRoles: true } } },
      });
    });

    const total = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.count({ where });
    });

    return {
      items: roles,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a role (name, description; isDefault). Invalidates Redis cache.
   */
  async update(id: string, data: UpdateRoleInput, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only update roles in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (targetOrgId !== ctx.organizationId) {
        logFailedAuth(ctx, 'update');
        throw new ForbiddenError('Cannot update roles outside your organization');
      }
    }

    // Verify role exists first
    const existingRole = await globalDb.role.findUnique({ where: { id } });
    if (!existingRole) {
      throw new NotFoundError('Role not found');
    }

    // Validate name uniqueness if changing
    if (data.name && data.name !== existingRole.name) {
      const duplicate = await globalDb.role.findFirst({
        where: { name: data.name, organizationId: targetOrgId },
      });
      if (duplicate) {
        throw new ConflictError('A role with this name already exists in this organization');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.RoleUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    const updatedRole = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.update({ where: { id }, data: updateData });
    });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    logger.info(
      { userId: ctx.userId, orgId: targetOrgId, roleId: id, method: 'RoleService.update' },
      'Role updated',
    );

    return updatedRole;
  },

  /**
   * Delete a role with safety check. Invalidates Redis cache.
   */
  async delete(id: string, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Tenant Admin can only delete roles in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (targetOrgId !== ctx.organizationId) {
        logFailedAuth(ctx, 'delete');
        throw new ForbiddenError('Cannot delete roles outside your organization');
      }
    }

    // Verify role exists first
    const existingRole = await globalDb.role.findUnique({ where: { id } });
    if (!existingRole) {
      throw new NotFoundError('Role not found');
    }

    // Safety check: cannot delete role with assigned members
    const memberRoleCount = await runWithTenant(targetOrgId, async () => {
      return tenantDb.memberRole.count({ where: { roleId: id } });
    });

    if (memberRoleCount > 0) {
      throw new ConflictError('Cannot delete role with assigned members');
    }

    await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.delete({ where: { id } });
    });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    logger.info(
      { userId: ctx.userId, orgId: targetOrgId, roleId: id, method: 'RoleService.delete' },
      'Role deleted',
    );

    return { success: true };
  },

  /**
   * Get permissions assigned to a role.
   */
  async getRolePermissions(roleId: string, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const role = await runWithTenant(targetOrgId, async () => {
      return tenantDb.role.findUnique({
        where: { id: roleId },
        include: {
          permissions: { include: { permission: true } },
        },
      });
    });

    if (!role) {
      throw new NotFoundError('Role not found');
    }

    return role.permissions.map((rp) => rp.permission);
  },

  /**
   * Assign a permission to a role. Invalidates Redis cache.
   */
  async assignPermission(roleId: string, targetOrgId: string, data: { permissionId: string }, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify role exists
    const existingRole = await globalDb.role.findUnique({ where: { id: roleId } });
    if (!existingRole) {
      throw new NotFoundError('Role not found');
    }

    // Verify permission exists
    const existingPermission = await globalDb.permission.findUnique({ where: { id: data.permissionId } });
    if (!existingPermission) {
      throw new NotFoundError('Permission not found');
    }

    // Check for duplicate assignment
    const existing = await globalDb.rolePermission.findFirst({
      where: { roleId, permissionId: data.permissionId },
    });

    if (existing) {
      throw new ConflictError('Permission already assigned to this role');
    }

    await runWithTenant(targetOrgId, async () => {
      return tenantDb.rolePermission.create({
        data: { roleId, permissionId: data.permissionId, organizationId: targetOrgId },
      });
    });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    return { success: true };
  },

  /**
   * Revoke a permission from a role. Invalidates Redis cache.
   */
  async revokePermission(roleId: string, targetOrgId: string, permissionId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    await runWithTenant(targetOrgId, async () => {
      return tenantDb.rolePermission.deleteMany({
        where: { roleId, permissionId },
      });
    });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    return { success: true };
  },

  /**
   * Get members assigned to a role.
   */
  async getRoleMembers(roleId: string, targetOrgId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const members = await runWithTenant(targetOrgId, async () => {
      return tenantDb.memberRole.findMany({
        where: { roleId },
        include: {
          member: {
            include: {
              user: { select: { id: true, name: true, email: true } },
            },
          },
        },
      });
    });

    return members.map((mr) => ({
      memberId: mr.member.id,
      userId: mr.member.userId,
      userName: mr.member.user.name,
      userEmail: mr.member.user.email,
    }));
  },
};

/**
 * Invalidate the Redis permission cache for all organizations.
 * Called after Role mutations to prevent stale cached permissions.
 */
async function invalidatePermissionCache(): Promise<void> {
  try {
    const { getRedis } = await import('@/lib/redis');
    const redis = getRedis();
    if (!redis) return;

    // Invalidate all permission cache keys using SCAN
    const pattern = 'perm:*';
    let cursor = '0';

    do {
      const result = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = String(result[0]);
      const matchedKeys = result[1];

      if (matchedKeys.length > 0) {
        await redis.del(...matchedKeys);

        // Also evict from L1 cache on this instance
        const { invalidate } = await import('@/lib/cache/lru');
        for (const key of matchedKeys) {
          invalidate(key);
        }
      }
    } while (cursor !== '0');

    logger.debug({ method: 'RoleService.invalidatePermissionCache' }, 'Permission cache invalidated');
  } catch (error) {
    logger.error({ err: error, method: 'RoleService.invalidatePermissionCache' }, 'Failed to invalidate permission cache');
  }
}

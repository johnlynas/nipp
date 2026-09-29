/**
 * PermissionService — Full CRUD for the Permission model.
 *
 * Model locality: Global (non-org-scoped). Uses tenantDb for all queries.
 * Redis cache is invalidated on every update() and delete() call to prevent
 * stale cached permissions (security gap: up to 5 min without invalidation).
 */

import { Prisma } from '@prisma/client';
// RLS plan Phase 3: Permission/RolePermission are not in tenantDb's scoped model list —
// pass-through swap removes the unscoped-client bypass without changing query behavior.
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ConflictError, ValidationError } from '@/lib/services/types';
import { requirePlatformAdmin, requireAnyAdmin } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, PermissionFilters } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreatePermissionInput {
  key: string;
  resource: string;
  action: string;
  description?: string;
  isDefault?: boolean;
}

export interface UpdatePermissionInput {
  key?: string;
  resource?: string;
  action?: string;
  description?: string;
  isDefault?: boolean;
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const PermissionService = {
  /**
   * Create a new global permission. Platform Admin only.
   */
  async create(data: CreatePermissionInput, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    const { key, resource, action } = data;

    // Validate required fields
    if (!key) {
      throw new ValidationError('Permission key is required');
    }
    if (!resource) {
      throw new ValidationError('Resource is required');
    }
    if (!action) {
      throw new ValidationError('Action is required');
    }

    // Check for duplicate key
    const existing = await tenantDb.permission.findUnique({ where: { key } });
    if (existing) {
      throw new ConflictError('A permission with this key already exists');
    }

    const permission = await tenantDb.permission.create({
      data: { key, resource, action, description: data.description || '', isDefault: data.isDefault ?? false },
    });

    logger.info(
      { userId: ctx.userId, permissionId: permission.id, method: 'PermissionService.create' },
      'Permission created',
    );

    return permission;
  },

  /**
   * Retrieve a single permission by ID. Read-only for Tenant Admin.
   */
  async getById(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const permission = await tenantDb.permission.findUnique({ where: { id } });
    if (!permission) {
      throw new NotFoundError('Permission not found');
    }

    return permission;
  },

  /**
   * Paginated list of the global permission catalog. Read-only for Tenant Admin.
   */
  async list(filters: PermissionFilters = {}, paginationInput: { page?: number; pageSize?: number } = {}, ctx: ServiceContext): Promise<PaginatedResult<Prisma.PermissionGetPayload<object>>> {
    requireAnyAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.PermissionWhereInput = {};

    if (filters.search) {
      where.OR = [
        { key: { contains: filters.search, mode: 'insensitive' } },
        { resource: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.resource) {
      where.resource = filters.resource;
    }

    if (filters.isDefault !== undefined) {
      where.isDefault = filters.isDefault;
    }

    const [permissions, total] = await Promise.all([
      tenantDb.permission.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ isDefault: 'desc' }, { resource: 'asc' }, { action: 'asc' }],
      }),
      tenantDb.permission.count({ where }),
    ]);

    return {
      items: permissions,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a permission (key, resource, action, description). Platform Admin only.
   * Invalidates Redis cache after successful update.
   */
  async update(id: string, data: UpdatePermissionInput, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    // Verify permission exists first
    const existingPermission = await tenantDb.permission.findUnique({ where: { id } });
    if (!existingPermission) {
      throw new NotFoundError('Permission not found');
    }

    // Validate key uniqueness if changing
    if (data.key && data.key !== existingPermission.key) {
      const keyExists = await tenantDb.permission.findUnique({ where: { key: data.key } });
      if (keyExists) {
        throw new ConflictError('A permission with this key already exists');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.PermissionUpdateInput = {};
    if (data.key !== undefined) updateData.key = data.key;
    if (data.resource !== undefined) updateData.resource = data.resource;
    if (data.action !== undefined) updateData.action = data.action;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.isDefault !== undefined) updateData.isDefault = data.isDefault;

    const updatedPermission = await tenantDb.permission.update({
      where: { id },
      data: updateData,
    });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    logger.info(
      { userId: ctx.userId, permissionId: id, method: 'PermissionService.update' },
      'Permission updated',
    );

    return updatedPermission;
  },

  /**
   * Delete a permission with safety check. Platform Admin only.
   * Invalidates Redis cache after successful delete.
   */
  async delete(id: string, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    // Verify permission exists first
    const existingPermission = await tenantDb.permission.findUnique({ where: { id } });
    if (!existingPermission) {
      throw new NotFoundError('Permission not found');
    }

    // Safety check: cannot delete permission assigned to any role
    const rolePermissionCount = await tenantDb.rolePermission.count({
      where: { permissionId: id },
    });

    if (rolePermissionCount > 0) {
      logger.warn(
        { userId: ctx.userId, permissionId: id, rolePermissionCount, method: 'PermissionService.delete' },
        'Cannot delete permission assigned to roles',
      );
      throw new ConflictError('Cannot delete permission assigned to roles — remove the assignments first');
    }

    // Safety check: cannot delete default (bootstrapped) permissions
    if (existingPermission.isDefault) {
      logger.warn(
        { userId: ctx.userId, permissionId: id, method: 'PermissionService.delete' },
        'Cannot delete default permission',
      );
      throw new ConflictError('Cannot delete a default (bootstrapped) permission');
    }

    await tenantDb.permission.delete({ where: { id } });

    // Invalidate Redis permission cache after mutation
    await invalidatePermissionCache();

    logger.info(
      { userId: ctx.userId, permissionId: id, method: 'PermissionService.delete' },
      'Permission deleted',
    );

    return { success: true };
  },
};

/**
 * Invalidate the Redis permission cache for all organizations.
 * Called after Permission mutations to prevent stale cached permissions (security gap).
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

    logger.debug({ method: 'PermissionService.invalidatePermissionCache' }, 'Permission cache invalidated');
  } catch (error) {
    logger.error({ err: error, method: 'PermissionService.invalidatePermissionCache' }, 'Failed to invalidate permission cache');
  }
}

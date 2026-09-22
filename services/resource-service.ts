/**
 * ResourceService — Full CRUD for the Resource model.
 *
 * Model locality: Global (non-org-scoped). Uses tenantDb for all queries.
 */

import { Prisma } from '@prisma/client';
// RLS plan Phase 3: Resource/ResourceRole are non-org-scoped (platform resource catalog) —
// pass-through swap removes the unscoped-client bypass.
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ConflictError, ValidationError } from '@/lib/services/types';
import { requirePlatformAdmin } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, BaseFilters } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

export interface CreateResourceInput {
  name: string;
  description?: string;
  roleIds?: string[];
}

export interface UpdateResourceInput {
  name?: string;
  description?: string;
  roleIds?: string[];
}

// Resource filters — inherits search from BaseFilters
export type ResourceFilters = BaseFilters;

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const ResourceService = {
  /**
   * Create a new global resource with optional role assignments. Platform Admin only.
   */
  async create(data: CreateResourceInput, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    const { name, description, roleIds } = data;

    // Validate required fields
    if (!name || name.trim() === '') {
      throw new ValidationError('Resource name is required');
    }

    // Check for duplicate name (case-insensitive)
    const existing = await tenantDb.resource.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictError(`A resource with the name "${name}" already exists`);
    }

    // Create resource and optionally assign roles in a transaction
    const resource = await tenantDb.$transaction(async (tx) => {
      const created = await tx.resource.create({
        data: { name: name.trim(), description: description || '' },
      });

      if (roleIds && roleIds.length > 0) {
        await Promise.all(
          roleIds.map((roleId) =>
            tx.resourceRole.create({
              data: { resourceId: created.id, roleId },
            }),
          ),
        );
      }

      return created;
    });

    logger.info(
      { userId: ctx.userId, resourceId: resource.id, method: 'ResourceService.create' },
      'Resource created',
    );

    return resource;
  },

  /**
   * Retrieve a single resource by ID with assigned roles. Platform Admin only.
   */
  async getById(id: string, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    const resource = await tenantDb.resource.findUnique({
      where: { id },
      include: { resourceRoles: { include: { role: true } } },
    });

    if (!resource) {
      throw new NotFoundError('Resource not found');
    }

    return resource;
  },

  /**
   * Paginated list of resources with optional search by name. Platform Admin only.
   */
  async list(filters: ResourceFilters = {}, paginationInput: { page?: number; pageSize?: number } = {}, ctx: ServiceContext): Promise<PaginatedResult<Prisma.ResourceGetPayload<{ include: { resourceRoles: { include: { role: true } } } }>>> {
    requirePlatformAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Build where clause
    const where: Prisma.ResourceWhereInput = {};

    if (filters.search) {
      where.name = { contains: filters.search, mode: 'insensitive' };
    }

    const [resources, total] = await Promise.all([
      tenantDb.resource.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: { resourceRoles: { include: { role: true } } },
      }),
      tenantDb.resource.count({ where }),
    ]);

    return {
      items: resources,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a resource (name, description) and optionally replace role assignments. Platform Admin only.
   */
  async update(id: string, data: UpdateResourceInput, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    // Verify resource exists first
    const existingResource = await tenantDb.resource.findUnique({ where: { id } });
    if (!existingResource) {
      throw new NotFoundError('Resource not found');
    }

    // Validate name uniqueness if changing (trim first)
    const trimmedName = data.name?.trim();
    if (trimmedName && trimmedName !== existingResource.name) {
      const nameExists = await tenantDb.resource.findFirst({
        where: {
          name: { equals: trimmedName, mode: 'insensitive' },
          id: { not: id },
        },
      });
      if (nameExists) {
        throw new ConflictError(`A resource with the name "${trimmedName}" already exists`);
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.ResourceUpdateInput = {};
    if (data.name !== undefined) updateData.name = data.name.trim();
    if (data.description !== undefined) updateData.description = data.description;

    // Use transaction for atomic role replacement if roleIds provided
    const updatedResource = await tenantDb.$transaction(async (tx) => {
      if (data.roleIds !== undefined) {
        // Delete all existing role assignments
        await tx.resourceRole.deleteMany({ where: { resourceId: id } });

        // Create new role assignments
        if (data.roleIds.length > 0) {
          await Promise.all(
            data.roleIds.map((roleId) =>
              tx.resourceRole.create({
                data: { resourceId: id, roleId },
              }),
            ),
          );
        }
      }

      return tx.resource.update({ where: { id }, data: updateData });
    });

    logger.info(
      { userId: ctx.userId, resourceId: id, method: 'ResourceService.update' },
      'Resource updated',
    );

    return updatedResource;
  },

  /**
   * Delete a resource with safety check. Platform Admin only.
   */
  async delete(id: string, ctx: ServiceContext) {
    requirePlatformAdmin(ctx);

    // Verify resource exists first
    const existingResource = await tenantDb.resource.findUnique({ where: { id } });
    if (!existingResource) {
      throw new NotFoundError('Resource not found');
    }

    // Safety check: cannot delete resource with assigned roles
    const roleCount = await tenantDb.resourceRole.count({ where: { resourceId: id } });

    if (roleCount > 0) {
      throw new ConflictError('Cannot delete resource with assigned roles');
    }

    await tenantDb.resource.delete({ where: { id } });

    logger.info(
      { userId: ctx.userId, resourceId: id, method: 'ResourceService.delete' },
      'Resource deleted',
    );

    return { success: true };
  },
};

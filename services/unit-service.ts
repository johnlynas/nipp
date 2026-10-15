/**
 * UnitService — Business logic for Units (org-scoped properties) CRUD.
 *
 * Follows the established service layer pattern:
 * - Input types for all operations
 * - Authorization guards (requireAnyAdmin; TENANT_ADMIN restricted to own org)
 * - Typed error classes (ValidationError, NotFoundError, ConflictError, ForbiddenError)
 * - Audit logging for all mutations
 *
 * RLS plan Phase 3: Units is a tenant-scoped model (TENANT_SCOPED_MODELS).
 * All queries run through tenantDb; operations are wrapped in
 * runWithTenant(targetOrgId) so the Prisma extension resolves a context.
 * Per-ID lookups without an explicit target fall back to the caller's ctx
 * org — with the env-derived platform org as last resort (super-admin paths).
 */

import { Prisma } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { runWithTenant } from '@/lib/tenant-context';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';
import { recordAuditLog } from '@/lib/audit-log';
import { ServiceContext, ValidationError, NotFoundError, ForbiddenError } from '@/lib/services/types';
import { requireAnyAdmin, logFailedAuth } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input / Output Types
// ---------------------------------------------------------------------------

/** Valid unit type values (mirrors the Prisma UnitType enum). */
export const UNIT_TYPES = ['HOUSE', 'APARTMENT', 'OTHER'] as const;
export type UnitTypeValue = (typeof UNIT_TYPES)[number];

export interface CreateUnitInput {
  owner: string;
  address: string;
  postCode: string;
  email: string;
  phone: string;
  rented?: boolean;
  type?: UnitTypeValue;
}

export interface UpdateUnitInput {
  owner?: string;
  address?: string;
  postCode?: string;
  email?: string;
  phone?: string;
  rented?: boolean;
  type?: UnitTypeValue;
}

/** Unit data returned by service methods. */
export type UnitData = Prisma.UnitsGetPayload<{ include: { organization: { select: { id: true; name: true } } } }>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Context org for a service call: caller's org, platform org as fallback. */
function contextOrgId(ctx: ServiceContext): string {
  return ctx.organizationId ?? env.PLATFORM_ORGANIZATION_ID!;
}

/** Validate an optional UnitType value. */
function validateType(type: UnitTypeValue | undefined): void {
  if (type !== undefined && !UNIT_TYPES.includes(type)) {
    throw new ValidationError(`Unit type must be one of: ${UNIT_TYPES.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

/**
 * Service responsible for managing Units (properties) business logic.
 * Decouples API routes from direct Prisma database operations.
 */
export const UnitService = {
  /**
   * Create a new unit within an organization.
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async createUnit(input: CreateUnitInput, organizationId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    if (!organizationId) {
      throw new ValidationError('Unit organization is required');
    }

    // Tenant Admin can only create in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'createUnit');
        throw new ForbiddenError('Cannot create units outside your organization');
      }
    }

    if (!input.owner || input.owner.trim().length === 0) {
      throw new ValidationError('Unit owner is required');
    }
    if (input.owner.length > 100) {
      throw new ValidationError('Unit owner must be at most 100 characters');
    }
    if (!input.address || input.address.trim().length === 0) {
      throw new ValidationError('Unit address is required');
    }
    if (input.address.length > 255) {
      throw new ValidationError('Unit address must be at most 255 characters');
    }
    if (!input.postCode || input.postCode.trim().length === 0) {
      throw new ValidationError('Post code is required');
    }
    if (input.postCode.length > 32) {
      throw new ValidationError('Post code must be at most 32 characters');
    }
    if (!input.email || input.email.trim().length === 0) {
      throw new ValidationError('Email is required');
    }
    if (input.email.length > 100) {
      throw new ValidationError('Email must be at most 100 characters');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new ValidationError('Email must be a valid email address');
    }
    if (!input.phone || input.phone.trim().length === 0) {
      throw new ValidationError('Phone is required');
    }
    if (input.phone.length > 32) {
      throw new ValidationError('Phone must be at most 32 characters');
    }
    validateType(input.type);

    const unit = await runWithTenant(organizationId, async () =>
      tenantDb.units.create({
        data: {
          organizationId,
          owner: input.owner.trim(),
          address: input.address.trim(),
          postCode: input.postCode.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
          ...(input.rented !== undefined ? { rented: input.rented } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
        },
      }),
    );

    logger.info({ unitId: unit.unitId, orgId: organizationId, method: 'UnitService.createUnit' }, 'Unit created');

    await recordAuditLog({
      userId: ctx.userId,
      action: 'unit.created',
      resourceType: 'Units',
      resourceId: unit.unitId,
      organizationId,
      success: true,
      metadata: { address: unit.address },
    });

    return unit;
  },

  /**
   * Retrieve a single unit by ID (with its organization).
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async getUnitById(unitId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // No tenant context in scope — force the platform context so a
    // super-admin per-ID lookup is possible; TENANT_ADMIN reads fall through
    // to RLS (their own org only) and land below on the ownership check.
    return runWithTenant(contextOrgId(ctx), async () => {
      const unit = await tenantDb.units.findUnique({
        where: { unitId },
        include: { organization: { select: { id: true, name: true } } },
      });

      if (!unit) {
        throw new NotFoundError('Unit not found');
      }

      // Tenant Admin can only read units in their own org
      if (ctx.role === 'TENANT_ADMIN' && unit.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'getUnitById');
        throw new ForbiddenError('Cannot access units outside your organization');
      }

      return unit;
    });
  },

  /**
   * List all units in an organization (paginated), with optional search.
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async getUnitsByOrg(
    organizationId: string,
    ctx: ServiceContext,
    page = 1,
    pageSize = 20,
    search?: string,
    rented?: boolean,
    type?: UnitTypeValue,
  ): Promise<PaginatedResult<UnitData>> {
    requireAnyAdmin(ctx);

    if (ctx.role === 'TENANT_ADMIN' && organizationId !== ctx.organizationId) {
      logFailedAuth(ctx, 'getUnitsByOrg');
      throw new ForbiddenError('Cannot access units outside your organization');
    }

    const { page: normalizedPage, pageSize: normalizedPageSize } = normalizePagination({ page, pageSize });
    const skip = (normalizedPage - 1) * normalizedPageSize;

    validateType(type);

    // No special where for scoping: organizationId is explicit and the tenant
    // context (runWithTenant) resolves the app-layer/RLS enforcement, exactly
    // like TeamService.getTeamsByOrg. Cross-org (all-orgs) listings loop per
    // org at the route layer (see admin teams GET).
    return runWithTenant(organizationId, async () => {
      // Search over owner / address / post code / email / phone.
      const where: Prisma.UnitsWhereInput = { organizationId };
      if (search) {
        const q = search.trim();
        where.OR = [
          { owner: { contains: q, mode: 'insensitive' } },
          { address: { contains: q, mode: 'insensitive' } },
          { postCode: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone: { contains: q, mode: 'insensitive' } },
        ];
      }
      if (rented !== undefined) where.rented = rented;
      if (type !== undefined) where.type = type;

      const [units, total] = await Promise.all([
        tenantDb.units.findMany({
          where,
          skip,
          take: normalizedPageSize,
          orderBy: { createdAt: 'desc' },
          include: { organization: { select: { id: true, name: true } } },
        }),
        tenantDb.units.count({ where }),
      ]);

      return {
        items: units,
        pagination: {
          page: normalizedPage,
          pageSize: normalizedPageSize,
          total,
          totalPages: Math.ceil(total / normalizedPageSize),
        },
      };
    });
  },

  /**
   * Update a unit's fields (owner, address, postCode, rented, type).
   * Platform Admin: any org. Tenant Admin: own org only.
   */
  async updateUnit(unitId: string, input: UpdateUnitInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const existing = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.units.findUnique({ where: { unitId } }),
    );
    if (!existing) {
      throw new NotFoundError('Unit not found');
    }

    // Tenant Admin can only update units in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (existing.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'updateUnit');
        throw new ForbiddenError('Cannot update units outside your organization');
      }
    }

    // Build update data — only include provided fields
    const updateData: Prisma.UnitsUpdateInput = {};
    if (input.owner !== undefined) {
      if (input.owner.trim().length === 0) throw new ValidationError('Unit owner cannot be empty');
      if (input.owner.length > 100) throw new ValidationError('Unit owner must be at most 100 characters');
      updateData.owner = input.owner.trim();
    }
    if (input.address !== undefined) {
      if (input.address.trim().length === 0) throw new ValidationError('Address cannot be empty');
      if (input.address.length > 255) throw new ValidationError('Address must be at most 255 characters');
      updateData.address = input.address.trim();
    }
    if (input.postCode !== undefined) {
      if (input.postCode.trim().length === 0) throw new ValidationError('Post code cannot be empty');
      if (input.postCode.length > 32) throw new ValidationError('Post code must be at most 32 characters');
      updateData.postCode = input.postCode.trim();
    }
    if (input.email !== undefined) {
      if (input.email.trim().length === 0) throw new ValidationError('Email cannot be empty');
      if (input.email.length > 100) throw new ValidationError('Email must be at most 100 characters');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) throw new ValidationError('Email must be a valid email address');
      updateData.email = input.email.trim();
    }
    if (input.phone !== undefined) {
      if (input.phone.trim().length === 0) throw new ValidationError('Phone cannot be empty');
      if (input.phone.length > 32) throw new ValidationError('Phone must be at most 32 characters');
      updateData.phone = input.phone.trim();
    }
    if (input.rented !== undefined) updateData.rented = input.rented;
    validateType(input.type);
    if (input.type !== undefined) updateData.type = input.type;

    const updated = await runWithTenant(existing.organizationId, () =>
      tenantDb.units.update({ where: { unitId }, data: updateData }),
    );

    logger.info({ userId: ctx.userId, unitId, method: 'UnitService.updateUnit' }, 'Unit updated');

    await recordAuditLog({
      userId: ctx.userId,
      action: 'unit.updated',
      resourceType: 'Units',
      resourceId: unitId,
      organizationId: existing.organizationId,
      success: true,
    });

    return updated;
  },

  /**
   * Delete a unit. Platform Admin: any org. Tenant Admin: own org only.
   */
  async deleteUnit(unitId: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const unit = await runWithTenant(contextOrgId(ctx), () =>
      tenantDb.units.findUnique({ where: { unitId } }),
    );
    if (!unit) {
      throw new NotFoundError('Unit not found');
    }

    // Tenant Admin can only delete units in their own org
    if (ctx.role === 'TENANT_ADMIN') {
      if (unit.organizationId !== ctx.organizationId) {
        logFailedAuth(ctx, 'deleteUnit');
        throw new ForbiddenError('Cannot delete units outside your organization');
      }
    }

    await runWithTenant(unit.organizationId, () => tenantDb.units.delete({ where: { unitId } }));

    logger.info({ userId: ctx.userId, unitId, method: 'UnitService.deleteUnit' }, 'Unit deleted');

    await recordAuditLog({
      userId: ctx.userId,
      action: 'unit.deleted',
      resourceType: 'Units',
      resourceId: unitId,
      organizationId: unit.organizationId,
      success: true,
    });

    return { success: true };
  },
};

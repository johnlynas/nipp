/**
 * ContractorService — Full CRUD for the Contractors model.
 *
 * Model locality: Global (non-org-scoped, RLS-exempt). Uses tenantDb for all
 * queries with no runWithTenant wrapper — the table has no organizationId
 * column and no RLS policy by design (see SECURITY.md Appendix B). Any
 * authenticated organization can share any contractor; write gating lives at
 * the route boundary (requireSuperAdmin), as with the other admin routes.
 */

import { Contractors, Prisma } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { ServiceContext, NotFoundError, ValidationError } from '@/lib/services/types';
import { requireAnyAdmin } from '@/lib/services/base-service';
import { normalizePagination, PaginatedResult, BaseFilters } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

/** Valid contractor type values (mirrors the Prisma ContractorType enum). */
export const CONTRACTOR_TYPES = [
  'PAINTER',
  'ELECTRICIAN',
  'PLUMBER',
  'GAS_ENGINEER',
  'LIFT_MAINTENANCE',
  'GARDENER',
  'ACCOUNTANT',
  'FIRE_ALARMS',
  'SOLICITOR',
  'ROOFER',
  'WINDOW_CLEANER',
  'OTHER',
] as const;
export type ContractorTypeValue = (typeof CONTRACTOR_TYPES)[number];

export interface CreateContractorInput {
  companyName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  postCode: string;
  type?: ContractorTypeValue;
  description?: string;
}

export interface UpdateContractorInput {
  companyName?: string;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  postCode?: string;
  type?: ContractorTypeValue;
  description?: string;
}

// Contractor list filters — inherits search from BaseFilters
export type ContractorFilters = BaseFilters & {
  type?: ContractorTypeValue;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Field validation helpers
// ---------------------------------------------------------------------------

function validateRequiredString(value: string | undefined, field: string, maxLen: number): void {
  if (!value || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > maxLen) {
    throw new ValidationError(`${field} must be at most ${maxLen} characters`);
  }
}

function validateEmail(value: string, field = 'Email'): void {
  validateRequiredString(value, field, 100);
  if (!EMAIL_RE.test(value.trim())) {
    throw new ValidationError('Email must be a valid email address');
  }
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

/**
 * Service responsible for managing the global contractor directory.
 * Decouples API routes from direct Prisma database operations.
 */
export const ContractorService = {
  /**
   * Create a new contractor in the global directory.
   */
  async create(data: CreateContractorInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    validateRequiredString(data.companyName, 'Company name', 100);
    validateRequiredString(data.name, 'Name', 100);
    validateEmail(data.email);
    validateRequiredString(data.phone, 'Phone', 32);
    validateRequiredString(data.address, 'Address', 255);
    validateRequiredString(data.postCode, 'Post code', 32);
    if (data.type !== undefined && !CONTRACTOR_TYPES.includes(data.type)) {
      throw new ValidationError(`Type must be one of: ${CONTRACTOR_TYPES.join(', ')}`);
    }

    const contractor = await tenantDb.contractors.create({
      data: {
        companyName: data.companyName.trim(),
        name: data.name.trim(),
        email: data.email.trim(),
        phone: data.phone.trim(),
        address: data.address.trim(),
        postCode: data.postCode.trim(),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.description !== undefined && data.description.trim() !== '' ? { description: data.description.trim() } : {}),
      },
    });

    logger.info(
      { userId: ctx.userId, contractorId: contractor.contractorId, method: 'ContractorService.create' },
      'Contractor created',
    );

    return contractor;
  },

  /**
   * Retrieve a single contractor by ID.
   */
  async getById(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    const contractor = await tenantDb.contractors.findUnique({ where: { contractorId: id } });
    if (!contractor) {
      throw new NotFoundError('Contractor not found');
    }

    return contractor;
  },

  /**
   * Paginated list of contractors with optional search and type filter.
   */
  async list(
    filters: ContractorFilters = {},
    paginationInput: { page?: number; pageSize?: number } = {},
    ctx: ServiceContext,
  ): Promise<PaginatedResult<Contractors>> {
    requireAnyAdmin(ctx);

    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    // Build where clause — search across the identifying fields.
    const where: Prisma.ContractorsWhereInput = {};
    if (filters.search) {
      const q = filters.search.trim();
      // Multi-field case-insensitive search.
      where.OR = [
        { companyName: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { postCode: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (filters.type !== undefined) {
      where.type = filters.type;
    }

    const [contractors, total] = await Promise.all([
      tenantDb.contractors.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      tenantDb.contractors.count({ where }),
    ]);

    return {
      items: contractors,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  },

  /**
   * Update a contractor's fields.
   */
  async update(id: string, data: UpdateContractorInput, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify contractor exists first
    const existing = await tenantDb.contractors.findUnique({ where: { contractorId: id } });
    if (!existing) {
      throw new NotFoundError('Contractor not found');
    }

    // Build update data — only include provided fields (with validation).
    const updateData: Prisma.ContractorsUpdateInput = {};
    if (data.companyName !== undefined) {
      validateRequiredString(data.companyName, 'Company name', 100);
      updateData.companyName = data.companyName.trim();
    }
    if (data.name !== undefined) {
      validateRequiredString(data.name, 'Name', 100);
      updateData.name = data.name.trim();
    }
    if (data.email !== undefined) {
      validateEmail(data.email);
      updateData.email = data.email.trim();
    }
    if (data.phone !== undefined) {
      validateRequiredString(data.phone, 'Phone', 32);
      updateData.phone = data.phone.trim();
    }
    if (data.address !== undefined) {
      validateRequiredString(data.address, 'Address', 255);
      updateData.address = data.address.trim();
    }
    if (data.postCode !== undefined) {
      validateRequiredString(data.postCode, 'Post code', 32);
      updateData.postCode = data.postCode.trim();
    }
    if (data.type !== undefined) {
      if (!CONTRACTOR_TYPES.includes(data.type)) {
        throw new ValidationError(`Type must be one of: ${CONTRACTOR_TYPES.join(', ')}`);
      }
      updateData.type = data.type;
    }
    if (data.description !== undefined) {
      // Empty string clears the optional description.
      updateData.description = data.description.trim() === '' ? null : data.description.trim();
    }

    const updated = await tenantDb.contractors.update({ where: { contractorId: id }, data: updateData });

    logger.info(
      { userId: ctx.userId, contractorId: id, method: 'ContractorService.update' },
      'Contractor updated',
    );

    return updated;
  },

  /**
   * Delete a contractor.
   */
  async delete(id: string, ctx: ServiceContext) {
    requireAnyAdmin(ctx);

    // Verify contractor exists first
    const existing = await tenantDb.contractors.findUnique({ where: { contractorId: id } });
    if (!existing) {
      throw new NotFoundError('Contractor not found');
    }

    await tenantDb.contractors.delete({ where: { contractorId: id } });

    logger.info(
      { userId: ctx.userId, contractorId: id, method: 'ContractorService.delete' },
      'Contractor deleted',
    );

    return { success: true };
  },
};

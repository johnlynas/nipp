/**
 * QuotationService — CRUD on Quotation rows for a work order + contractor.
 *
 * One quote per (workOrderId, contractorId). Filling `price` from null while
 * the work order is OUT_FOR_QUOTES auto-moves it to QUOTES_IN via
 * WorkOrderService.transition (the ONLY automatic hop in the flow — design
 * §State Machine). Deletes are blocked once the work order reaches INVOICED /
 * FINISHED / CLOSED (409 — the record belongs to a decided/completed chain).
 */

import { Prisma, Quotation } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { WorkOrderService } from './work-order-service';
import {
  ServiceContext,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
  PaginatedResult,
  normalizePagination,
} from '@/lib/services/types';

import {
  QUOTE_STATES as SHARED_QUOTE_STATES,
  QUOTABLE_WORK_ORDER_STATES as SHARED_QUOTABLE_WORK_ORDER_STATES,
} from '@/lib/work-order-state';

/** Work order states that may solicit (create) new quotes — re-exported from the
 * dependency-free state lib so client code CAN import these constants WITHOUT
 * pulling this server-only module (Prisma/logger) into its bundle. */
export const QUOTABLE_WORK_ORDER_STATES: readonly string[] = SHARED_QUOTABLE_WORK_ORDER_STATES;
/** Quotation lifecycle — mirrors the Prisma QuotationState enum (single source). */
export const QUOTE_STATES = SHARED_QUOTE_STATES;
/** Work order states after which a quote row is immutable-on-delete (409). */
const DELETE_BLOCKED_STATES: readonly string[] = ['INVOICED', 'FINISHED', 'CLOSED'];

export interface CreateQuotationInput {
  workOrderId: string;
  contractorId: string;
  dueDate: Date;
}

/** Editable quote fields. `price` from null triggers the automatic QUOTES_IN hop. */
export interface UpdateQuotationInput {
  price?: number | string | null;
  description?: string | null;
  quoteLink?: string | null;
}

/** Filters for QuotationService.list (used by both admin + tenant read routes). */
export interface QuotationListFilters {
  organizationId?: string;
  workOrderId?: string;
  contractorId?: string;
  state?: (typeof QUOTE_STATES)[number];
  search?: string;
}

/** Translate filters into a Prisma where clause — shared by list() + route-side count queries. */
export function buildQuotationWhere(filters: QuotationListFilters): Prisma.QuotationWhereInput {
  const where: Prisma.QuotationWhereInput = {};
  if (filters.organizationId !== undefined) where.organizationId = filters.organizationId;
  if (filters.workOrderId !== undefined) where.workOrderId = filters.workOrderId;
  if (filters.contractorId !== undefined) where.contractorId = filters.contractorId;
  if (filters.state !== undefined) {
    if (!(QUOTE_STATES as readonly string[]).includes(filters.state)) {
      throw new ValidationError(`state must be one of: ${QUOTE_STATES.join(', ')}`);
    }
    where.state = filters.state;
  }
  if (filters.search) {
    const q = filters.search.trim();
    where.OR = [
      { contractor: { name: { contains: q, mode: 'insensitive' } } },
      { contractor: { companyName: { contains: q, mode: 'insensitive' } } },
      { workOrder: { description: { contains: q, mode: 'insensitive' } } },
      { description: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
}

// Neutral ctx for read-only parent/consistency lookups: the ROUTE runs under
// the tenant RLS context of this row's org, so RLS decides visibility.
const READ_CTX: ServiceContext = { userId: '', role: 'MEMBER' };

function requireSuperAdminCtx(ctx: ServiceContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: quotation write requires super admin');
    throw new ForbiddenError('Super admin access required');
  }
}

function parsePriceInput(price: number | string): number {
  const value = typeof price === 'string' ? Number(price) : price;
  if (!Number.isFinite(value)) {
    throw new ValidationError('price must be a valid number');
  }
  return value;
}

export const QuotationService = {
  /**
   * Open a quotation row for one contractor of the work order. Super-admin only.
   */
  async create(data: CreateQuotationInput, ctx: ServiceContext): Promise<Quotation> {
    requireSuperAdminCtx(ctx);

    // Parent checks: work order exists (404) and is in a quotable state.
    const workOrder = await WorkOrderService.getById(data.workOrderId, READ_CTX);
    if (!QUOTABLE_WORK_ORDER_STATES.includes(workOrder.state)) {
      throw new ValidationError(`Quotations cannot be opened on a ${workOrder.state} work order`);
    }

    // Contractor must be in the global directory (404 — it is read-only for us).
    const contractor = await tenantDb.contractors.findUnique({ where: { contractorId: data.contractorId } });
    if (!contractor) {
      throw new NotFoundError('Contractor not found in the global directory');
    }

    // Unique per (workOrderId, contractorId).
    const existing = await tenantDb.quotation.findFirst({
      where: { workOrderId: data.workOrderId, contractorId: data.contractorId },
    });
    if (existing) {
      throw new ValidationError('A quotation already exists for this contractor on this work order');
    }

    const quote = await tenantDb.quotation.create({
      data: {
        workOrderId: data.workOrderId,
        contractorId: data.contractorId,
        dueDate: data.dueDate,
        state: 'OPENED',
        organizationId: workOrder.organizationId,
      },
    });

    logger.info(
      { userId: ctx.userId, quoteId: quote.quoteId, workOrderId: data.workOrderId, contractorId: data.contractorId },
      'Quotation opened',
    );
    return quote;
  },

  /**
   * Paginated quote list for admin + tenant read surfaces. Reads only —
   * visibility is decided by the RLS context the route establishes (tenant
   * org for members, platform for super admins), so this method enforces no
   * extra auth. Joins contractor + parent work order (description/state) so
   * one fetch renders the table; search matches contractor name/company,
   * work order description and quote breakdown.
   */
  async list(
    filters: QuotationListFilters = {},
    paginationInput: { page?: number; pageSize?: number } = {},
    _ctx: ServiceContext,
  ): Promise<PaginatedResult<Quotation & { contractor: { name: string; companyName: string }; workOrder: { description: string; state: string } }>> {
    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    const where = buildQuotationWhere(filters);

    const include = { contractor: { select: { name: true, companyName: true } }, workOrder: { select: { description: true, state: true } } };

    const [rows, total] = await Promise.all([
      tenantDb.quotation.findMany({ where, skip, take: pageSize, include, orderBy: { createdAt: 'desc', quoteId: 'asc' } }),
      tenantDb.quotation.count({ where }),
    ]);

    return { items: rows, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  },

  /**
   * Update an OPEN quotation (price / description / quoteLink). Filling price
   * from null while the work order is OUT_FOR_QUOTES auto-advances it to
   * QUOTES_IN via WorkOrderService.transition.
   */
  async update(quoteId: string, data: UpdateQuotationInput, ctx: ServiceContext): Promise<Quotation> {
    requireSuperAdminCtx(ctx);

    const existing = await tenantDb.quotation.findUnique({ where: { quoteId } });
    if (!existing) {
      throw new NotFoundError('Quotation not found');
    }

    // State consistency: only OPEN quotations are editable (accepted/rejected/
    // closed quotes are audit records of a decision).
    if (existing.state !== 'OPENED') {
      throw new ValidationError(`Only OPEN quotations can be updated (this one is ${existing.state})`);
    }

    const updateData: Prisma.QuotationUncheckedUpdateInput = {};

    let priceSetFromNull = false;
    if (data.price !== undefined) {
      if (data.price === null) {
        throw new ValidationError('price cannot be cleared once a quotation has been received');
      }
      const value = parsePriceInput(data.price);
      if (value <= 0) {
        throw new ValidationError('price must be greater than zero');
      }
      if (existing.price === null) priceSetFromNull = true;
      updateData.price = value;
    }
    if (data.description !== undefined) {
      updateData.description = data.description?.trim() || null;
    }
    if (data.quoteLink !== undefined) {
      updateData.quoteLink = data.quoteLink?.trim() || null;
    }
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('No updatable fields provided');
    }

    const updated = await tenantDb.quotation.update({ where: { quoteId }, data: updateData });

    // Automatic hop: first price recorded while OUT_FOR_QUOTES → QUOTES_IN.
    if (priceSetFromNull) {
      const workOrder = await WorkOrderService.getById(existing.workOrderId, READ_CTX);
      if (workOrder.state === 'OUT_FOR_QUOTES') {
        try {
          await WorkOrderService.transition(workOrder.workOrderId, 'QUOTES_IN', {}, ctx);
        } catch (err) {
          // Auto-hop is advisory for the quote update: a concurrent manual hop
          // (or an unexpected state change) must not fail recording the price.
          logger.warn(
            { userId: ctx.userId, quoteId, workOrderId: existing.workOrderId, err },
            'Automatic QUOTES_IN transition after price fill failed (work order may have moved already)',
          );
        }
      }
    }

    logger.info({ userId: ctx.userId, quoteId }, 'Quotation updated');
    return updated;
  },

  /**
   * Delete an OPEN quotation. Blocked once the work order has reached
   * INVOICED / FINISHED / CLOSED (409). Super-admin only.
   */
  async delete(quoteId: string, ctx: ServiceContext): Promise<{ success: boolean }> {
    requireSuperAdminCtx(ctx);

    const existing = await tenantDb.quotation.findUnique({ where: { quoteId } });
    if (!existing) {
      throw new NotFoundError('Quotation not found');
    }

    const workOrder = await WorkOrderService.getById(existing.workOrderId, READ_CTX);
    if (DELETE_BLOCKED_STATES.includes(workOrder.state)) {
      throw new ConflictError(
        `Quotations cannot be deleted while the work order is ${workOrder.state} (delete + recreate by super admin after re-open is not supported in v1)`,
      );
    }

    await tenantDb.quotation.delete({ where: { quoteId } });
    logger.info({ userId: ctx.userId, quoteId }, 'Quotation deleted');
    return { success: true };
  },
};

/**
 * WorkOrderService — full CRUD + state machine for org-scoped work orders.
 *
 * Model locality: tenant-scoped. Every read/write goes through tenantDb so the
 * app-layer extension injects `organizationId` (or passes platform contexts
 * through) and RLS backstops at the DB layer. Writes are super-admin-only
 * (PLATFORM_ADMIN ctx — route boundary already verified the session; see D9).
 *
 * Write-context rule (design §Tenant Isolation): mutation ROUTES wrap this
 * service in a tenant RLS context pinned to the target row's own organizationId
 * (`withRLSContext(tenant ctx)`) — a pure platform-admin context fails closed
 * on the policy `WITH CHECK`, so routes must never call transition/update/etc.
 * under `withPlatformContext` alone.
 */

import { Prisma, WorkOrder, WorkOrderState } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import {
  ServiceContext,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  normalizePagination,
  PaginatedResult,
  BaseFilters,
} from '@/lib/services/types';

// ---------------------------------------------------------------------------
// State machine (single source of truth — services + routes import this;
// Phase 4 frontend imports the serializable WORK_ORDER_TRANSITIONS map)
// ---------------------------------------------------------------------------

/** Valid work order state values — mirrors the Prisma WorkOrderState enum. */
export const WORK_ORDER_STATES = [
  'CREATED',
  'OUT_FOR_QUOTES',
  'QUOTES_IN',
  'CONTRACTOR_ASSIGNED',
  'STARTED',
  'COMPLETE',
  'INVOICED',
  'FINISHED',
  'CLOSED',
] as const;

/** State machine: legal one-hop transitions (design doc §State Machine). */
export const WORK_ORDER_TRANSITIONS: Record<WorkOrderState, WorkOrderState[]> = {
  CREATED: ['OUT_FOR_QUOTES', 'CLOSED'],
  OUT_FOR_QUOTES: ['QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'CLOSED'],
  QUOTES_IN: ['CONTRACTOR_ASSIGNED', 'CLOSED'],
  CONTRACTOR_ASSIGNED: ['STARTED'],
  STARTED: ['COMPLETE'],
  COMPLETE: ['INVOICED'],
  INVOICED: ['FINISHED'],
  FINISHED: [],
  CLOSED: [],
};

const DEFAULT_QUOTES_DUE_DAYS = 7;

// ---------------------------------------------------------------------------
// Email dispatch seam — filled by services/work-order-email.ts (Phase 3, Task 8).
// Emails dispatch AFTER the committed transaction and never fail the transition.
// Default no-op keeps unit tests deterministic.
// ---------------------------------------------------------------------------

export interface WorkOrderEmailEvent {
  event: 'rfq' | 'assignment' | 'invoice_request';
  workOrder: WorkOrder;
  /** Contractors invited (rfq), winning contractor (assignment) or both (context). */
  contractorIds: string[];
  quotesDue?: Date;
}

type EmailDispatcher = (evt: WorkOrderEmailEvent) => Promise<void>;

let dispatchWorkOrderEmail: EmailDispatcher = async () => {};

/** Wire the real email dispatcher (Phase 3). Pass null to restore the no-op. */
export function setWorkOrderEmailDispatcher(dispatcher: EmailDispatcher | null): void {
  dispatchWorkOrderEmail = dispatcher ?? (async () => {});
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CreateWorkOrderInput {
  description: string;
  /** Email of the person who opened the work order (brief requirement). */
  openedBy: string;
  /** User.id of the opener — set when the opener is a known user. */
  openedById?: string | null;
  organizationId: string;
}

/** Editable fields only — state changes go through `transition()` exclusively. */
export interface UpdateWorkOrderInput {
  description?: string;
  openedBy?: string;
}

/** Transition side-effect options (design §State Machine). */
export interface TransitionOptions {
  /** Required for -> OUT_FOR_QUOTES: contractor directory ids invited by RFQ. */
  contractorIds?: string[];
  /** Optional deadline for -> OUT_FOR_QUOTES; defaults to +7 days. */
  quotesDue?: Date | null;
  /** Required for -> CONTRACTOR_ASSIGNED: the accepted quotation's id. */
  quoteId?: string;
  /** FINISHED requires `paid === true` (invoice payment confirmed — design Q3). */
  paid?: boolean;
}

export type WorkOrderFilters = BaseFilters & {
  state?: WorkOrderState;
  organizationId?: string;
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateRequiredString(value: string | undefined, field: string, maxLen: number): void {
  if (!value || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
  if (value.length > maxLen) {
    throw new ValidationError(`${field} must be at most ${maxLen} characters`);
  }
}

function validateEmail(value: string, field = 'openedBy'): void {
  validateRequiredString(value, field, 100);
  if (!EMAIL_RE.test(value.trim())) {
    throw new ValidationError(`${field} must be a valid email address`);
  }
}

// ---------------------------------------------------------------------------
// Service singleton
// ---------------------------------------------------------------------------

export const WorkOrderService = {
  /**
   * Create a work order in CREATED. Super-admin only.
   */
  async create(data: CreateWorkOrderInput, ctx: ServiceContext): Promise<WorkOrder> {
    if (ctx.role !== 'PLATFORM_ADMIN') {
      logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: work order write requires super admin');
      throw new ForbiddenError('Super admin access required');
    }

    // Normalise first so absent/whitespace fields validate the same way.
    const description = data.description?.trim() ?? '';
    const openedBy = data.openedBy?.trim() ?? '';
    validateRequiredString(description, 'Description', 500);
    validateEmail(openedBy);
    if (!data.organizationId || data.organizationId.trim().length === 0) {
      throw new ValidationError('Organization is required');
    }

    const workOrder = await tenantDb.workOrder.create({
      data: {
        description,
        openedBy,
        ...(data.openedById ? { openedById: data.openedById } : {}),
        organizationId: data.organizationId.trim(),
      },
    });

    logger.info(
      { userId: ctx.userId, workOrderId: workOrder.workOrderId, orgId: workOrder.organizationId },
      'Work order created',
    );

    return workOrder;
  },

  /**
   * Retrieve a single work order. Reads accept any verified tenant ctx for own
   * org rows + platform ctx (RLS enforces the boundary).
   */
  async getById(id: string, _ctx: ServiceContext): Promise<WorkOrder> {
    const workOrder = await tenantDb.workOrder.findUnique({ where: { workOrderId: id } });
    if (!workOrder) {
      throw new NotFoundError('Work order not found');
    }
    return workOrder;
  },

  /**
   * Paginated list with state + org filters and description/openedBy search.
   */
  async list(
    filters: WorkOrderFilters = {},
    paginationInput: { page?: number; pageSize?: number } = {},
    _ctx: ServiceContext,
  ): Promise<PaginatedResult<WorkOrder>> {
    const { page, pageSize } = normalizePagination(paginationInput);
    const skip = (page - 1) * pageSize;

    const where: Prisma.WorkOrderWhereInput = {};
    if (filters.organizationId !== undefined) {
      where.organizationId = filters.organizationId;
    }
    if (filters.state !== undefined) {
      if (!(WORK_ORDER_STATES as readonly string[]).includes(filters.state)) {
        throw new ValidationError(`State must be one of: ${WORK_ORDER_STATES.join(', ')}`);
      }
      where.state = filters.state;
    }
    if (filters.search) {
      const q = filters.search.trim();
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { openedBy: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      tenantDb.workOrder.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
      tenantDb.workOrder.count({ where }),
    ]);

    return { items, pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  },

  /**
   * Update the editable fields (description / openedBy). State is NOT
   * editable here — `transition()` is the only state path. Super-admin only.
   */
  async update(id: string, data: UpdateWorkOrderInput, ctx: ServiceContext): Promise<WorkOrder> {
    if (ctx.role !== 'PLATFORM_ADMIN') {
      logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: work order write requires super admin');
      throw new ForbiddenError('Super admin access required');
    }

    const existing = await tenantDb.workOrder.findUnique({ where: { workOrderId: id } });
    if (!existing) {
      throw new NotFoundError('Work order not found');
    }

    const updateData: Prisma.WorkOrderUpdateInput = {};
    if (data.description !== undefined) {
      validateRequiredString(data.description, 'Description', 500);
      updateData.description = data.description.trim();
    }
    if (data.openedBy !== undefined) {
      validateEmail(data.openedBy);
      updateData.openedBy = data.openedBy.trim();
    }
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('No updatable fields provided (description / openedBy only — use transition for state)');
    }

    const updated = await tenantDb.workOrder.update({ where: { workOrderId: id }, data: updateData });
    logger.info({ userId: ctx.userId, workOrderId: id }, 'Work order updated');
    return updated;
  },

  /**
   * Delete a work order (notes/quotes/invoice cascade via FK). Super-admin only.
   */
  async delete(id: string, ctx: ServiceContext): Promise<{ success: boolean }> {
    if (ctx.role !== 'PLATFORM_ADMIN') {
      logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: work order write requires super admin');
      throw new ForbiddenError('Super admin access required');
    }

    const existing = await tenantDb.workOrder.findUnique({ where: { workOrderId: id } });
    if (!existing) {
      throw new NotFoundError('Work order not found');
    }

    await tenantDb.workOrder.delete({ where: { workOrderId: id } });
    logger.info({ userId: ctx.userId, workOrderId: id }, 'Work order deleted');
    return { success: true };
  },

  /**
   * One-hop state transition with side effects in a single transaction.
   * Super-admin only. All per-transition side effects (design §State Machine)
   * run inside ONE $transaction; email dispatch happens AFTER commit and is
   * allowed to fail without rolling back the transition.
   */
  async transition(
    id: string,
    to: WorkOrderState,
    opts: TransitionOptions = {},
    ctx: ServiceContext,
  ): Promise<WorkOrder> {
    if (ctx.role !== 'PLATFORM_ADMIN') {
      logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: work order write requires super admin');
      throw new ForbiddenError('Super admin access required');
    }

    // Per-transition input validation (before any DB work) — ordered so that an
    // ILLEGAL hop always reports "Illegal transition" first, not a missing opt.
    if (to === 'OUT_FOR_QUOTES') {
      const ids = opts.contractorIds ?? [];
      if (ids.length === 0) {
        throw new ValidationError('contractorIds is required to send the RFQ');
      }
      for (const cid of ids) {
        if (!cid || typeof cid !== 'string') {
          throw new ValidationError('Every contractor id must be a non-empty string');
        }
      }
    }

    const row = await tenantDb.workOrder.findUnique({ where: { workOrderId: id } });
    if (!row) {
      throw new NotFoundError('Work order not found');
    }

    const allowed = WORK_ORDER_TRANSITIONS[row.state] ?? [];
    if (!allowed.includes(to)) {
      logger.warn(
        { userId: ctx.userId, workOrderId: id, from: row.state, to },
        'Illegal work order transition rejected',
      );
      throw new ValidationError(`Illegal transition ${row.state} -> ${to}`);
    }

    // Option required for a legal assign hop (checked after legality so illegal
    // hops never mask as "quoteId is required").
    if (to === 'CONTRACTOR_ASSIGNED' && !opts.quoteId) {
      throw new ValidationError('quoteId is required to assign a contractor');
    }

    const updated = await tenantDb.$transaction(async (tx) => {
      switch (to) {
        case 'OUT_FOR_QUOTES': {
          // Set quotesDue (default +7 days) and create one OPENED quotation per contractor.
          const quotesDue = opts.quotesDue ?? new Date(Date.now() + DEFAULT_QUOTES_DUE_DAYS * 24 * 60 * 60 * 1000);
          for (const contractorId of opts.contractorIds ?? []) {
            await tx.quotation.create({
              data: {
                workOrderId: row.workOrderId,
                contractorId,
                dueDate: quotesDue,
                state: 'OPENED',
                organizationId: row.organizationId,
              },
            });
          }
          return tx.workOrder.update({
            where: { workOrderId: id },
            data: { state: to, quotesDue },
          });
        }

        case 'CONTRACTOR_ASSIGNED': {
          // Accept one OPEN quotation of THIS work order; reject the rest.
          const quote = await tx.quotation.findFirst({
            where: { quoteId: opts.quoteId as string, workOrderId: row.workOrderId },
          });
          if (!quote || quote.state !== 'OPENED') {
            throw new ValidationError('Accepted quotation must belong to this work order and be OPEN');
          }
          await tx.quotation.update({ where: { quoteId: quote.quoteId }, data: { state: 'ACCEPTED' } });
          await tx.quotation.updateMany({
            where: { workOrderId: row.workOrderId, NOT: { quoteId: quote.quoteId } },
            data: { state: 'REJECTED' },
          });
          return tx.workOrder.update({
            where: { workOrderId: id },
            data: { state: to, contractorId: quote.contractorId },
          });
        }

        case 'COMPLETE':
        case 'QUOTES_IN':
        case 'STARTED':
          // Simple hops — no side effects.
          return tx.workOrder.update({ where: { workOrderId: id }, data: { state: to } });

        case 'INVOICED': {
          // An invoice row must already exist (1:1, created via InvoiceService).
          const invoice = await tx.invoice.findUnique({ where: { workOrderId: row.workOrderId } });
          if (!invoice) {
            throw new ValidationError('Cannot transition to INVOICED without an existing invoice');
          }
          return tx.workOrder.update({ where: { workOrderId: id }, data: { state: to } });
        }

        case 'FINISHED': {
          // Payment of the invoice confirmed by the super admin (design Q3).
          if (opts.paid !== true) {
            throw new ValidationError('Cannot transition to FINISHED without paid=true (invoice payment made)');
          }
          return tx.workOrder.update({ where: { workOrderId: id }, data: { state: to } });
        }

        case 'CLOSED': {
          // Early closure (pre-assignment states only — enforced above): flip
          // remaining OPENED quotations to CLOSED. No notification email (v1).
          await tx.quotation.updateMany({
            where: { workOrderId: row.workOrderId, state: 'OPENED' },
            data: { state: 'CLOSED' },
          });
          return tx.workOrder.update({ where: { workOrderId: id }, data: { state: to } });
        }

        case 'CREATED':
        default:
          // CREATED has no incoming edge — cannot be reached by transition.
          throw new ValidationError(`Illegal transition ${row.state} -> ${to}`);
      }
    });

    logger.info(
      { userId: ctx.userId, workOrderId: id, from: row.state, to },
      `Work order transitioned ${row.state} -> ${to}`,
    );

    // AFTER commit: dispatch informational emails (at-most-once; failures are
    // logged inside the dispatcher and never roll back the transition).
    if (updated) {
      try {
        if (to === 'OUT_FOR_QUOTES') {
          await dispatchWorkOrderEmail({
            event: 'rfq',
            workOrder: updated,
            contractorIds: opts.contractorIds ?? [],
            quotesDue: updated.quotesDue ?? undefined,
          });
        } else if (to === 'CONTRACTOR_ASSIGNED' && updated.contractorId) {
          await dispatchWorkOrderEmail({
            event: 'assignment',
            workOrder: updated,
            contractorIds: [updated.contractorId],
          });
        } else if (to === 'COMPLETE' && updated.contractorId) {
          await dispatchWorkOrderEmail({
            event: 'invoice_request',
            workOrder: updated,
            contractorIds: [updated.contractorId],
          });
        }
      } catch (err) {
        // Tolerance per design D7/T2: email failure never fails the transition.
        logger.warn(
          { userId: ctx.userId, workOrderId: id, to, err },
          'Work order email dispatch failed (transition already committed)',
        );
      }
    }

    return updated;
  },
};

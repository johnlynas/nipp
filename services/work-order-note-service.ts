/**
 * WorkOrderNoteService — CRUD on WorkOrderNote rows tied to a work order.
 *
 * Notes are super-admin managed (design D9); reads accept any verified tenant
 * ctx for own-org rows + platform ctx (RLS enforces the boundary). Notes may
 * exist only on non-terminal work orders (FINISHED / CLOSED reject writes).
 */

import { Prisma, WorkOrderNote } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { WorkOrderService } from './work-order-service';
import {
  ServiceContext,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '@/lib/services/types';

export interface CreateWorkOrderNoteInput {
  workOrderId: string;
  note: string;
  /** Super admin user id who wrote the note. */
  createdById?: string | null;
}

export interface UpdateWorkOrderNoteInput {
  note: string;
}

const NOTE_MAX_LEN = 2000;
const TERMINAL_STATES: readonly string[] = ['FINISHED', 'CLOSED'];

/** Notes exist only on non-terminal work orders; 404 if the parent is gone. */
async function requireNonTerminalWorkOrder(workOrderId: string): Promise<import('@prisma/client').WorkOrder> {
  const workOrder = await WorkOrderService.getById(workOrderId, READ_CTX);
  if (TERMINAL_STATES.includes(workOrder.state)) {
    throw new ValidationError(`Notes cannot be added to a ${workOrder.state} work order`);
  }
  return workOrder;
}

// Reads through WorkOrderService use a neutral ctx: the ROUTE has already run
// under the tenant RLS context of this row's org, so RLS decides visibility.
const READ_CTX: ServiceContext = { userId: '', role: 'MEMBER' };

function requireSuperAdminCtx(ctx: ServiceContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: work order note write requires super admin');
    throw new ForbiddenError('Super admin access required');
  }
}

function validateNote(note: string): void {
  if (!note || note.trim().length === 0) {
    throw new ValidationError('Note text is required');
  }
  if (note.length > NOTE_MAX_LEN) {
    throw new ValidationError(`Note must be at most ${NOTE_MAX_LEN} characters`);
  }
}

export const WorkOrderNoteService = {
  /** Create a note on a non-terminal work order. Super-admin only. */
  async create(data: CreateWorkOrderNoteInput, ctx: ServiceContext): Promise<WorkOrderNote> {
    requireSuperAdminCtx(ctx);
    validateNote(data.note);

    const workOrder = await requireNonTerminalWorkOrder(data.workOrderId);

    const noteData: Prisma.WorkOrderNoteUncheckedCreateInput = {
      workOrderId: data.workOrderId,
      organizationId: workOrder.organizationId,
      note: data.note.trim(),
    };
    if (data.createdById) noteData.createdById = data.createdById;
    const note = await tenantDb.workOrderNote.create({ data: noteData });

    logger.info(
      { userId: ctx.userId, workOrderId: data.workOrderId, workOrderNoteId: note.workOrderNoteId },
      'Work order note created',
    );
    return note;
  },

  /** List a work order's notes (oldest first). Any verified ctx — RLS-scoped. */
  async list(filters: { workOrderId: string }): Promise<WorkOrderNote[]> {
    if (!filters.workOrderId) {
      throw new ValidationError('workOrderId is required');
    }
    return tenantDb.workOrderNote.findMany({
      where: { workOrderId: filters.workOrderId },
      orderBy: { createdAt: 'asc' },
    });
  },

  /** Update the note text. Super-admin only; terminal work orders rejected. */
  async update(id: string, data: UpdateWorkOrderNoteInput, ctx: ServiceContext): Promise<WorkOrderNote> {
    requireSuperAdminCtx(ctx);
    validateNote(data.note);

    const existing = await tenantDb.workOrderNote.findUnique({ where: { workOrderNoteId: id } });
    if (!existing) {
      throw new NotFoundError('Work order note not found');
    }

    await requireNonTerminalWorkOrder(existing.workOrderId);

    const updated = await tenantDb.workOrderNote.update({
      where: { workOrderNoteId: id },
      data: { note: data.note.trim() },
    });
    logger.info({ userId: ctx.userId, workOrderNoteId: id }, 'Work order note updated');
    return updated;
  },

  /** Delete a note. Super-admin only; terminal work orders rejected. */
  async delete(id: string, ctx: ServiceContext): Promise<{ success: boolean }> {
    requireSuperAdminCtx(ctx);

    const existing = await tenantDb.workOrderNote.findUnique({ where: { workOrderNoteId: id } });
    if (!existing) {
      throw new NotFoundError('Work order note not found');
    }

    await requireNonTerminalWorkOrder(existing.workOrderId);

    await tenantDb.workOrderNote.delete({ where: { workOrderNoteId: id } });
    logger.info({ userId: ctx.userId, workOrderNoteId: id }, 'Work order note deleted');
    return { success: true };
  },
};

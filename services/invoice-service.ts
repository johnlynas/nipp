/**
 * InvoiceService — CRUD for the 1:1 WorkOrder→Invoice record.
 *
 * An invoice is recorded (super admin) once the work is COMPLETE; the
 * COMPLETE → INVOICED transition requires the row to exist (WorkOrderService
 * validates). Corrections in v1 = delete + recreate while the work order is
 * INVOICED (delete only allowed then, never after FINISHED — the paid chain is
 * a closed audit record). Unique per workOrderId enforced at the DB level
 * (@unique) and mapped to ValidationError on P2002.
 */

import { Prisma, Invoice } from '@prisma/client';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { WorkOrderService } from './work-order-service';
import {
  ServiceContext,
  ForbiddenError,
  NotFoundError,
  ValidationError,
  ConflictError,
} from '@/lib/services/types';

export interface CreateInvoiceInput {
  workOrderId: string;
  /** Must equal the work order's assigned contractor. */
  contractorId: string;
  invoiceDate: Date;
  price: number;
  dueDate: Date;
  invoiceLink?: string | null;
}

export interface UpdateInvoiceInput {
  price?: number;
  invoiceDate?: Date;
  dueDate?: Date;
  invoiceLink?: string | null;
}

const READ_CTX: ServiceContext = { userId: '', role: 'MEMBER' };

function requireSuperAdminCtx(ctx: ServiceContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    logger.warn({ userId: ctx.userId, role: ctx.role }, 'Authorization denied: invoice write requires super admin');
    throw new ForbiddenError('Super admin access required');
  }
}

function parsePrice(value: unknown, field = 'price'): number {
  const num = typeof value === 'string' ? Number(value) : (value as number);
  if (typeof num !== 'number' || !Number.isFinite(num)) {
    throw new ValidationError(`${field} must be a valid number`);
  }
  return num;
}

export const InvoiceService = {
  /**
   * Record the invoice for a COMPLETE work order. Unique per work order —
   * a duplicate (incl. the DB-level P2002) is a ValidationError, not a 500.
   */
  async create(data: CreateInvoiceInput, ctx: ServiceContext): Promise<Invoice> {
    requireSuperAdminCtx(ctx);

    const workOrder = await WorkOrderService.getById(data.workOrderId, READ_CTX);
    if (workOrder.state !== 'COMPLETE') {
      throw new ValidationError(`Invoices can only be recorded for a COMPLETE work order (current: ${workOrder.state})`);
    }
    if (workOrder.contractorId === null) {
      throw new ValidationError('Cannot invoice an unassigned work order');
    }
    if (data.contractorId !== workOrder.contractorId) {
      throw new ValidationError('Invoice contractor must be the work order\'s assigned contractor');
    }

    const price = parsePrice(data.price);
    if (price <= 0) {
      throw new ValidationError('price must be greater than zero');
    }

    try {
      const invoice = await tenantDb.invoice.create({
        data: {
          workOrderId: data.workOrderId,
          contractorId: data.contractorId,
          organizationId: workOrder.organizationId,
          invoiceDate: data.invoiceDate,
          dueDate: data.dueDate,
          price,
          ...(data.invoiceLink ? { invoiceLink: data.invoiceLink.trim() } : {}),
        },
      });

      logger.info(
        { userId: ctx.userId, invoiceId: invoice.invoiceId, workOrderId: data.workOrderId },
        'Invoice recorded',
      );
      return invoice;
    } catch (err) {
      // DB-level uniqueness backstops the service check (e.g. racing request).
      if ((err as { code?: string })?.code === 'P2002') {
        throw new ValidationError('Invoice already exists for this work order');
      }
      throw err;
    }
  },

  /**
   * Update invoice price/dates/link — allowed while the work order is
   * COMPLETE or INVOICED (corrections before payment). FINISHED blocks it.
   */
  async update(invoiceId: string, data: UpdateInvoiceInput, ctx: ServiceContext): Promise<Invoice> {
    requireSuperAdminCtx(ctx);

    const existing = await tenantDb.invoice.findUnique({ where: { invoiceId } });
    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    const workOrder = await WorkOrderService.getById(existing.workOrderId, READ_CTX);
    if (workOrder.state !== 'COMPLETE' && workOrder.state !== 'INVOICED') {
      throw new ConflictError(`Invoices cannot be edited while the work order is ${workOrder.state}`);
    }

    const updateData: Prisma.InvoiceUncheckedUpdateInput = {};
    if (data.price !== undefined) {
      const price = parsePrice(data.price);
      if (price <= 0) throw new ValidationError('price must be greater than zero');
      updateData.price = price;
    }
    if (data.invoiceDate !== undefined) updateData.invoiceDate = data.invoiceDate;
    if (data.dueDate !== undefined) updateData.dueDate = data.dueDate;
    if (data.invoiceLink !== undefined) updateData.invoiceLink = data.invoiceLink?.trim() || null;
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('No updatable fields provided');
    }

    const updated = await tenantDb.invoice.update({ where: { invoiceId }, data: updateData });
    logger.info({ userId: ctx.userId, invoiceId }, 'Invoice updated');
    return updated;
  },

  /**
   * Delete an invoice — only while the work order is INVOICED (v1 correction
   * = delete + recreate). COMPLETE rows must not be removed either (nothing to
   * correct yet; use update), FINISHED/CLOSED are immutable (409).
   */
  async delete(invoiceId: string, ctx: ServiceContext): Promise<{ success: boolean }> {
    requireSuperAdminCtx(ctx);

    const existing = await tenantDb.invoice.findUnique({ where: { invoiceId } });
    if (!existing) {
      throw new NotFoundError('Invoice not found');
    }

    const workOrder = await WorkOrderService.getById(existing.workOrderId, READ_CTX);
    if (workOrder.state === 'FINISHED' || workOrder.state === 'CLOSED') {
      throw new ConflictError(
        `Invoices cannot be deleted while the work order is ${workOrder.state} (paid/closed chain is a closed audit record)`,
      );
    }
    if (workOrder.state !== 'INVOICED') {
      throw new ValidationError('Invoices can only be deleted while the work order is INVOICED (correction flow)');
    }

    await tenantDb.invoice.delete({ where: { invoiceId } });
    logger.info({ userId: ctx.userId, invoiceId }, 'Invoice deleted');
    return { success: true };
  },
};

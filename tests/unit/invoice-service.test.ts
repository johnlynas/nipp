/**
 * Unit tests for InvoiceService — 1:1 invoice per work order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InvoiceService, type CreateInvoiceInput } from '@/services/invoice-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '@/lib/services/types';

const { tx } = vi.hoisted(() => ({
  tx: {
    invoice: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/tenant-db', () => ({
  default: tx,
}));

vi.mock('@/services/work-order-service', () => ({
  WorkOrderService: { getById: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as workOrderServiceModule from '@/services/work-order-service';

const db = tx as unknown as { invoice: Record<string, ReturnType<typeof vi.fn>> };
const WORK_ORDER_GETID = workOrderServiceModule.WorkOrderService.getById as ReturnType<typeof vi.fn>;

const ctx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

/** Stub the parent work order; `assigned` sets the assigned contractor id. */
function withWorkOrder(state: string | null, assignedContractorId?: string | null) {
  if (state === null) {
    WORK_ORDER_GETID.mockRejectedValue(new NotFoundError('Work order not found'));
  } else {
    WORK_ORDER_GETID.mockResolvedValue({ workOrderId: 'wo-1', organizationId: 'org-1', state, contractorId: assignedContractorId ?? null });
  }
}

const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: 'inv-1',
  invoiceDate: new Date('2026-10-15T00:00:00Z'),
  workOrderId: 'wo-1',
  contractorId: 'c-7',
  invoiceLink: null,
  price: 4200,
  dueDate: new Date('2026-11-01T00:00:00Z'),
  organizationId: 'org-1',
  ...overrides,
});

const validCreate = (extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput => ({
  workOrderId: 'wo-1',
  contractorId: 'c-7',
  invoiceDate: new Date('2026-10-15T00:00:00Z'),
  price: 4200,
  dueDate: new Date('2026-11-01T00:00:00Z'),
  ...extra,
});

describe('InvoiceService', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('create (1:1 uniqueness)', () => {
    it('creates the invoice for a COMPLETE work order with the assigned contractor (super-admin only)', async () => {
      withWorkOrder('COMPLETE', 'c-7');
      await db.invoice.findUnique.mockReset();
      db.invoice.findUnique.mockResolvedValue(null);
      db.invoice.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.price).toBe(4200);
        return invoiceRow() as never;
      });

      const result = await InvoiceService.create(validCreate(), ctx('PLATFORM_ADMIN'));
      expect(result.invoiceId).toBe('inv-1');
    });

    it('duplicate for the same work order → ValidationError (P2002 caught)', async () => {
      withWorkOrder('COMPLETE', 'c-7');
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      db.invoice.create.mockRejectedValue(p2002);
      await expect(InvoiceService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('price > 0 required', async () => {
      withWorkOrder('COMPLETE', 'c-7');
      db.invoice.findUnique.mockResolvedValue(null);
      await expect(InvoiceService.create(validCreate({ price: 0 }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
      await expect(InvoiceService.create(validCreate({ price: -5 }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('contractorId must equal the work order\'s assigned contractor', async () => {
      withWorkOrder('COMPLETE', 'c-7');
      db.invoice.findUnique.mockResolvedValue(null);
      await expect(InvoiceService.create(validCreate({ contractorId: 'c-other' }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('invoices can only be recorded for a COMPLETE work order (and the transition validates INVOICED)', async () => {
      withWorkOrder('STARTED', 'c-7');
      await expect(InvoiceService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

      withWorkOrder('FINISHED', 'c-7');
      await expect(InvoiceService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

      withWorkOrder(null);
      await expect(InvoiceService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });

    it('rejects non-super-admins', async () => {
      await expect(InvoiceService.create(validCreate(), ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    });
  });

  describe('update / delete', () => {
    beforeEach(() => {
      db.invoice.findUnique.mockResolvedValue(invoiceRow());
    });

    it('update: super-admin; edits price/dates/link while the work order is COMPLETE or INVOICED', async () => {
      withWorkOrder('INVOICED', 'c-7');
      db.invoice.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        invoiceRow({ price: args.data.price }),
      );

      const result = await InvoiceService.update('inv-1', { price: 4300 }, ctx('PLATFORM_ADMIN'));
      expect(result.price).toBe(4300);
      expect(WORK_ORDER_GETID).toHaveBeenCalled(); // parent state checked
    });

    it('update blocked once the work order is FINISHED (the invoiced chain is closed by payment)', async () => {
      withWorkOrder('FINISHED', 'c-7');
      await expect(InvoiceService.update('inv-1', { price: 9999 }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ConflictError);
    });

    it('delete only allowed while state INVOICED (correction = delete + recreate by super admin)', async () => {
      withWorkOrder('COMPLETE', 'c-7');
      await expect(InvoiceService.delete('inv-1', ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

      withWorkOrder('INVOICED', 'c-7');
      db.invoice.delete.mockResolvedValue(invoiceRow());
      const result = await InvoiceService.delete('inv-1', ctx('PLATFORM_ADMIN'));
      expect(result).toEqual({ success: true });

      withWorkOrder('FINISHED', 'c-7');
      await expect(InvoiceService.delete('inv-1', ctx('PLATFORM_ADMIN'))).rejects.toThrow(ConflictError);
    });

    it('update/delete reject non-super-admins and throw NotFound for missing rows', async () => {
      await expect(InvoiceService.update('inv-1', { price: 1 }, ctx('MEMBER'))).rejects.toThrow(ForbiddenError);
      await expect(InvoiceService.delete('inv-1', ctx('MEMBER'))).rejects.toThrow(ForbiddenError);

      db.invoice.findUnique.mockResolvedValue(null);
      withWorkOrder('INVOICED', 'c-7');
      await expect(InvoiceService.update('missing', { price: 1 }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
      await expect(InvoiceService.delete('missing', ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });
  });
});

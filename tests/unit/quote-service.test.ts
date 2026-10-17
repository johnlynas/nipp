/**
 * Unit tests for QuotationService — quote CRUD + auto QUOTES_IN hop on price fill.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotationService, type CreateQuotationInput } from '@/services/quote-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '@/lib/services/types';

const { tx } = vi.hoisted(() => ({
  tx: {
    quotation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    contractors: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/tenant-db', () => ({
  default: tx,
}));

vi.mock('@/services/work-order-service', () => ({
  WorkOrderService: {
    getById: vi.fn(),
    transition: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as workOrderServiceModule from '@/services/work-order-service';

const db = tx as unknown as {
  quotation: Record<string, ReturnType<typeof vi.fn>>;
  contractors: Record<string, ReturnType<typeof vi.fn>>;
};

const WORK_ORDER_GETID = workOrderServiceModule.WorkOrderService.getById as ReturnType<typeof vi.fn>;
const WORK_ORDER_TRANSITION = workOrderServiceModule.WorkOrderService.transition as ReturnType<typeof vi.fn>;

const ctx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockWorkOrder = (state: string = 'OUT_FOR_QUOTES') => ({
  workOrderId: 'wo-1',
  organizationId: 'org-1',
  state,
});

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  quoteId: 'q-1',
  workOrderId: 'wo-1',
  contractorId: 'c-1',
  quoteLink: null,
  description: null,
  price: null,
  dueDate: new Date('2026-10-24T00:00:00Z'),
  state: 'OPENED',
  organizationId: 'org-1',
  ...overrides,
});

const validCreate = (extra: Partial<CreateQuotationInput> = {}): CreateQuotationInput => ({
  workOrderId: 'wo-1',
  contractorId: 'c-1',
  dueDate: new Date('2026-10-24T00:00:00Z'),
  ...extra,
});

describe('QuotationService', () => {
  beforeEach(() => vi.resetAllMocks());

  describe('create', () => {
    it('creates an OPENED quote for a valid directory contractor (super-admin only)', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('OUT_FOR_QUOTES'));
      db.contractors.findUnique.mockResolvedValue({ contractorId: 'c-1' });
      db.quotation.findFirst.mockResolvedValue(null);
      db.quotation.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.state).toBe('OPENED');
        expect(args.data.workOrderId).toBe('wo-1');
        expect(args.data.contractorId).toBe('c-1');
        return quoteRow() as never;
      });

      const result = await QuotationService.create(validCreate(), ctx('PLATFORM_ADMIN'));
      expect(result.quoteId).toBe('q-1');
    });

    it('rejects non-super-admins', async () => {
      await expect(QuotationService.create(validCreate(), ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    });

    it('requires the contractor to exist in the global directory (404)', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('OUT_FOR_QUOTES'));
      db.contractors.findUnique.mockReset();
      db.contractors.findUnique.mockResolvedValue(null);
      await expect(QuotationService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });

    it('requires the work order to exist (404) and be in a quotable state', async () => {
      WORK_ORDER_GETID.mockRejectedValue(new NotFoundError('Work order not found'));
      await expect(QuotationService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);

      // A terminal work order cannot take new quotes.
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('FINISHED'));
      await expect(QuotationService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('duplicate (workOrderId, contractorId) → ValidationError', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('OUT_FOR_QUOTES'));
      db.contractors.findUnique.mockResolvedValue({ contractorId: 'c-1' });
      db.quotation.findFirst.mockResolvedValue(quoteRow());
      await expect(QuotationService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });
  });

  describe('update (price fill → auto QUOTES_IN)', () => {
    beforeEach(() => {
      db.quotation.findUnique.mockResolvedValue(quoteRow());
    });

    it('setting price on an OUT_FOR_QUOTES work order fires the automatic transition exactly once', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('OUT_FOR_QUOTES'));
      WORK_ORDER_TRANSITION.mockResolvedValue(mockWorkOrder('QUOTES_IN'));
      db.quotation.update.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.price).toBe(1250.5);
        return quoteRow({ price: 1250.5 }) as never;
      });

      await QuotationService.update('q-1', { price: '1250.50' }, ctx('PLATFORM_ADMIN'));

      expect(db.quotation.update).toHaveBeenCalledTimes(1);
      expect(WORK_ORDER_TRANSITION).toHaveBeenCalledTimes(1);
      expect(WORK_ORDER_TRANSITION.mock.calls[0][0]).toBe('wo-1');
      expect(WORK_ORDER_TRANSITION.mock.calls[0][1]).toBe('QUOTES_IN');
    });

    it('filling price when the work order is already QUOTES_IN does NOT fire a transition', async () => {
      db.quotation.findUnique.mockResolvedValue(quoteRow({ description: null }));
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('QUOTES_IN'));
      db.quotation.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        quoteRow({ price: args.data.price }),
      );

      await QuotationService.update('q-1', { price: 900 }, ctx('PLATFORM_ADMIN'));
      expect(WORK_ORDER_TRANSITION).not.toHaveBeenCalled();
    });

    it('setting price on a non-open quote is rejected (state consistency)', async () => {
      db.quotation.findUnique.mockResolvedValue(quoteRow({ state: 'ACCEPTED' }));
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('CONTRACTOR_ASSIGNED'));
      await expect(QuotationService.update('q-1', { price: 500 }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('requires a positive price; description/quoteLink editable on open quotes', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('QUOTES_IN'));
      await expect(QuotationService.update('q-1', { price: 0 }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

      vi.clearAllMocks();
      db.quotation.findUnique.mockResolvedValue(quoteRow());
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('QUOTES_IN'));
      db.quotation.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
        quoteRow({ description: args.data.description, quoteLink: args.data.quoteLink }),
      );
      const result = await QuotationService.update('q-1', { description: 'Labour + materials', quoteLink: 'https://files.example/q.pdf' }, ctx('PLATFORM_ADMIN'));
      expect(result.description).toBe('Labour + materials');
      expect(WORK_ORDER_TRANSITION).not.toHaveBeenCalled();
    });

    it('rejects non-super-admins and throws NotFound for a missing quote row', async () => {
      await expect(QuotationService.update('q-1', { price: 10 }, ctx('MEMBER'))).rejects.toThrow(ForbiddenError);

      db.quotation.findUnique.mockResolvedValue(null);
      await expect(QuotationService.update('missing', { price: 10 }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    beforeEach(() => {
      db.quotation.findUnique.mockResolvedValue(quoteRow());
    });

    it('deletes an open quote while the work order is pre-assignment (super-admin only)', async () => {
      WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder('OUT_FOR_QUOTES'));
      db.quotation.delete.mockResolvedValue(quoteRow());

      const result = await QuotationService.delete('q-1', ctx('PLATFORM_ADMIN'));
      expect(result).toEqual({ success: true });
      expect(WORK_ORDER_TRANSITION).not.toHaveBeenCalled();
    });

    it('blocked when the work order is INVOICED / FINISHED / CLOSED (409)', async () => {
      for (const state of ['INVOICED', 'FINISHED', 'CLOSED'] as const) {
        vi.clearAllMocks();
        db.quotation.findUnique.mockResolvedValue(quoteRow());
        WORK_ORDER_GETID.mockResolvedValue(mockWorkOrder(state));
        await expect(QuotationService.delete('q-1', ctx('PLATFORM_ADMIN'))).rejects.toThrow(ConflictError);
      }
      expect(db.quotation.delete).not.toHaveBeenCalled();
    });

    it('throws NotFound when the quote row does not exist', async () => {
      db.quotation.findUnique.mockResolvedValue(null);
      await expect(QuotationService.delete('missing', ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });
  });
});

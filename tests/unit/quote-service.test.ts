/**
 * Unit tests for QuotationService — quote CRUD + auto QUOTES_IN hop on price fill.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuotationService, type CreateQuotationInput, QUOTE_STATES } from '@/services/quote-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError, ConflictError } from '@/lib/services/types';

const { tx } = vi.hoisted(() => ({
  tx: {
    quotation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
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

  describe('list (admin + tenant reads)', () => {
    it('returns a paginated slice with contractor + work order joins', async () => {
      const rows = [quoteRow({ contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' }, workOrder: { description: 'Boiler repair', state: 'OUT_FOR_QUOTES' } })];
      db.quotation.findMany.mockResolvedValue(rows);
      db.quotation.count.mockResolvedValue(17);

      const result = await QuotationService.list({ search: undefined }, { page: 2, pageSize: 8 }, ctx('PLATFORM_ADMIN'));

      expect(result.items).toHaveLength(1);
      expect(result.pagination).toEqual({ page: 2, pageSize: 8, total: 17, totalPages: 3 });
      // Pagination math reaches the query (skip = (page-1)*pageSize).
      const args = db.quotation.findMany.mock.calls[0][0] as { skip: number; take: number };
      expect(args.skip).toBe(8);
      expect(args.take).toBe(8);
    });

    it('maps every filter onto the Prisma where clause (incl. nested contractor relation)', async () => {
      db.quotation.findMany.mockResolvedValue([]);
      db.quotation.count.mockResolvedValue(0);

      await QuotationService.list(
        { organizationId: 'org-1', workOrderId: 'wo-1', contractorId: 'c-1', state: 'ACCEPTED' },
        {},
        ctx('MEMBER', 'org-1'),
      );

      const where = (db.quotation.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      expect(where).toMatchObject({ organizationId: 'org-1', workOrderId: 'wo-1', contractorId: 'c-1', state: 'ACCEPTED' });
    });

    it('search fans out across contractor name/company, work order description and quote breakdown', async () => {
      db.quotation.findMany.mockResolvedValue([]);
      db.quotation.count.mockResolvedValue(0);

      await QuotationService.list({ search: '  byrne  ' }, {}, ctx('PLATFORM_ADMIN'));

      const where = (db.quotation.findMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
      const ors = (where.OR as Array<Record<string, unknown>>) ?? [];
      expect(ors).toHaveLength(4);
      expect(ors[0]).toEqual({ contractor: { name: { contains: 'byrne', mode: 'insensitive' } } });
      expect(ors[1]).toEqual({ contractor: { companyName: { contains: 'byrne', mode: 'insensitive' } } });
    });

    it('rejects an unknown quote state (400-class, not a silent drop)', async () => {
      await expect(
        QuotationService.list({ state: 'PENDING' as never }, {}, ctx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
      expect(db.quotation.findMany).not.toHaveBeenCalled();
    });

    it('does not require super-admin for reads (RLS decides visibility at the route)', async () => {
      db.quotation.findMany.mockResolvedValue([]);
      db.quotation.count.mockResolvedValue(0);
      await expect(QuotationService.list({}, {}, ctx('MEMBER', 'org-1'))).resolves.toEqual({
        items: [],
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
      });
    });

    it('exports the Prisma enum mirror as QUOTE_STATES', () => {
      expect(QUOTE_STATES).toEqual(['OPENED', 'ACCEPTED', 'REJECTED', 'CLOSED']);
    });
  });
});

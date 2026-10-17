/**
 * Unit tests for WorkOrderService — org-scoped work order CRUD + state machine.
 *
 * Mocks @/lib/tenant-db (the only DB surface); $transaction(fn) runs fn with a
 * tx exposing the same mocked models. Mirrors tests/unit/contractor-service.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorkOrderService,
  WORK_ORDER_TRANSITIONS,
  WORK_ORDER_STATES,
  setWorkOrderEmailDispatcher,
  type CreateWorkOrderInput,
  type TransitionOptions,
} from '@/services/work-order-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// ---------------------------------------------------------------------------
// Mocks (vi.hoisted: the mock factory runs before module-level consts exist)
// ---------------------------------------------------------------------------

const { tx, mockTransaction } = vi.hoisted(() => {
  const tx = {
    workOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    quotation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    invoice: {
      findUnique: vi.fn(),
    },
  };
  return { tx, mockTransaction: vi.fn((fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
});

vi.mock('@/lib/tenant-db', () => ({
  default: {
    workOrder: tx.workOrder,
    quotation: tx.quotation,
    invoice: tx.invoice,
    $transaction: mockTransaction,
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Untyped handles.
const db = tx as unknown as {
  workOrder: Record<string, ReturnType<typeof vi.fn>>;
  quotation: Record<string, ReturnType<typeof vi.fn>>;
  invoice: Record<string, ReturnType<typeof vi.fn>>;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ctx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockWorkOrder = (overrides: Record<string, unknown> = {}) => ({
  workOrderId: 'wo-1',
  description: 'Replace lift door interlock',
  openedBy: 'admin@example.com',
  openedById: null,
  contractorId: null,
  quotesDue: null,
  deadlineAlertAt: null,
  state: 'CREATED',
  organizationId: 'org-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as Record<string, unknown>;

const validCreate = (extra: Partial<CreateWorkOrderInput> = {}): CreateWorkOrderInput => ({
  description: 'Replace lift door interlock',
  openedBy: 'admin@example.com',
  organizationId: 'org-1',
  ...extra,
});

const setRow = (row: Record<string, unknown> | null) => {
  db.workOrder.findUnique.mockResolvedValue(row);
};

// ---------------------------------------------------------------------------
// State machine table shape
// ---------------------------------------------------------------------------

describe('WORK_ORDER_TRANSITIONS', () => {
  it('covers exactly the nine states of the design', () => {
    expect([...WORK_ORDER_STATES].sort()).toEqual(
      ['CLOSED', 'COMPLETE', 'CONTRACTOR_ASSIGNED', 'CREATED', 'FINISHED', 'INVOICED', 'OUT_FOR_QUOTES', 'QUOTES_IN', 'STARTED'].sort(),
    );
  });

  it('legal edges match the design state machine §State Machine', () => {
    expect(WORK_ORDER_TRANSITIONS.CREATED).toEqual(['OUT_FOR_QUOTES', 'CLOSED']);
    expect(WORK_ORDER_TRANSITIONS.OUT_FOR_QUOTES).toEqual(['QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'CLOSED']);
    expect(WORK_ORDER_TRANSITIONS.QUOTES_IN).toEqual(['CONTRACTOR_ASSIGNED', 'CLOSED']);
    expect(WORK_ORDER_TRANSITIONS.CONTRACTOR_ASSIGNED).toEqual(['STARTED']);
    expect(WORK_ORDER_TRANSITIONS.STARTED).toEqual(['COMPLETE']);
    expect(WORK_ORDER_TRANSITIONS.COMPLETE).toEqual(['INVOICED']);
    expect(WORK_ORDER_TRANSITIONS.INVOICED).toEqual(['FINISHED']);
    expect(WORK_ORDER_TRANSITIONS.FINISHED).toEqual([]);
    expect(WORK_ORDER_TRANSITIONS.CLOSED).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('WorkOrderService.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects non-super-admins (MEMBER and TENANT_ADMIN)', async () => {
    await expect(WorkOrderService.create(validCreate(), ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    await expect(WorkOrderService.create(validCreate(), ctx('MEMBER', 'org-1'))).rejects.toThrow(ForbiddenError);
    expect(db.workOrder.create).not.toHaveBeenCalled();
  });

  it('creates with state CREATED and the given openedBy email', async () => {
    db.workOrder.create.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => {
      expect(args.data.description).toBe('Replace lift door interlock');
      expect(args.data.openedBy).toBe('admin@example.com');
      return mockWorkOrder() as never;
    });

    const result = await WorkOrderService.create(validCreate(), ctx('PLATFORM_ADMIN'));

    expect(result.state).toBe('CREATED');
    expect(result.openedBy).toBe('admin@example.com');
    expect(db.workOrder.create).toHaveBeenCalledTimes(1);
  });

  it('includes organizationId in the create data', async () => {
    db.workOrder.create.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => {
      expect(args.data.organizationId).toBe('org-1');
      return mockWorkOrder() as never;
    });
    await WorkOrderService.create(validCreate(), ctx('PLATFORM_ADMIN'));
  });

  it('carries openedById through when provided', async () => {
    db.workOrder.create.mockImplementationOnce(async (args: { data: Record<string, unknown> }) => {
      expect(args.data.openedById).toBe('user-9');
      return mockWorkOrder({ openedById: 'user-9' }) as never;
    });
    await WorkOrderService.create(validCreate({ openedById: 'user-9' }), ctx('PLATFORM_ADMIN'));
  });

  it('rejects missing/empty description', async () => {
    await expect(WorkOrderService.create(validCreate({ description: '   ' }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    await expect(
      WorkOrderService.create({ openedBy: 'admin@example.com', organizationId: 'org-1' } as CreateWorkOrderInput, ctx('PLATFORM_ADMIN')),
    ).rejects.toThrow(ValidationError);
  });

  it('rejects an over-long description', async () => {
    await expect(WorkOrderService.create(validCreate({ description: 'x'.repeat(501) }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
  });

  it('requires a valid openedBy email', async () => {
    await expect(WorkOrderService.create(validCreate({ openedBy: 'not-an-email' }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
  });

  it('requires organizationId', async () => {
    await expect(
      WorkOrderService.create({ description: 'Some work', openedBy: 'admin@example.com' } as CreateWorkOrderInput, ctx('PLATFORM_ADMIN')),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// transition — legal matrix with side effects
// ---------------------------------------------------------------------------

describe('WorkOrderService.transition (legal)', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseRow = mockWorkOrder();

  it('CREATED -> OUT_FOR_QUOTES: sets quotesDue and creates one OPENED quotation per contractor', async () => {
    setRow(baseRow);
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'OUT_FOR_QUOTES' }));
    tx.quotation.create.mockResolvedValue({ quoteId: 'q-1' });

    const result = await WorkOrderService.transition(
      'wo-1',
      'OUT_FOR_QUOTES',
      { contractorIds: ['c-1', 'c-2'], quotesDue: new Date('2026-10-24T09:00:00Z') },
      ctx('PLATFORM_ADMIN'),
    );

    expect(result.state).toBe('OUT_FOR_QUOTES');
    const workOrderUpdate = db.workOrder.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(workOrderUpdate.data.state).toBe('OUT_FOR_QUOTES');
    expect(new Date(workOrderUpdate.data.quotesDue as Date).toISOString()).toBe('2026-10-24T09:00:00.000Z');
    expect(tx.quotation.create).toHaveBeenCalledTimes(2);
    const firstQuote = (tx.quotation.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(firstQuote.workOrderId).toBe('wo-1');
    expect(firstQuote.contractorId).toBe('c-1');
    expect(firstQuote.state).toBe('OPENED');
    expect(firstQuote.organizationId).toBe('org-1');
  });

  it('CREATED -> OUT_FOR_QUOTES: defaults quotesDue to +7 days and rejects an empty contractor list', async () => {
    setRow(baseRow);
    await expect(WorkOrderService.transition('wo-1', 'OUT_FOR_QUOTES', { contractorIds: [] }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'OUT_FOR_QUOTES' }));

    const defaultBefore = Date.now();
    await WorkOrderService.transition('wo-1', 'OUT_FOR_QUOTES', { contractorIds: ['c-1'] }, ctx('PLATFORM_ADMIN'));
    const workOrderUpdate = db.workOrder.update.mock.calls[0][0] as { data: Record<string, unknown> };
    const due = workOrderUpdate.data.quotesDue as Date;
    expect(due.getTime()).toBeGreaterThanOrEqual(defaultBefore + 7 * 24 * 60 * 60 * 1000 - 5000);
    expect(due.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 5000);
  });

  it('OUT_FOR_QUOTES -> QUOTES_IN: plain state hop (manual path; auto path lives in QuoteService)', async () => {
    setRow(mockWorkOrder({ state: 'OUT_FOR_QUOTES' }));
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'QUOTES_IN' }));

    const result = await WorkOrderService.transition('wo-1', 'QUOTES_IN', {}, ctx('PLATFORM_ADMIN'));

    expect(result.state).toBe('QUOTES_IN');
    expect(tx.quotation.create).not.toHaveBeenCalled();
  });

  it('QUOTES_IN -> CONTRACTOR_ASSIGNED: sets contractorId from the accepted quote; rejects the others', async () => {
    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    tx.quotation.findFirst.mockResolvedValue({ quoteId: 'q-1', workOrderId: 'wo-1', contractorId: 'c-7', state: 'OPENED' });
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'CONTRACTOR_ASSIGNED', contractorId: 'c-7' }));

    const result = await WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', { quoteId: 'q-1' }, ctx('PLATFORM_ADMIN'));

    expect(result.state).toBe('CONTRACTOR_ASSIGNED');
    const workOrderUpdate = db.workOrder.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(workOrderUpdate.data.contractorId).toBe('c-7');
    // The winning quote is marked ACCEPTED…
    expect(tx.quotation.update).toHaveBeenCalledWith(expect.objectContaining({ data: { state: 'ACCEPTED' } }));
    // …and every other quote of the work order REJECTED.
    const updateManyArgs = db.quotation.updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(updateManyArgs.where.workOrderId).toBe('wo-1');
    expect((updateManyArgs.where.NOT as Record<string, unknown>).quoteId).toBe('q-1');
  });

  it('QUOTES_IN -> CONTRACTOR_ASSIGNED: accepts only OPEN quotations belonging to the work order', async () => {
    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    tx.quotation.findFirst.mockResolvedValue(null);
    await expect(WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', { quoteId: 'q-x' }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    tx.quotation.findFirst.mockResolvedValue({ quoteId: 'q-1', workOrderId: 'wo-1', contractorId: 'c-7', state: 'REJECTED' });
    await expect(WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', { quoteId: 'q-1' }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
  });

  it('requires a quoteId for CONTRACTOR_ASSIGNED', async () => {
    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    await expect(WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
  });

  it('COMPLETE -> INVOICED: requires an existing invoice row', async () => {
    setRow(mockWorkOrder({ state: 'COMPLETE' }));
    db.invoice.findUnique.mockResolvedValue(null);
    await expect(WorkOrderService.transition('wo-1', 'INVOICED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

    setRow(mockWorkOrder({ state: 'COMPLETE' }));
    db.invoice.findUnique.mockResolvedValue({ invoiceId: 'inv-1' });
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'INVOICED' }));
    await WorkOrderService.transition('wo-1', 'INVOICED', {}, ctx('PLATFORM_ADMIN'));
    expect(db.workOrder.update).toHaveBeenCalledTimes(1);
  });

  it('INVOICED -> FINISHED: requires paid === true', async () => {
    setRow(mockWorkOrder({ state: 'INVOICED' }));
    await expect(WorkOrderService.transition('wo-1', 'FINISHED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);

    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'FINISHED' }));
    const result = await WorkOrderService.transition('wo-1', 'FINISHED', { paid: true }, ctx('PLATFORM_ADMIN'));
    expect(result.state).toBe('FINISHED');
  });

  it('CLOSED: flips remaining OPENED quotations to CLOSED', async () => {
    for (const from of ['CREATED', 'OUT_FOR_QUOTES', 'QUOTES_IN'] as const) {
      vi.clearAllMocks();
      setRow(mockWorkOrder({ state: from }));
      db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'CLOSED' }));

      const opts: TransitionOptions = {};
      if (from === 'OUT_FOR_QUOTES') Object.assign(opts, { contractorIds: undefined });
      const result = await WorkOrderService.transition('wo-1', 'CLOSED', {}, ctx('PLATFORM_ADMIN'));
      expect(result.state).toBe('CLOSED');

      const updateManyArgs = db.quotation.updateMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(updateManyArgs.where.workOrderId).toBe('wo-1');
      expect((updateManyArgs.where as Record<string, unknown>).state).toBe('OPENED');
    }
  });

  it('rejects non-super-admins', async () => {
    await expect(WorkOrderService.transition('wo-1', 'CLOSED', {}, ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    expect(db.workOrder.update).not.toHaveBeenCalled();
  });

  it('throws NotFound when the row does not exist', async () => {
    setRow(null);
    await expect(WorkOrderService.transition('missing', 'CLOSED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
  });

  it('runs all side effects inside ONE $transaction', async () => {
    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    tx.quotation.findFirst.mockResolvedValue({ quoteId: 'q-1', workOrderId: 'wo-1', contractorId: 'c-7', state: 'OPENED' });
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'CONTRACTOR_ASSIGNED', contractorId: 'c-7' }));

    await WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', { quoteId: 'q-1' }, ctx('PLATFORM_ADMIN'));

    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('dispatches RFQ email AFTER the committed transaction (and assignment/invoice-request events fire for their hops)', async () => {
    const dispatcher = vi.fn().mockResolvedValue(undefined);
    setWorkOrderEmailDispatcher(dispatcher);

    // OUT_FOR_QUOTES → rfq event with contractor list + due date.
    setRow(mockWorkOrder());
    tx.quotation.create.mockResolvedValue({ quoteId: 'q-1' });
    db.workOrder.update.mockImplementation(async (args: { data: Record<string, unknown> }) =>
      mockWorkOrder({ state: args.data.state as string, quotesDue: args.data.quotesDue as Date }),
    );
    const beforeCommit = 0;
    await WorkOrderService.transition(
      'wo-1',
      'OUT_FOR_QUOTES',
      { contractorIds: ['c-1', 'c-2'], quotesDue: new Date('2026-10-24T09:00:00Z') },
      ctx('PLATFORM_ADMIN'),
    );
    expect(dispatcher).toHaveBeenCalledTimes(1);
    const rfqCall = dispatcher.mock.calls[0][0];
    expect(rfqCall.event).toBe('rfq');
    expect(rfqCall.contractorIds).toEqual(['c-1', 'c-2']);
    expect(new Date(rfqCall.quotesDue as Date).toISOString()).toBe('2026-10-24T09:00:00.000Z');
    // Email runs after the transaction resolved (db.update was called before dispatch).
    expect(db.workOrder.update.mock.invocationCallOrder[0]).toBeLessThan(dispatcher.mock.invocationCallOrder[0]);

    // ASSIGNMENT → assignment event to the winning contractor.
    vi.clearAllMocks();
    setRow(mockWorkOrder({ state: 'QUOTES_IN' }));
    tx.quotation.findFirst.mockResolvedValue({ quoteId: 'q-1', workOrderId: 'wo-1', contractorId: 'c-7', state: 'OPENED' });
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'CONTRACTOR_ASSIGNED', contractorId: 'c-7' }));
    await WorkOrderService.transition('wo-1', 'CONTRACTOR_ASSIGNED', { quoteId: 'q-1' }, ctx('PLATFORM_ADMIN'));
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(dispatcher.mock.calls[0][0]).toMatchObject({ event: 'assignment', contractorIds: ['c-7'] });

    // COMPLETE → invoice_request event.
    vi.clearAllMocks();
    setRow(mockWorkOrder({ state: 'STARTED', contractorId: 'c-7' }));
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'COMPLETE', contractorId: 'c-7' }));
    await WorkOrderService.transition('wo-1', 'COMPLETE', {}, ctx('PLATFORM_ADMIN'));
    expect(dispatcher).toHaveBeenCalledTimes(1);
    expect(dispatcher.mock.calls[0][0]).toMatchObject({ event: 'invoice_request', contractorIds: ['c-7'] });

    setWorkOrderEmailDispatcher(null);
  });

  it('email dispatch failure never fails the transition (at-most-once tolerance)', async () => {
    setWorkOrderEmailDispatcher(vi.fn().mockRejectedValue(new Error('smtp down')));
    setRow(mockWorkOrder());
    tx.quotation.create.mockResolvedValue({ quoteId: 'q-1' });
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ state: 'OUT_FOR_QUOTES' }));

    const result = await WorkOrderService.transition(
      'wo-1',
      'OUT_FOR_QUOTES',
      { contractorIds: ['c-1'], quotesDue: new Date() },
      ctx('PLATFORM_ADMIN'),
    );
    expect(result.state).toBe('OUT_FOR_QUOTES');
    setWorkOrderEmailDispatcher(null);
  });
});

// ---------------------------------------------------------------------------
// transition — illegal set
// ---------------------------------------------------------------------------

describe('WorkOrderService.transition (illegal)', () => {
  beforeEach(() => vi.clearAllMocks());

  const cases: Array<[string, string]> = [
    // Skips.
    ['CREATED', 'QUOTES_IN'],
    ['CREATED', 'CONTRACTOR_ASSIGNED'],
    ['CREATED', 'STARTED'],
    ['CREATED', 'COMPLETE'],
    ['CREATED', 'INVOICED'],
    ['CREATED', 'FINISHED'],
    ['OUT_FOR_QUOTES', 'STARTED'],
    ['OUT_FOR_QUOTES', 'COMPLETE'],
    ['QUOTES_IN', 'STARTED'],
    ['CONTRACTOR_ASSIGNED', 'CLOSED'],
    // Backward hops.
    ['OUT_FOR_QUOTES', 'CREATED'],
    ['STARTED', 'CONTRACTOR_ASSIGNED'],
    ['COMPLETE', 'STARTED'],
    ['INVOICED', 'COMPLETE'],
    ['FINISHED', 'INVOICED'],
    ['CLOSED', 'CREATED'],
    // Terminal sinks.
    ['FINISHED', 'STARTED'],
  ];

  it.each(cases)('%s -> %s is rejected as an illegal transition', async (from, to) => {
    setRow(mockWorkOrder({ state: from }));
    await expect(
      WorkOrderService.transition('wo-1', to as never, {}, ctx('PLATFORM_ADMIN')),
    ).rejects.toThrow(new RegExp(`Illegal transition ${from} -> ${to}`));
  });

  it('illegal transitions never touch the database', async () => {
    setRow(mockWorkOrder({ state: 'FINISHED' }));
    await expect(WorkOrderService.transition('wo-1', 'STARTED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(/Illegal transition/);
    expect(db.workOrder.update).not.toHaveBeenCalled();
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it('messages name the from and to states', async () => {
    setRow(mockWorkOrder({ state: 'STARTED' }));
    await expect(WorkOrderService.transition('wo-1', 'FINISHED', {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow('Illegal transition STARTED -> FINISHED');
  });
});

// ---------------------------------------------------------------------------
// update / delete / reads
// ---------------------------------------------------------------------------

describe('WorkOrderService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates description and openedBy (super-admin only)', async () => {
    setRow(mockWorkOrder());
    db.workOrder.update.mockResolvedValue(mockWorkOrder({ description: 'New scope' }));

    const result = await WorkOrderService.update('wo-1', { description: 'New scope', openedBy: 'new@org.example' }, ctx('PLATFORM_ADMIN'));

    expect(result.description).toBe('New scope');
    const args = db.workOrder.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.openedBy).toBe('new@org.example');
  });

  it('only description and openedBy are editable — state must go through transition', async () => {
    setRow(mockWorkOrder());
    db.workOrder.update.mockResolvedValue(mockWorkOrder());

    await WorkOrderService.update('wo-1', { description: 'x' }, ctx('PLATFORM_ADMIN'));
    const args = db.workOrder.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(args.data.description).toBe('x');
    // State is NOT an editable field — UpdateWorkOrderInput has no state member
    // (compile-time guard); a stray one would fail type-check here.
    expect('state' in args.data).toBe(false);
    expect('contractorId' in args.data).toBe(false);
  });

  it('rejects non-super-admins', async () => {
    await expect(WorkOrderService.update('wo-1', { description: 'x' }, ctx('MEMBER'))).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFound when absent', async () => {
    setRow(null);
    await expect(WorkOrderService.update('missing', { description: 'x' }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
  });
});

describe('WorkOrderService.delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the row only (children cascade via FK) — super-admin gated', async () => {
    setRow(mockWorkOrder());
    db.workOrder.delete.mockResolvedValue({ workOrderId: 'wo-1' });

    const result = await WorkOrderService.delete('wo-1', ctx('PLATFORM_ADMIN'));

    expect(result).toEqual({ success: true });
    expect(db.workOrder.delete).toHaveBeenCalledTimes(1);
    // Only the work order row itself is deleted — notes/quotes/invoice
    // disappear via FK cascade (no explicit child deletes here).
    expect(tx.quotation.create).not.toHaveBeenCalled();
  });

  it('rejects non-super-admins and throws NotFound when absent', async () => {
    await expect(WorkOrderService.delete('wo-1', ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    setRow(null);
    await expect(WorkOrderService.delete('missing', ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
  });
});

describe('read paths (getById / list)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getById works for tenant ctx of own org and platform ctx', async () => {
    db.workOrder.findUnique.mockResolvedValue(mockWorkOrder());
    const r1 = await WorkOrderService.getById('wo-1', ctx('TENANT_ADMIN', 'org-1'));
    const r2 = await WorkOrderService.getById('wo-1', ctx('MEMBER', 'org-1'));
    expect(r1.workOrderId).toBe('wo-1');
    expect(r2.workOrderId).toBe('wo-1');
  });

  it('getById throws NotFound when absent (RLS hides foreign-org rows → null)', async () => {
    db.workOrder.findUnique.mockResolvedValue(null);
    await expect(WorkOrderService.getById('wo-1', ctx('MEMBER', 'org-A'))).rejects.toThrow(NotFoundError);
  });

  it('list applies state filter, org filter and search on description/openedBy', async () => {
    db.workOrder.findMany.mockResolvedValue([mockWorkOrder()]);
    db.workOrder.count.mockResolvedValue(1);

    const result = await WorkOrderService.list(
      { state: 'OUT_FOR_QUOTES', organizationId: 'org-1', search: 'lift' },
      { page: 2, pageSize: 50 },
      ctx('PLATFORM_ADMIN'),
    );

    expect(result.pagination).toEqual({ page: 2, pageSize: 50, total: 1, totalPages: 1 });
    const args = db.workOrder.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where.state).toBe('OUT_FOR_QUOTES');
    expect(args.where.organizationId).toBe('org-1');
    expect(args.where.OR).toHaveLength(2); // description + openedBy
    expect(db.workOrder.findMany.mock.calls[0][0].take).toBe(50);
  });

  it('list rejects an invalid state filter', async () => {
    await expect(WorkOrderService.list({ state: 'BOGUS' as never }, {}, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
  });

  it('reads do NOT require super admin — a MEMBER reading own org passes the service gate (RLS enforces)', async () => {
    db.workOrder.findMany.mockResolvedValue([]);
    db.workOrder.count.mockResolvedValue(0);
    const result = await WorkOrderService.list({}, {}, ctx('MEMBER', 'org-1'));
    expect(result.items).toEqual([]);
  });
});

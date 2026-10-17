/**
 * Unit tests for WorkOrderNoteService — note CRUD against a work order.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  WorkOrderNoteService,
} from '@/services/work-order-note-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

const { tx } = vi.hoisted(() => {
  return {
    tx: {
      workOrderNote: {
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    },
  };
});

vi.mock('@/lib/tenant-db', () => {
  const tenantDb = { workOrderNote: tx.workOrderNote, workOrder: {} as Record<string, unknown> };
  return { default: tenantDb };
});

vi.mock('@/services/work-order-service', () => ({
  WorkOrderService: { getById: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as workOrderServiceModule from '@/services/work-order-service';

const db = tx as unknown as {
  workOrderNote: Record<string, ReturnType<typeof vi.fn>>;
};

const ctx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockWorkOrder = (state = 'STARTED') => ({
  workOrderId: 'wo-1',
  description: 'Lift inspection',
  openedBy: 'admin@example.com',
  state,
  organizationId: 'org-1',
});

/** Stub the parent-work-order lookup used for terminal-state and org checks. */
function withWorkOrder(state?: string | null) {
  if (state === null) {
    (workOrderServiceModule.WorkOrderService.getById as ReturnType<typeof vi.fn>).mockRejectedValue(
      new NotFoundError('Work order not found'),
    );
  } else {
    (workOrderServiceModule.WorkOrderService.getById as ReturnType<typeof vi.fn>).mockResolvedValue(mockWorkOrder(state));
  }
}

const validCreate = (extra: Partial<{ note: string; workOrderId: string }> = {}) => ({
  note: 'Contractor called, rescheduling for Monday.',
  workOrderId: 'wo-1',
  ...extra,
});

describe('WorkOrderNoteService', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('create', () => {
    it('creates a note on the work order (super-admin only)', async () => {
      withWorkOrder('STARTED');
      db.workOrderNote.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.note).toBe(validCreate().note);
        expect(args.data.workOrderId).toBe('wo-1');
        return { workOrderNoteId: 'note-1', ...args.data } as never;
      });

      const result = await WorkOrderNoteService.create(validCreate(), ctx('PLATFORM_ADMIN'));
      expect(result.note).toBe(validCreate().note);
    });

    it('rejects non-super-admins (before any DB work)', async () => {
      withWorkOrder('STARTED');
      await expect(WorkOrderNoteService.create(validCreate(), ctx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
      expect(db.workOrderNote.create).not.toHaveBeenCalled();
    });

    it('requires non-empty note text of at most 2000 chars', async () => {
      await expect(WorkOrderNoteService.create(validCreate({ note: '   ' }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
      await expect(WorkOrderNoteService.create(validCreate({ note: 'x'.repeat(2001) }), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('rejects notes on terminal work orders (FINISHED / CLOSED)', async () => {
      withWorkOrder('FINISHED');
      await expect(WorkOrderNoteService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
      withWorkOrder('CLOSED');
      await expect(WorkOrderNoteService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('throws NotFound when the work order does not exist', async () => {
      withWorkOrder(null);
      await expect(WorkOrderNoteService.create(validCreate(), ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });
  });

  describe('list', () => {
    it('lists a work order\'s notes oldest-first for any verified ctx (RLS enforces boundary)', async () => {
      db.workOrderNote.findMany.mockResolvedValue([{ workOrderNoteId: 'n1' }]);
      const result = await WorkOrderNoteService.list({ workOrderId: 'wo-1' }, ctx('MEMBER', 'org-1'));
      expect(result).toHaveLength(1);
      expect(db.workOrderNote.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'asc' });
    });

    it('requires a workOrderId', async () => {
      await expect(WorkOrderNoteService.list({} as Record<string, unknown>, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });
  });

  describe('update / delete', () => {
    const noteRow = { workOrderNoteId: 'note-1', workOrderId: 'wo-1', note: 'old', createdById: null };

    it('updates the note text — super-admin gated, NotFound when absent', async () => {
      withWorkOrder('STARTED');
      db.workOrderNote.findUnique.mockResolvedValue(noteRow);
      db.workOrderNote.update.mockResolvedValue({ ...noteRow, note: 'new' });

      const result = await WorkOrderNoteService.update('note-1', { note: 'new' }, ctx('PLATFORM_ADMIN'));
      expect(result.note).toBe('new');

      vi.clearAllMocks();
      withWorkOrder('STARTED');
      db.workOrderNote.findUnique.mockResolvedValue(null);
      await expect(WorkOrderNoteService.update('missing', { note: 'new' }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });

    it('blocks update/delete on terminal work orders', async () => {
      withWorkOrder('CLOSED');
      db.workOrderNote.findUnique.mockResolvedValue(noteRow);
      await expect(WorkOrderNoteService.update('note-1', { note: 'new' }, ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
      await expect(WorkOrderNoteService.delete('note-1', ctx('PLATFORM_ADMIN'))).rejects.toThrow(ValidationError);
    });

    it('delete removes the row — super-admin gated', async () => {
      withWorkOrder('STARTED');
      db.workOrderNote.findUnique.mockResolvedValue(noteRow);
      db.workOrderNote.delete.mockResolvedValue(noteRow);
      const result = await WorkOrderNoteService.delete('note-1', ctx('PLATFORM_ADMIN'));
      expect(result).toEqual({ success: true });

      await expect(WorkOrderNoteService.delete('note-1', ctx('MEMBER'))).rejects.toThrow(ForbiddenError);
    });
  });
});

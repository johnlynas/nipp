/**
 * Unit tests for services/work-order-deadline-handler.ts — hourly quote-deadline
 * scan (design §Scheduling): idempotent overdue alerting, tenant-pinned writes.
 *
 * Mocks @/lib/tenant-db, the RLS context wrappers (pass-throughs), and
 * pushNotification. The clock is injected via the `now` option so idempotency
 * can be proven deterministically.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tenantDbMock, mockPush, platformCtxCalls, adminCtxCalls } = vi.hoisted(() => ({
  tenantDbMock: {
    workOrder: { findMany: vi.fn(), update: vi.fn() },
    organization: { findUnique: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Fairview HA' }) },
  },
  mockPush: vi.fn().mockResolvedValue(undefined),
  platformCtxCalls: vi.fn(),
  adminCtxCalls: vi.fn(),
}));

vi.mock('@/lib/tenant-db', () => ({ default: tenantDbMock }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/notification-push', () => ({ pushNotification: mockPush }));

// Wrap context calls so tests can assert the SCAN runs platform and each WRITE
// pins a tenant-admin context on the affected row's org (write-context rule).
vi.mock('@/lib/rls-transaction', () => ({
  withEnvPlatformContext: async (op: () => Promise<unknown>) => {
    platformCtxCalls();
    return op();
  },
}));
vi.mock('@/lib/platform-db', () => ({
  withTenantAdminContext: async (_userId: string, orgId: string, op: () => Promise<unknown>) => {
    adminCtxCalls(orgId);
    return op();
  },
}));

import { runWorkOrderDeadlineScan, workOrdersQuoteDeadlinesHandler } from '@/services/work-order-deadline-handler';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import type { JobRunContext } from '@/services/job-scheduler-service';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = new Date('2026-10-18T10:00:00Z');
const OVERDUE = new Date('2026-10-17T09:00:00Z'); // past due at NOW
const FUTURE = new Date('2026-10-25T09:00:00Z');  // not yet due

const overdueRow = {
  workOrderId: 'wo-overdue',
  organizationId: 'org-1',
  state: 'OUT_FOR_QUOTES' as const,
  quotesDue: OVERDUE,
  deadlineAlertAt: null,
};

const futureRow = {
  workOrderId: 'wo-future',
  organizationId: 'org-2',
  state: 'OUT_FOR_QUOTES' as const,
  quotesDue: FUTURE,
  deadlineAlertAt: null,
};

const alertedRow = {
  workOrderId: 'wo-alerted',
  organizationId: 'org-3',
  state: 'OUT_FOR_QUOTES' as const,
  quotesDue: OVERDUE,
  deadlineAlertAt: new Date('2026-10-17T10:00:00Z'), // already alerted
};

function setFindMany(rows: unknown[]) {
  (tenantDbMock.workOrder.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
}

beforeEach(() => {
  vi.clearAllMocks();
  (tenantDbMock.organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'org-1', name: 'Fairview Housing Association' });
});

// ---------------------------------------------------------------------------
// Scan behavior
// ---------------------------------------------------------------------------

describe('runWorkOrderDeadlineScan', () => {
  it('alerts EXACTLY ONCE for a past-due row: notification rows + deadlineAlertAt under the row\'s org context', async () => {
    setFindMany([overdueRow]);
    (tenantDbMock.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({ workOrderId: 'wo-overdue' });

    const result = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });

    expect(result).toEqual({ scanned: 1, alerted: 1 });

    // The UPDATE of deadlineAlertAt runs pinned to the row's org…
    expect(adminCtxCalls).toHaveBeenCalledWith('org-1');
    const updateArgs = (tenantDbMock.workOrder.update as ReturnType<typeof vi.fn>).mock.calls[0][0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(updateArgs.where.workOrderId).toBe('wo-overdue');
    expect(new Date(updateArgs.data.deadlineAlertAt as Date).toISOString()).toBe(NOW.toISOString());

    // …and both an ORG-scoped and a GLOBAL-scope notification were pushed,
    // each carrying the work order id in the message.
    const pushes = mockPush.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(pushes).toHaveLength(2);
    const orgPush = pushes.find((p) => p.scope === NotificationScope.ORG)!;
    const globalPush = pushes.find((p) => p.scope === NotificationScope.GLOBAL)!;
    expect(orgPush.organizationId).toBe('org-1');
    expect(String(orgPush.title)).toContain('wo-overdue');
    expect(String(globalPush.message)).toContain('wo-overdue');
    // WARNING priority for the admin escalation (design §Scheduling).
    expect([orgPush.priority, globalPush.priority]).toEqual([NotificationPriority.WARNING, NotificationPriority.WARNING]);
  });

  it('idempotent: a second run at the same clock finds no rows and alerts nothing', async () => {
    // First run: one overdue row.
    setFindMany([overdueRow]);
    (tenantDbMock.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({ workOrderId: 'wo-overdue' });
    const first = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });
    expect(first).toEqual({ scanned: 1, alerted: 1 });

    // Second run at the SAME clock: deadlineAlertAt was set, so the query's
    // `deadlineAlertAt: null` filter excludes the row — the scan returns none.
    vi.clearAllMocks();
    setFindMany([]);
    const second = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });
    expect(second).toEqual({ scanned: 0, alerted: 0 });
    expect(tenantDbMock.workOrder.update).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('a row with a FUTURE due date is never returned by the scan query', async () => {
    // Guard the QUERY shape itself (not just mock behavior): quotesDue upper
    // bound `lte now` and null-alert filter must be present.
    setFindMany([]);
    await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });

    const findManyWhere = ((tenantDbMock.workOrder.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(findManyWhere.state).toBe('OUT_FOR_QUOTES');
    expect((findManyWhere.quotesDue as Record<string, unknown>).lte).toEqual(NOW);
    expect(findManyWhere.deadlineAlertAt).toBeNull();
  });

  it('alerts multiple overdue rows across orgs, each pinned to its own org context', async () => {
    setFindMany([overdueRow, { ...overdueRow, workOrderId: 'wo-2', organizationId: 'org-9' }]);
    (tenantDbMock.workOrder.update as ReturnType<typeof vi.fn>).mockResolvedValue({ workOrderId: 'x' });

    const result = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });

    expect(result).toEqual({ scanned: 2, alerted: 2 });
    expect(adminCtxCalls).toHaveBeenCalledWith('org-1');
    expect(adminCtxCalls).toHaveBeenCalledWith('org-9');
    // 2 rows × (ORG + GLOBAL) notifications.
    expect(mockPush).toHaveBeenCalledTimes(4);
  });

  it('a single failing row does not stop the rest, and is counted in scanned only', async () => {
    setFindMany([overdueRow, { ...overdueRow, workOrderId: 'wo-boom', organizationId: 'org-bad' }]);
    (tenantDbMock.workOrder.update as ReturnType<typeof vi.fn>).mockImplementation(async ({ where }: { where: { workOrderId: string } }) => {
      if (where.workOrderId === 'wo-boom') throw new Error('rls reject');
      return { workOrderId: where.workOrderId };
    });

    const result = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });

    expect(result).toEqual({ scanned: 2, alerted: 1 });
    // The healthy row still got its notifications.
    const pushes = mockPush.mock.calls.map((c) => c[0] as Record<string, unknown>);
    expect(pushes.find((p) => String(p.message).includes('wo-overdue'))).toBeDefined();
  });

  it('returns an empty summary when nothing is due', async () => {
    setFindMany([]);
    const result = await runWorkOrderDeadlineScan({ now: NOW, platformUserId: 'platform-admin-1' });
    expect(result).toEqual({ scanned: 0, alerted: 0 });
    expect(platformCtxCalls).toHaveBeenCalledTimes(1); // the scan read itself
    expect(adminCtxCalls).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Built-in job handler shape (goes to JobExecution.resultJson)
// ---------------------------------------------------------------------------

describe('workOrdersQuoteDeadlinesHandler', () => {
  // The JobHandler contract returns unknown (JSON-serializable, persisted to
  // resultJson) — these tests assert the shape.
  const run = (ctx: JobRunContext) => workOrdersQuoteDeadlinesHandler(ctx) as Promise<{ handler: string; scanned: number; alerted: number }>;

  it('returns the {scanned, alerted} summary as a JSON-serializable result', async () => {
    setFindMany([]);
    const ctx: JobRunContext = { jobDefinitionId: 'job-wo', platformOrgId: 'platform-org', trigger: 'SCHEDULE' };
    const result = await run(ctx);
    expect(result).toEqual({ handler: 'work-order-quote-deadlines', scanned: 0, alerted: 0 });
  });

  it('accepts an ISO `now` from the job input (manual trigger / dry-run)', async () => {
    setFindMany([]);
    const ctx: JobRunContext = {
      jobDefinitionId: 'job-wo',
      platformOrgId: 'platform-org',
      trigger: 'MANUAL',
      input: { now: NOW.toISOString() },
    };
    const result = await run(ctx);
    expect(result.scanned).toBe(0);
    const findManyWhere = ((tenantDbMock.workOrder.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect((findManyWhere.quotesDue as Record<string, unknown>).lte).toEqual(NOW);
  });
});

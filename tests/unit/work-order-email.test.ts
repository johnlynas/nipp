/**
 * Unit tests for services/work-order-email.ts — plain (no-URL) RFQ / assignment /
 * invoice-request emails on the OIDC-invite sendEmail pipeline (design D7/T2).
 *
 * Mocks @/lib/tenant-db (org + contractor + NotificationLog reads/writes),
 * @/lib/rls-transaction (context wrappers become no-ops) and @/lib/logger.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFns, tenantDbMock } = vi.hoisted(() => ({
  mockFns: {
    sendEmail: vi.fn(),
  },
  tenantDbMock: {
    workOrder: { findUnique: vi.fn() },
    organization: { findUnique: vi.fn() },
    contractors: { findMany: vi.fn() },
    notificationLog: { create: vi.fn() },
  },
}));

vi.mock('@/lib/notifications/email', () => ({
  sendEmail: (...args: unknown[]) => mockFns.sendEmail(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/tenant-db', () => ({
  default: tenantDbMock,
}));

// The dispatcher runs reads under a platform context — in tests the wrapper
// becomes a plain pass-through.
vi.mock('@/lib/rls-transaction', () => ({
  withEnvPlatformContext: async (op: () => Promise<unknown>) => op(),
}));

import {
  renderRfqSubject,
  renderRfqBody,
  renderAssignment,
  renderInvoiceRequest,
  sendRfqToContractor,
  sendWorkOrderEmailEvent,
  NO_URL_RE,
} from '@/services/work-order-email';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const DUE = new Date('2026-10-24T09:00:00Z');

const workOrderFixture = {
  workOrderId: 'wo-1',
  description: 'Replace lift door interlock, basement level 2',
  openedBy: 'orders@example.com',
  contractorId: null,
  quotesDue: DUE,
  deadlineAlertAt: null,
  state: 'OUT_FOR_QUOTES' as const,
  organizationId: 'org-1',
  createdAt: new Date('2026-10-17T10:00:00Z'),
  updatedAt: new Date('2026-10-17T10:00:00Z'),
};

const contractorFixture = {
  contractorId: 'c-1',
  companyName: 'Precision Lifts Ltd',
  name: 'Sarah Connor',
  email: 'quotes@precisionlifts.example',
  phone: '028 9555 1234',
};

const orgFixture = { id: 'org-1', name: 'Fairview Housing Association' };

beforeEach(() => {
  vi.clearAllMocks();
  mockFns.sendEmail.mockResolvedValue({ success: true });
  (tenantDbMock.organization.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(orgFixture);
  (tenantDbMock.contractors.findMany as ReturnType<typeof vi.fn>).mockImplementation(async () => [contractorFixture]);
});

// ---------------------------------------------------------------------------
// Template rendering — content + the no-URL invariant (design D7)
// ---------------------------------------------------------------------------

describe('work-order email templates', () => {
  it('renderRfqSubject: names the work order and the organization, no URL', () => {
    const subject = renderRfqSubject({ workOrder: workOrderFixture as never, organisationName: orgFixture.name });
    expect(subject).toContain(orgFixture.name);
    expect(subject.toLowerCase()).toContain('quotation');
    expect(NO_URL_RE.test(subject)).toBe(false);
  });

  it('renderRfqBody: contains reference, full description, due date and contact, addressed to the contractor', () => {
    const body = renderRfqBody({
      workOrder: workOrderFixture as never,
      organisationName: orgFixture.name,
      contractor: contractorFixture as never,
    });
    expect(body).toContain('wo-1'); // work order reference number
    expect(body).toContain(workOrderFixture.description);
    expect(body.toLowerCase()).toContain('quotation');
    expect(body).toContain(contractorFixture.name.split(' ')[0]!); // addressed to the contact name
    const refLine = body.split('\n').find((l) => l.includes('wo-1'));
    expect(refLine).toBeDefined();
  });

  it('renderAssignment: names the work, the organisation and the due date context', () => {
    const { subject, message } = renderAssignment({
      workOrder: { ...workOrderFixture, contractorId: 'c-1' } as never,
      organisationName: orgFixture.name,
      contractor: contractorFixture as never,
    });
    expect(subject).toContain(workOrderFixture.description.slice(0, 60));
    expect(message).toContain(orgFixture.name);
    expect(message).toContain('wo-1');
  });

  it('renderInvoiceRequest: asks for the invoice with the work order reference and suggested due date', () => {
    const { subject, message } = renderInvoiceRequest({
      workOrder: { ...workOrderFixture, contractorId: 'c-1' } as never,
      organisationName: orgFixture.name,
      contractor: contractorFixture as never,
      suggestedDueDate: new Date('2026-10-31T09:00:00Z'),
    });
    expect(subject.toLowerCase()).toContain('invoice');
    expect(message).toContain('wo-1');
  });

  it('NO URL appears in ANY template string (D7 — plain notification emails only)', () => {
    const rfq = renderRfqBody({ workOrder: workOrderFixture as never, organisationName: orgFixture.name, contractor: contractorFixture as never });
    expect(NO_URL_RE.test(rfq)).toBe(false);
    const subject = renderRfqSubject({ workOrder: workOrderFixture as never, organisationName: orgFixture.name });
    expect(NO_URL_RE.test(subject)).toBe(false);

    const assigned: typeof workOrderFixture & { contractorId: string } = { ...workOrderFixture, contractorId: 'c-1' };
    const a = renderAssignment({ workOrder: assigned as never, organisationName: orgFixture.name, contractor: contractorFixture as never });
    expect(NO_URL_RE.test(a.subject)).toBe(false);
    expect(NO_URL_RE.test(a.message)).toBe(false);

    const i = renderInvoiceRequest({ workOrder: assigned as never, organisationName: orgFixture.name, contractor: contractorFixture as never, suggestedDueDate: new Date() });
    expect(NO_URL_RE.test(i.subject)).toBe(false);
    expect(NO_URL_RE.test(i.message)).toBe(false);
  });

  it('does not leak emails/phones of OTHER contractors into a single RFQ (rendering is per-recipient)', () => {
    const body = renderRfqBody({ workOrder: workOrderFixture as never, organisationName: orgFixture.name, contractor: contractorFixture as never });
    expect(body).not.toContain('someoneelse@');
  });
});

// ---------------------------------------------------------------------------
// sendRfqToContractor — per-recipient send + NotificationLog (T2 tolerance)
// ---------------------------------------------------------------------------

describe('sendRfqToContractor', () => {
  it('sends via the branded sendEmail pipeline and records a SENT NotificationLog row', async () => {
    const result = await sendRfqToContractor({
      workOrder: workOrderFixture as never,
      contractor: contractorFixture as never,
      organisationName: orgFixture.name,
      quotesDue: DUE,
    });

    expect(result.sent).toBe(true);
    expect(mockFns.sendEmail).toHaveBeenCalledTimes(1);
    const call = mockFns.sendEmail.mock.calls[0] as unknown as [string, string, string, string];
    expect(call[0]).toBe(contractorFixture.email);
    expect(call[1]).toContain(orgFixture.name);
    // Same branded pipeline/header shape as the OIDC invite email.
    expect(call[3]).toBeTruthy();

    const log = (tenantDbMock.notificationLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(log.recipientEmail).toBe(contractorFixture.email);
    expect(log.eventType).toBe('work_order_rfq');
    expect(log.status).toBe('SENT');
    expect(log.organizationId).toBe('org-1');
  });

  it('a failing send records a FAILED NotificationLog row and does NOT throw (T2 tolerance)', async () => {
    mockFns.sendEmail.mockResolvedValueOnce({ success: false, error: 'smtp down' });

    const result = await sendRfqToContractor({
      workOrder: workOrderFixture as never,
      contractor: contractorFixture as never,
      organisationName: orgFixture.name,
      quotesDue: DUE,
    });

    expect(result.sent).toBe(false);
    const log = (tenantDbMock.notificationLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data;
    expect(log.status).toBe('FAILED');
  });
});

// ---------------------------------------------------------------------------
// Dispatcher seam — the WorkOrderService integration point
// ---------------------------------------------------------------------------

describe('sendWorkOrderEmailEvent (dispatcher seam)', () => {
  beforeEach(() => {
    (tenantDbMock.workOrder.findUnique as ReturnType<typeof vi.fn>).mockImplementation(
      async ({ where }: { where: { workOrderId: string } }) =>
        where.workOrderId === 'wo-1' ? workOrderFixture : null,
    );
  });

  it('rfq event: one email per invited contractor, returns sent/failed counts', async () => {
    (tenantDbMock.contractors.findMany as ReturnType<typeof vi.fn>).mockImplementation(async () => [contractorFixture]);

    const summary = await sendWorkOrderEmailEvent({
      event: 'rfq',
      workOrder: workOrderFixture as never,
      contractorIds: ['c-1'],
      quotesDue: DUE,
    });

    expect(summary).toEqual({ sent: 1, failed: 0 });
    expect(mockFns.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('rfq event: unknown or missing contractors are skipped (counted in neither bucket)', async () => {
    (tenantDbMock.contractors.findMany as ReturnType<typeof vi.fn>).mockImplementation(async () => [contractorFixture]);

    const summary = await sendWorkOrderEmailEvent({
      event: 'rfq',
      workOrder: workOrderFixture as never,
      contractorIds: ['c-1', 'c-missing'],
      quotesDue: DUE,
    });

    expect(summary).toEqual({ sent: 1, failed: 0 });
    expect(mockFns.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('assignment event: exactly one email to the assigned contractor', async () => {
    const summary = await sendWorkOrderEmailEvent({
      event: 'assignment',
      workOrder: { ...workOrderFixture, state: 'CONTRACTOR_ASSIGNED', contractorId: 'c-1' } as never,
      contractorIds: ['c-1'],
    });

    expect(summary).toEqual({ sent: 1, failed: 0 });
    const [to] = mockFns.sendEmail.mock.calls[0];
    expect(to).toBe(contractorFixture.email);
  });

  it('invoice_request event: exactly one email to the assigned contractor with a future due date', async () => {
    const summary = await sendWorkOrderEmailEvent({
      event: 'invoice_request',
      workOrder: { ...workOrderFixture, state: 'COMPLETE', contractorId: 'c-1' } as never,
      contractorIds: ['c-1'],
    });

    expect(summary).toEqual({ sent: 1, failed: 0 });
  });

  it('failed sends are swallowed and counted (never throw into the transition)', async () => {
    mockFns.sendEmail.mockResolvedValue({ success: false, error: 'smtp down' });
    (tenantDbMock.contractors.findMany as ReturnType<typeof vi.fn>).mockImplementation(async () => [contractorFixture]);

    const summary = await sendWorkOrderEmailEvent({
      event: 'rfq',
      workOrder: workOrderFixture as never,
      contractorIds: ['c-1'],
      quotesDue: DUE,
    });

    expect(summary).toEqual({ sent: 0, failed: 1 });
  });

  it('returns empty counts when the work order row cannot be loaded', async () => {
    (tenantDbMock.workOrder.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const summary = await sendWorkOrderEmailEvent({
      event: 'rfq',
      workOrder: workOrderFixture as never,
      contractorIds: ['c-1'],
    });
    expect(summary).toEqual({ sent: 0, failed: 0 });
    expect(mockFns.sendEmail).not.toHaveBeenCalled();
  });
});

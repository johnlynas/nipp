/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for WorkOrderInvoicePanel (admin work order detail, Plan 3).
 * The panel is pure props-in/fetch-out — the parent's load + onFailed are spy
 * callbacks; only the API surface is global fetch. State coverage mirrors the
 * service contract in services/invoice-service.ts (create@COMPLETE, update@
 * COMPLETE/INVOICED, delete@INVOICED).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { WorkOrderInvoicePanel } from '@/components/dashboard/WorkOrderInvoicePanel';
import type { WorkOrderDetail, WorkOrderInvoice, WorkOrderStateValue } from '@/components/dashboard/work-order-shared';

const now = Date.now();
const iso = (offsetDays: number): string => new Date(now + offsetDays * 86400_000).toISOString();

function baseInvoice(overrides: Partial<WorkOrderInvoice> = {}): WorkOrderInvoice {
  return {
    invoiceId: 'inv-1',
    invoiceDate: iso(-7),
    workOrderId: 'wo-1',
    contractorId: 'c-1',
    invoiceLink: null,
    price: '2400.50',
    dueDate: iso(7), // future — not overdue
    createdAt: iso(-6),
    updatedAt: iso(-6),
    contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
    ...overrides,
  };
}

function detail(state: WorkOrderStateValue, overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    workOrderId: 'wo-1',
    description: 'Rewire kitchen',
    openedBy: 'admin@nipp.example',
    contractorId: 'c-1',
    quotesDue: null,
    state,
    organizationId: 'org-1',
    createdAt: iso(-40),
    updatedAt: iso(-1),
    notes: [],
    quotes: [],
    invoice: null,
    assignedContractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
    ...overrides,
  };
}

function renderPanel(detailProps: WorkOrderDetail) {
  const load = vi.fn(async () => {});
  const onFailed = vi.fn();
  render(<WorkOrderInvoicePanel detail={detailProps} load={load} onFailed={onFailed} />);
  return { load, onFailed };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkOrderInvoicePanel — state-aware shell', () => {
  it('teaches the muted line in all pre-complete states (no form, no card)', () => {
    for (const state of ['CREATED', 'OUT_FOR_QUOTES', 'QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'STARTED'] as const) {
      renderPanel(detail(state));
      expect(screen.getByText(/no invoice recorded yet/i)).toBeInTheDocument();
      // No creation form, no controls.
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByRole('input')).toBeNull();
      cleanup();
    }
  });

  it('offers the creation zone with teaching copy only at COMPLETE with no invoice', () => {
    renderPanel(detail('COMPLETE'));
    expect(screen.getByText(/work is complete — record the contractor/i)).toBeInTheDocument();
    expect(screen.queryByText(/no invoice recorded yet/i)).toBeNull();
  });

  it('renders the card rows with the total as the anchor when an invoice exists', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice() }));

    // Total in the heading row — £2,400.50 rendered by workOrderMoney.
    const total = screen.getByText(/£\s?2,400\.50/);
    expect(total.className).toContain('tabular-nums');

    // Card rows present with formatted values.
    expect(screen.getByText('Invoice date', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Due date', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Contractor', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    expect(screen.getByText(/recorded/i)).toBeInTheDocument();
  });

  it('never hints about Mark Invoiced once the state has moved past COMPLETE', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice() }));
    expect(screen.queryByText(/use mark invoiced above/i)).toBeNull();
    cleanup();

    renderPanel(detail('FINISHED', { invoice: baseInvoice() }));
    expect(screen.queryByText(/use mark invoiced above/i)).toBeNull();
  });

  it('shows the two-step hint ONLY while COMPLETE with a recorded invoice', () => {
    renderPanel(detail('COMPLETE', { invoice: baseInvoice() }));
    expect(screen.getByText(/invoice recorded — use mark invoiced above/i)).toBeInTheDocument();
  });
});

describe('WorkOrderInvoicePanel — overdue + link treatment (incumbent vocabulary)', () => {
  it('tints a past due date with the warning ink and an Overdue suffix', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice({ dueDate: iso(-1) }) }));
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('does not flag a future due date', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice() }));
    expect(screen.queryByText(/overdue/i)).toBeNull();
  });

  it('renders the external View invoice anchor with noopener when a link exists', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice({ invoiceLink: 'https://invoices.example/7' }) }));
    const link = screen.getByRole('link', { name: /view invoice/i });
    expect(link).toHaveAttribute('href', 'https://invoices.example/7');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('omits the link row when no invoice link is set', () => {
    renderPanel(detail('INVOICED', { invoice: baseInvoice() }));
    expect(screen.queryByRole('link', { name: /view invoice/i })).toBeNull();
  });
});

describe('WorkOrderInvoicePanel — terminal invariants', () => {
  it('FINISHED renders the card read-only with zero controls', () => {
    renderPanel(detail('FINISHED', { invoice: baseInvoice() }));
    expect(screen.getByText(/£\s?2,400\.50/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('input')).toBeNull();
  });

  it('CLOSED with no invoice keeps only the teaching line — zero affordances', () => {
    renderPanel(detail('CLOSED'));
    expect(screen.getByText(/no invoice recorded yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

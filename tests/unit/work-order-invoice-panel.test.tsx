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
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorkOrderInvoicePanel } from '@/components/dashboard/WorkOrderInvoicePanel';
import { toLocalInputDate, type WorkOrderDetail, type WorkOrderInvoice, type WorkOrderStateValue } from '@/components/dashboard/work-order-shared';

const now = Date.now();
const iso = (offsetDays: number): string => new Date(now + offsetDays * 86400_000).toISOString();

function callsWith(urlPart: string, method?: string): Array<{ body?: Record<string, unknown> }> {
  const out: Array<{ body?: Record<string, unknown> }> = [];
  for (const [u, i] of vi.mocked(fetch).mock.calls) {
    if (String(u).includes(urlPart) && (!method || (i as RequestInit | undefined)?.method === method)) {
      out.push({ body: i?.body ? JSON.parse(i.body as string) : undefined });
    }
  }
  return out;
}

function json(status: number, payload: Record<string, unknown>, initMethod?: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, reqInit?: RequestInit) => {
      const method = reqInit?.method ?? 'GET';
      if (initMethod && method === initMethod) return new Response(JSON.stringify(payload), { status });
      return new Response('{}', { status: 404 });
    }),
  );
}

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

describe('WorkOrderInvoicePanel — record form (COMPLETE only)', () => {
  function renderCreate(quotes: WorkOrderDetail['quotes'] = []) {
    return renderPanel(
      detail('COMPLETE', {
        quotes,
        assignedContractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
      }),
    );
  }

  it('renders the form zone with Price/Invoice date/Due date/link at COMPLETE and no invoice', () => {
    renderCreate();
    expect(screen.getByLabelText(/price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^invoice date$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/invoice link/i)).toBeInTheDocument();
  });

  it('hides the form in every other state (service gates create to COMPLETE)', () => {
    for (const state of ['CREATED', 'OUT_FOR_QUOTES', 'QUOTES_IN', 'CONTRACTOR_ASSIGNED', 'STARTED'] as const) {
      renderPanel(detail(state));
      expect(screen.queryByRole('button', { name: /record invoice/i }), `${state}`).toBeNull();
      cleanup();
    }
  });

  it('prefills Price from the ACCEPTED quote and names the source, defaulting due date +14 days', () => {
    renderCreate([{
      quoteId: 'q-1',
      workOrderId: 'wo-1',
      contractorId: 'c-1',
      quoteLink: null,
      description: 'Labour + materials',
      price: '2400.50',
      dueDate: iso(-1),
      state: 'ACCEPTED',
      createdAt: iso(-20),
      updatedAt: iso(-7),
      contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
    }]);

    expect(String((screen.getByLabelText(/price/i) as HTMLInputElement).value)).toBe('2400.5');
    expect(screen.getByText(/from byrne electrical ltd’s accepted quote/i)).toBeInTheDocument();

    // Due date defaults to today +14 days (local yyyy-mm-dd round-trip).
    const expectedDue = toLocalInputDate(new Date(Date.now() + 14 * 86400_000));
    expect((screen.getByLabelText(/due date/i) as HTMLInputElement).value).toBe(expectedDue);
  });

  it('disables Record Invoice until price > 0 and both dates are set', () => {
    renderCreate();
    const submit = screen.getByRole('button', { name: /record invoice/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true); // no price yet
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '100' } });
    expect((screen.getByRole('button', { name: /record invoice/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('POSTs the assigned contractor id and numeric price; omits an empty link key', async () => {
    json(201, {}, 'POST');
    const { load } = renderCreate();

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: /record invoice/i }));

    await waitFor(() => {
      const calls = callsWith('/api/admin/invoices', 'POST');
      expect(calls).toHaveLength(1);
      const body = calls[0].body!;
      expect(body.workOrderId).toBe('wo-1');
      expect(body.contractorId).toBe('c-1'); // always the assigned contractor — no picker
      expect(body.price).toBe(950);
      expect('invoiceLink' in body).toBe(false);
      expect(String(body.invoiceDate)).toMatch(/^20\d{2}-\d{2}-\d{2}T12:00:00/); // local noon round-trip
      expect(String(body.dueDate)).toMatch(/^20\d{2}-\d{2}-\d{2}T12:00:00/);
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it('sends the trimmed link only when present', async () => {
    json(201, {}, 'POST');
    renderCreate();

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '950' } });
    fireEvent.change(screen.getByLabelText(/invoice link/i), { target: { value: '  https://invoices.example/8  ' } });
    fireEvent.click(screen.getByRole('button', { name: /record invoice/i }));

    await waitFor(() => expect(callsWith('/api/admin/invoices', 'POST')[0]?.body?.invoiceLink).toBe('https://invoices.example/8'));
  });

  it('surfaces a 409 duplicate verbatim via onFailed and resyncs (load), keeping the form open', async () => {
    json(409, { error: 'Invoice already exists for this work order' }, 'POST');
    const { load, onFailed } = renderCreate();

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: /record invoice/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('Invoice already exists for this work order'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // Form stays open for retry — not collapsed.
    expect(screen.getByRole('button', { name: /record invoice/i })).toBeInTheDocument();
  });

  it('surfaces a 422 state change verbatim and resyncs', async () => {
    json(422, { error: 'Invoices can only be recorded for a COMPLETE work order (current: INVOICED)' }, 'POST');
    const { load, onFailed } = renderCreate();

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '950' } });
    fireEvent.click(screen.getByRole('button', { name: /record invoice/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.stringMatching(/current: INVOICED/)));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it('renders the muted note instead of a form when no contractor is assigned (defensive)', () => {
    renderPanel(detail('COMPLETE', { contractorId: null, assignedContractor: null }));
    expect(screen.getByText(/assign a contractor to record an invoice/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /record invoice/i })).toBeNull();
  });

  it('never renders the form when terminal (disabled)', () => {
    renderPanel(detail('FINISHED'));
    expect(screen.queryByRole('button', { name: /record invoice/i })).toBeNull();
    expect(screen.getByText(/no invoice recorded yet/i)).toBeInTheDocument();
  });
});

describe('WorkOrderInvoicePanel — edit (pre-payment corrections)', () => {
  function renderWithInvoice(state: WorkOrderStateValue) {
    return renderPanel(detail(state, { invoice: baseInvoice() }));
  }

  it('offers the Edit pencil at COMPLETE and INVOICED only (never terminal/other states)', () => {
    for (const state of ['COMPLETE', 'INVOICED'] as const) {
      renderWithInvoice(state);
      expect(screen.getByRole('button', { name: 'Edit invoice' }), `${state}`).toBeInTheDocument();
      cleanup();
    }
    for (const state of ['FINISHED', 'CLOSED', 'STARTED'] as const) {
      renderWithInvoice(state);
      expect(screen.queryByRole('button', { name: 'Edit invoice' }), `${state}`).toBeNull();
      cleanup();
    }
  });

  it('never offers delete outside INVOICED (server rule — COMPLETE would 422)', () => {
    for (const state of ['COMPLETE', 'FINISHED', 'CLOSED', 'STARTED'] as const) {
      renderWithInvoice(state);
      expect(screen.queryByRole('button', { name: 'Delete invoice' }), `${state}`).toBeNull();
      cleanup();
    }
    renderWithInvoice('INVOICED');
    expect(screen.getByRole('button', { name: 'Delete invoice' })).toBeInTheDocument();
  });

  it('prefills edit fields from the stored values and PATCHes on save + resyncs', async () => {
    json(200, {}, 'PATCH');
    const { load } = renderWithInvoice('INVOICED');

    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    // Edit zone labels are the same names with -edit ids.
    expect(String((screen.getByLabelText(/price/i) as HTMLInputElement).value)).toBe('2400.5');

    const todayPlusOne = toLocalInputDate(new Date(Date.now() + 86400_000));
    fireEvent.change(screen.getByLabelText(/invoice date/i), { target: { value: todayPlusOne } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const calls = callsWith('/api/admin/invoices/inv-1', 'PATCH');
      expect(calls).toHaveLength(1);
      const body = calls[0].body!;
      expect(body.price).toBe(2400.5);
      expect(String(body.invoiceDate)).toMatch(/^20\d{2}-\d{2}-\d{2}T12:00:00/);
      expect('dueDate' in body).toBe(true);
    });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // Back to card view.
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('sends link null when cleared (PATCH contract)', async () => {
    json(200, {}, 'PATCH');
    renderPanel(detail('INVOICED', { invoice: baseInvoice({ invoiceLink: 'https://invoices.example/7' }) }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    fireEvent.change(screen.getByLabelText(/invoice link/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(callsWith('/api/admin/invoices/inv-1', 'PATCH')[0]?.body?.invoiceLink).toBeNull());
  });

  it('rejects a non-positive edit price client-side without calling the API', async () => {
    json(200, {}, 'PATCH');
    const { onFailed } = renderWithInvoice('INVOICED');

    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.stringMatching(/greater than zero/i)));
    expect(callsWith('/api/admin/invoices/inv-1', 'PATCH')).toHaveLength(0);
  });

  it('surfaces a concurrent-finish 409 verbatim and resyncs (form closes, card may be gone)', async () => {
    json(409, { error: 'Invoices cannot be edited while the work order is FINISHED' }, 'PATCH');
    const { load, onFailed } = renderWithInvoice('INVOICED');

    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('Invoices cannot be edited while the work order is FINISHED'));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it('Escape exits a clean edit; a dirty edit asks before discarding', async () => {
    renderWithInvoice('INVOICED');

    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull());
    expect(screen.queryByText(/discard changes/i)).toBeNull();

    // Dirty: confirm dialog appears, confirming discards.
    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    fireEvent.change(screen.getByLabelText(/invoice link/i), { target: { value: 'https://x.example' } });
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(await screen.findByText(/discard changes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull());
  });
});

describe('WorkOrderInvoicePanel — delete (INVOICED-only correction flow)', () => {
  it('confirms with the honest consequence copy, issues DELETE, and resyncs', async () => {
    json(200, {}, 'DELETE');
    const { load } = renderPanel(detail('INVOICED', { invoice: baseInvoice() }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete invoice' }));
    expect(await screen.findByText(/delete this invoice\? you will need to re-record it/i)).toBeInTheDocument();
    expect(screen.getByText(/the contractor is not notified/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$|^deleting…$/i }));
    await waitFor(() => expect(callsWith('/api/admin/invoices/inv-1', 'DELETE')).toHaveLength(1));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });

  it('surfaces a blocked delete (409) verbatim to the parent and resyncs', async () => {
    json(409, { error: 'Invoices cannot be deleted while the work order is FINISHED (paid/closed chain is a closed audit record)' }, 'DELETE');
    const { load, onFailed } = renderPanel(detail('INVOICED', { invoice: baseInvoice() }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete invoice' }));
    await screen.findByText(/delete this invoice\?/i);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.stringMatching(/closed audit record/)));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
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

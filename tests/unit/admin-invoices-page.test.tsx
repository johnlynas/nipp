/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the admin Invoices page — stat tiles (billing funnel over
 * parent work order states), table rows with joins, filters, and the edit /
 * delete surface gated by the service rules (edit COMPLETE/INVOICED, delete
 * INVOICED-only). Global fetch is mocked; dashboard components render for real.
 *
 * NOTE on element multiplicity: DataTable renders BOTH a mobile stacked list
 * and a desktop `<table>` — row content queries therefore scope to role="table".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import AdminInvoicesPage from '@/app/dashboard/admin/invoices/page';

/** Invoice row as the page consumes GET /api/admin/invoices. */
const invoiceRow = (overrides: Record<string, unknown> = {}) => ({
  invoiceId: 'inv-1',
  workOrderId: 'wo-1',
  contractorId: 'c-7',
  invoiceLink: null,
  price: 4200,
  invoiceDate: new Date('2026-10-15T12:00:00').toISOString(),
  dueDate: new Date('2026-10-29T12:00:00').toISOString(),
  organizationId: 'org-1',
  organizationName: 'Ashvale Housing',
  createdAt: new Date('2026-10-15T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-10-15T10:00:00Z').toISOString(),
  contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
  workOrder: { description: 'Boiler replacement — Flat 4', state: 'INVOICED' },
  ...overrides,
});

function mockListResponse(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/invoices')) {
        return new Response(
          JSON.stringify({
            items: [invoiceRow()],
            pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
            counts: { COMPLETE: 2, INVOICED: 5, FINISHED: 3, CLOSED: 1 },
            ...overrides,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/admin/work-orders')) {
        return new Response(
          JSON.stringify({
            items: [
              { workOrderId: 'wo-1', description: 'Boiler replacement — Flat 4', organizationName: 'Ashvale Housing', state: 'INVOICED' },
              { workOrderId: 'wo-2', description: 'Roof repair, block B', organizationName: 'Ashvale Housing', state: 'STARTED' },
            ],
            pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

const fetchMock = () => vi.mocked(fetch);

/** Last URL of an invoice list request (query params for assertions). */
function lastListUrl(): string | null {
  const calls = fetchMock().mock.calls.filter(([u]) => String(u).includes('/api/admin/invoices'));
  return calls.length ? String(calls[calls.length - 1][0]) : null;
}

/** Desktop table region (row content is duplicated in the mobile layout). */
function table(): HTMLElement {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lacks IntersectionObserver — re-stub after clearing globals.
  class MockIntersectionObserver {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn();
  }
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminInvoicesPage', () => {
  it('renders stat tiles from the billing funnel counts and rows with joined data', async () => {
    mockListResponse();
    render(<AdminInvoicesPage />);

    // Total Invoices tile falls back to pagination.total; funnel tiles map parent states.
    expect(await screen.findByText('Total Invoices')).toBeInTheDocument();
    // '1' (total) and '4' (Paid+Closed = FINISHED 3 + CLOSED 1) are plain text on the tiles.
    await waitFor(() => {
      const textNodes = Array.from(document.querySelectorAll('span')).map((n) => n.textContent);
      expect(textNodes).toContain('1');
      expect(textNodes).toContain('4');
    });

    // Row joins render: work order description, org, contractor, total as money.
    await waitFor(() => {
      expect(within(table()).getByText('Boiler replacement — Flat 4')).toBeInTheDocument();
    });
    expect(within(table()).getByText('Ashvale Housing')).toBeInTheDocument();
    expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    expect(within(table()).getByText(/£\s?4,200/)).toBeInTheDocument();

    // The list fetch used pageSize=8 (table pagination convention).
    expect(lastListUrl()).toContain('pageSize=8');
  });

  it('shows overdue for an outstanding invoice past its due date, not for a paid one', async () => {
    mockListResponse({
      items: [
        invoiceRow({ dueDate: new Date('2026-10-01T12:00:00').toISOString(), workOrder: { description: 'Kitchen refit, block A', state: 'INVOICED' } }),
        invoiceRow({ invoiceId: 'inv-2', dueDate: new Date('2026-10-01T12:00:00').toISOString(), workOrderId: 'wo-9', workOrder: { description: 'Gutter clean, house 2', state: 'FINISHED' } }),
      ],
    });
    render(<AdminInvoicesPage />);

    const overdueTexts = await waitFor(() => screen.getAllByText(/overdue/i));
    // Only the INVOICED (unpaid) row is flagged; FINISHED is settled history.
    expect(overdueTexts.length).toBeGreaterThan(0);
    const paidRow = within(screen.getByRole('row', { name: /gutter clean, house 2/i }));
    expect(paidRow.queryByText(/overdue/i)).not.toBeInTheDocument();
  });

  it('shows the empty message when no invoices exist', async () => {
    mockListResponse({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 }, counts: {} });
    render(<AdminInvoicesPage />);
    expect(await screen.findByText(/no invoices found/i)).toBeInTheDocument();
  });

  it('shows an error banner when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Failed to load invoices' }), { status: 500 })),
    );
    render(<AdminInvoicesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load invoices/i);
  });

  it('sends search, state and work-order filters with the list request', async () => {
    mockListResponse();
    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/filter by status/i), { target: { value: 'INVOICED' } });
    fireEvent.change(screen.getByLabelText(/filter by work order/i), { target: { value: 'wo-1' } });
    await waitFor(() => {
      const url = lastListUrl();
      expect(url).toContain('workOrderState=INVOICED');
      expect(url).toContain('workOrderId=wo-1');
    });

    // Search bar (debounced 200ms — allow the debounce to fire).
    fireEvent.change(screen.getByLabelText(/search invoices/i), { target: { value: 'byrne' } });
    await waitFor(() => {
      expect(lastListUrl()).toContain('search=byrne');
    }, { timeout: 2000 });
  });

  it('only lists invoice-eligible work orders (COMPLETE/INVOICED/FINISHED) in the filter dropdown', async () => {
    mockListResponse();
    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    const woSelect = screen.getByLabelText(/filter by work order/i) as HTMLSelectElement;
    // wo-2 is STARTED — filtered out by the page.
    expect(woSelect.options.length).toBe(2); // placeholder + one eligible WO
    expect(Array.from(woSelect.options).map((o) => o.value)).toEqual(['', 'wo-1']);
  });

  it('requests page 2 when pagination Next is clicked', async () => {
    mockListResponse({ pagination: { page: 1, pageSize: 8, total: 16, totalPages: 2 } });
    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(lastListUrl()).toContain('page=2');
    });
  });

  it('shows edit AND delete actions for an INVOICED invoice', async () => {
    mockListResponse();
    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getAllByRole('button', { name: /^edit invoice for byrne/i })).not.toHaveLength(0);
    });
    expect(within(table()).getByRole('button', { name: /^delete invoice for byrne/i })).toBeInTheDocument();
  });

  it('hides delete outside INVOICED, and hides all actions once paid (FINISHED)', async () => {
    // One stub serving both rows: COMPLETE (edit-only) + FINISHED (no affordances).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/admin/invoices')) {
          return new Response(
            JSON.stringify({
              items: [
                invoiceRow(), // INVOICED — edit + delete
                invoiceRow({ invoiceId: 'inv-2', contractorId: 'c-8', workOrderId: 'wo-5', contractor: { name: 'Sam Kerr', companyName: 'Kerr Joinery' }, workOrder: { description: 'Gutter clean, house 2', state: 'FINISHED' } }),
                invoiceRow({ invoiceId: 'inv-3', contractorId: 'c-9', workOrderId: 'wo-6', contractor: { name: 'Ann Doyle', companyName: 'Doyle Roofing' }, workOrder: { description: 'Roof repair, block B', state: 'COMPLETE' } }),
              ],
              pagination: { page: 1, pageSize: 8, total: 3, totalPages: 1 },
              counts: {},
            }),
            { status: 200 },
          );
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminInvoicesPage />);
    const t = await screen.findByRole('table');
    // All rows render once.
    await waitFor(() => expect(within(t).getByText('Boiler replacement — Flat 4')).toBeInTheDocument());

    // INVOICED row: edit + delete present.
    const invoicedRow = within(t).getByRole('row', { name: /boiler replacement — flat 4/i });
    expect(within(invoicedRow).getByRole('button', { name: /^edit invoice for byrne electrical ltd$/i })).toBeInTheDocument();
    expect(within(invoicedRow).getByRole('button', { name: /^delete invoice for byrne electrical ltd$/i })).toBeInTheDocument();

    // COMPLETE row: edit only (service blocks delete outside INVOICED).
    const completeRow = within(t).getByRole('row', { name: /roof repair, block b/i });
    expect(within(completeRow).getByRole('button', { name: /^edit invoice for doyle roofing$/i })).toBeInTheDocument();
    expect(within(completeRow).queryByRole('button', { name: /^delete invoice for doyle roofing$/i })).not.toBeInTheDocument();

    // FINISHED row (paid chain): no affordances at all.
    const finishedRow = within(t).getByRole('row', { name: /gutter clean, house 2/i });
    expect(within(finishedRow).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens the edit modal prefilled and PATCHes price, dates and link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify(invoiceRow({ price: 1500 })), { status: 200 });
        }
        if (url.includes('/api/admin/invoices')) {
          return new Response(JSON.stringify({ items: [invoiceRow({ invoiceLink: 'https://example.com/inv.pdf' })], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getByRole('button', { name: /^edit invoice for byrne/i }));
    await waitFor(() => {
      expect(screen.getByText(/Edit Invoice — Byrne Electrical Ltd/)).toBeInTheDocument();
    });

    // Prefilled from the row.
    const price = document.getElementById('inv-edit-price') as HTMLInputElement;
    expect(price.value).toBe('4200');
    const link = document.getElementById('inv-edit-link') as HTMLInputElement;
    expect(link.value).toBe('https://example.com/inv.pdf');

    fireEvent.change(price, { target: { value: '1500' } });
    fireEvent.change(document.getElementById('inv-edit-due') as HTMLInputElement, { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patchCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/api/admin/invoices/inv-1') && (i as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body.price).toBe(1500);
      expect(body.dueDate).toContain('2026-11-20T12:00:00'); // local noon round-trip
      expect(body.invoiceLink).toBe('https://example.com/inv.pdf');
    });
  });

  it('edit rejects a zero price client-side without calling the API', async () => {
    mockListResponse();
    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getByRole('button', { name: /^edit invoice for byrne/i }));
    await waitFor(() => {
      expect(screen.getByText(/Edit Invoice — Byrne Electrical Ltd/)).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('inv-edit-price') as HTMLInputElement, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await screen.findByText(/price must be greater than zero/i);
    expect(fetchMock().mock.calls.some(([u, i]) => (i as RequestInit)?.method === 'PATCH')).toBe(false);
  });

  it('deletes via the confirm dialog and issues DELETE', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ success: true }), { status: 200 });
        if (url.includes('/api/admin/invoices')) {
          return new Response(JSON.stringify({ items: [invoiceRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getByRole('button', { name: /^delete invoice for byrne/i }));
    await waitFor(() => {
      expect(screen.getByText(/delete the invoice for byrne electrical ltd\?/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      const deleteCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/api/admin/invoices/inv-1') && (i as RequestInit)?.method === 'DELETE');
      expect(deleteCall).toBeDefined();
    });
  });

  it('surfaces the server message when a delete is blocked by work order state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE') {
          return new Response(JSON.stringify({ error: 'Invoices cannot be deleted while the work order is FINISHED' }), { status: 409 });
        }
        if (url.includes('/api/admin/invoices')) {
          return new Response(JSON.stringify({ items: [invoiceRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminInvoicesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getByRole('button', { name: /^delete invoice for byrne/i }));
    await screen.findByText(/delete the invoice for byrne electrical ltd\?/i);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cannot be deleted while the work order is finished/i);
  });
});

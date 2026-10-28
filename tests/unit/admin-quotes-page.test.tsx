/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the admin Quotations page — stat tiles, table, filters, and
 * the full CRUD surface (create / edit / delete). Global fetch is mocked; all
 * dashboard components render for real.
 *
 * NOTE on element multiplicity: DataTable renders BOTH a mobile stacked list
 * and a desktop `<table>`, and PageHeader renders its primary CTA in two
 * places — queries therefore scope row content to role="table" and use
 * getAllBy* for the header CTA.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import AdminQuotesPage from '@/app/dashboard/admin/quotes/page';

// ── fetch mock helpers ────────────────────────────────────────────

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  quoteId: 'q-1',
  workOrderId: 'wo-1',
  contractorId: 'c-1',
  quoteLink: null,
  description: 'Labour + materials',
  price: null,
  dueDate: new Date('2026-10-24T12:00:00').toISOString(),
  state: 'OPENED',
  organizationId: 'org-1',
  organizationName: 'Ashvale Housing',
  createdAt: new Date('2026-10-17T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-10-17T10:00:00Z').toISOString(),
  contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
  workOrder: { description: 'Boiler replacement — Flat 4', state: 'OUT_FOR_QUOTES' },
  ...overrides,
});

function mockListResponse(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/quotes')) {
        return new Response(
          JSON.stringify({
            items: [
              quoteRow(),
              quoteRow({
                quoteId: 'q-2',
                contractorId: 'c-2',
                description: null,
                price: '1250.5',
                state: 'ACCEPTED',
                workOrderId: 'wo-3',
                organizationName: 'Crestfield Homes',
                contractor: { name: 'Jane Doherty', companyName: 'Doherty Plumbing' },
                workOrder: { description: 'Kitchen refit, block A', state: 'CONTRACTOR_ASSIGNED' },
              }),
            ],
            pagination: { page: 1, pageSize: 8, total: 2, totalPages: 1 },
            counts: { OPENED: 3, ACCEPTED: 5 },
            ...overrides,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/admin/work-orders')) {
        return new Response(
          JSON.stringify({
            items: [
              { workOrderId: 'wo-1', description: 'Boiler replacement — Flat 4', organizationName: 'Ashvale Housing', state: 'OUT_FOR_QUOTES' },
              { workOrderId: 'wo-2', description: 'Roof repair, block B', organizationName: 'Ashvale Housing', state: 'FINISHED' },
            ],
            pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/api/dashboard/admin/contractors')) {
        return new Response(
          JSON.stringify({
            items: [
              { contractorId: 'c-1', companyName: 'Byrne Electrical Ltd', name: 'Pat Byrne' },
              { contractorId: 'c-2', companyName: 'Doherty Plumbing', name: 'Jane Doherty' },
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

/** Last URL of a quote list request (query params for assertions). */
function lastListUrl(): string | null {
  const calls = fetchMock().mock.calls.filter(([u]) => String(u).includes('/api/admin/quotes'));
  return calls.length ? String(calls[calls.length - 1][0]) : null;
}

/** Desktop table region (row content is duplicated in the mobile layout). */
function table(): HTMLElement {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lacks IntersectionObserver; next/link's lazy-loading effect and the
  // setup-file stub both need it. unstubAllGlobals() removes globals, so
  // re-stub after clearing (the setup file only runs once per worker).
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

describe('AdminQuotesPage', () => {
  it('renders stat tiles from counts, header and rows with joined data', async () => {
    mockListResponse();
    render(<AdminQuotesPage />);

    // Stat tiles: total (summed from counts) + per-state.
    expect(await screen.findByText('Total Quotations')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument(); // 3 OPENED + 5 ACCEPTED
    expect(screen.getByText('5')).toBeInTheDocument(); // accepted tile

    // Header CTA (PageHeader duplicates the node).
    const createButtons = screen.getAllByRole('button', { name: /new quotation/i });
    expect(createButtons.length).toBeGreaterThanOrEqual(1);

    // Row joins render: work order description, org, contractor both lines, price.
    await waitFor(() => {
      expect(within(table()).getByText('Boiler replacement — Flat 4')).toBeInTheDocument();
    });
    expect(within(table()).getByText('Ashvale Housing')).toBeInTheDocument();
    expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    expect(within(table()).getByText(/£\s?1,250\.50/)).toBeInTheDocument();

    // The list fetch used pageSize=8 (table pagination requirement).
    expect(lastListUrl()).toContain('pageSize=8');
  });

  it('shows overdue for open quotes past their due date', async () => {
    mockListResponse({
      items: [quoteRow({ dueDate: new Date('2026-10-01T12:00:00').toISOString() })],
    });
    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText(/overdue/i)).toBeInTheDocument();
    });
  });

  it('shows the empty message when no quotations exist', async () => {
    mockListResponse({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 }, counts: {} });
    render(<AdminQuotesPage />);
    expect(await screen.findByText('No quotations found')).toBeInTheDocument();
  });

  it('shows an error banner when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Failed to load quotations' }), { status: 500 })),
    );
    render(<AdminQuotesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load quotations/i);
  });

  it('sends search, state and work-order filters with the list request', async () => {
    mockListResponse();
    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/filter by state/i), { target: { value: 'ACCEPTED' } });
    fireEvent.change(screen.getByLabelText(/filter by work order/i), { target: { value: 'wo-1' } });
    await waitFor(() => {
      const url = lastListUrl();
      expect(url).toContain('state=ACCEPTED');
      expect(url).toContain('workOrderId=wo-1');
    });

    // Search bar (debounced 200ms — allow the debounce to fire).
    fireEvent.change(screen.getByLabelText(/search quotations/i), { target: { value: 'byrne' } });
    await waitFor(() => {
      expect(lastListUrl()).toContain('search=byrne');
    }, { timeout: 2000 });
  });

  it('requests page 2 when pagination Next is clicked', async () => {
    mockListResponse({ pagination: { page: 1, pageSize: 8, total: 16, totalPages: 2 } });
    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(lastListUrl()).toContain('page=2');
    });
  });

  it('only lists quotable work orders in the create dropdown', async () => {
    mockListResponse();
    render(<AdminQuotesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /new quotation/i })[0]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Quotation' })).toBeInTheDocument();
    });

    const woSelect = document.getElementById('q-new-wo') as HTMLSelectElement;
    // wo-2 is FINISHED — filtered out server-side by the page.
    expect(woSelect.options.length).toBe(2); // placeholder + one quotable WO
    expect(Array.from(woSelect.options).map((o) => o.value)).toEqual(['', 'wo-1']);
  });

  it('opens the create modal and posts workOrder/contractor/dueDate (ISO)', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return new Response(JSON.stringify(quoteRow({ quoteId: 'q-new' })), { status: 201 });
        }
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) {
          return new Response(JSON.stringify({ items: [{ workOrderId: 'wo-1', description: 'Boiler replacement — Flat 4', organizationName: 'Ashvale Housing', state: 'QUOTES_IN' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }), { status: 200 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(JSON.stringify({ items: [{ contractorId: 'c-3', companyName: 'Kerr Joinery', name: 'Sam Kerr' }] , pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /new quotation/i })[0]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Quotation' })).toBeInTheDocument();
    });

    // Submit stays disabled until both selects are filled.
    const disabledSubmit = screen.getAllByRole('button', { name: /open quotation/i }).find((b) => (b as HTMLButtonElement).disabled);
    expect(disabledSubmit).toBeDefined();

    fireEvent.change(document.getElementById('q-new-wo') as HTMLSelectElement, { target: { value: 'wo-1' } });
    fireEvent.change(document.getElementById('q-new-contractor') as HTMLSelectElement, { target: { value: 'c-3' } });
    const due = document.getElementById('q-new-due') as HTMLInputElement;
    fireEvent.change(due, { target: { value: '2026-11-05' } });

    fireEvent.click(screen.getByRole('button', { name: /open quotation/i }));

    await waitFor(() => {
      const postCall = fetchMock().mock.calls.find(([u, i]) => String(u) === '/api/admin/quotes' && (i as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
      expect(body.workOrderId).toBe('wo-1');
      expect(body.contractorId).toBe('c-3');
      expect(body.dueDate).toContain('2026-11-05T12:00:00'); // local noon round-trip
    });
  });

  it('create surfaces the server duplicate error verbatim and keeps the modal open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return new Response(JSON.stringify({ error: 'A quotation already exists for this contractor on this work order' }), { status: 422 });
        }
        if (url.includes('/api/admin/work-orders')) {
          return new Response(JSON.stringify({ items: [{ workOrderId: 'wo-1', description: 'Boiler replacement — Flat 4', organizationName: 'Ashvale Housing', state: 'OUT_FOR_QUOTES' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }), { status: 200 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(JSON.stringify({ items: [{ contractorId: 'c-1', companyName: 'Byrne Electrical Ltd', name: 'Pat Byrne' }], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } }), { status: 200 });
        }
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    fireEvent.click(screen.getAllByRole('button', { name: /new quotation/i })[0]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'New Quotation' })).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('q-new-wo') as HTMLSelectElement, { target: { value: 'wo-1' } });
    fireEvent.change(document.getElementById('q-new-contractor') as HTMLSelectElement, { target: { value: 'c-1' } });
    fireEvent.click(screen.getByRole('button', { name: /open quotation/i }));

    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(/a quotation already exists for this contractor on this work order/i);
    // Modal stays open on failure.
    expect(screen.getByRole('heading', { name: 'New Quotation' })).toBeInTheDocument();
  });

  it('edit modal pre-fills the row and PATCHes a changed price + breakdown', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify(quoteRow({ price: '1500' })), { status: 200 });
        }
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: { OPENED: 1 } }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        if (url.includes('/api/dashboard/admin/contractors')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    const editButtons = within(table()).getAllByRole('button', { name: /^edit byrne/i });
    fireEvent.click(editButtons[0]);
    await waitFor(() => {
      expect(screen.getByText(/Edit Quotation — Byrne Electrical Ltd/)).toBeInTheDocument();
    });

    // Prefilled from the row (description present, price null → empty field).
    const desc = document.getElementById('q-edit-desc') as HTMLTextAreaElement;
    expect(desc.value).toBe('Labour + materials');
    const price = document.getElementById('q-edit-price') as HTMLInputElement;
    expect(price.value).toBe('');

    fireEvent.change(price, { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patchCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/api/admin/quotes/q-1') && (i as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body.price).toBe('1500');
      expect(body.description).toBe('Labour + materials');
    });
  });

  it('edit keeps the current price when the field is left blank (price cannot be cleared)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') return new Response(JSON.stringify({ success: true }), { status: 200 });
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow({ price: '950' })], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        if (url.includes('/api/dashboard/admin/contractors')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getAllByRole('button', { name: /^edit byrne/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/Edit Quotation — Byrne Electrical Ltd/)).toBeInTheDocument();
    });

    // Leave the price blank (emptied from the pre-filled '950') and change
    // only the breakdown — a received price cannot be cleared, so no price is sent.
    fireEvent.change(document.getElementById('q-edit-price') as HTMLInputElement, { target: { value: '' } });
    fireEvent.change(document.getElementById('q-edit-desc') as HTMLTextAreaElement, { target: { value: 'Updated scope' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patchCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/api/admin/quotes/q-1') && (i as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body.description).toBe('Updated scope');
      expect('price' in body).toBe(false); // never send clear-once-set
    });
  });

  it('edit rejects a zero price client-side without calling the API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        if (url.includes('/api/dashboard/admin/contractors')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getAllByRole('button', { name: /^edit byrne/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/Edit Quotation — Byrne Electrical Ltd/)).toBeInTheDocument();
    });

    fireEvent.change(document.getElementById('q-edit-price') as HTMLInputElement, { target: { value: '0' } });
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
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        if (url.includes('/api/dashboard/admin/contractors')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getAllByRole('button', { name: /^delete byrne/i })[0]);
    // The ConfirmDialog message (dialog only, not in the table).
    await waitFor(() => {
      expect(screen.getByText(/delete byrne electrical ltd's quotation/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      const deleteCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/api/admin/quotes/q-1') && (i as RequestInit)?.method === 'DELETE');
      expect(deleteCall).toBeDefined();
    });
  });

  it('surfaces the server 409 message when a delete is blocked by work order state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE') {
          return new Response(JSON.stringify({ error: 'Quotations cannot be deleted while the work order is FINISHED' }), { status: 409 });
        }
        if (url.includes('/api/admin/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 }, counts: {} }), { status: 200 });
        }
        if (url.includes('/api/admin/work-orders')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        if (url.includes('/api/dashboard/admin/contractors')) return new Response(JSON.stringify({ items: [], pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } }), { status: 200 });
        return new Response('{}', { status: 404 });
      }),
    );

    render(<AdminQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.click(within(table()).getAllByRole('button', { name: /^delete byrne/i })[0]);
    await waitFor(() => {
      expect(screen.getByText(/delete byrne electrical ltd's quotation/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/cannot be deleted while the work order is finished/i);
  });
});

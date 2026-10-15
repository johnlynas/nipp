/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the admin Contractors page — rendering, tiles, table,
 * filters, and the Create/Edit/Delete modal flows.
 *
 * Global fetch is mocked; all dashboard components (StatCard, DataTable,
 * PageHeader, Modal, etc.) render for real.
 *
 * NOTE on element multiplicity: DataTable renders BOTH a mobile stacked list
 * and a desktop `<table>` (responsiveness), and PageHeader renders its
 * primary CTA in two places (inline + sticky bar). Queries below therefore
 * scope row content to role="table" and use getAllBy* for the header CTA.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import ContractorsPage from '@/app/dashboard/admin/contractors/page';

// ── fetch mock helpers ────────────────────────────────────────────

const contractorRow = (overrides: Record<string, unknown> = { contractorId: 'c-1' }) => ({
  contractorId: 'c-1',
  companyName: 'Byrne Electrical Ltd',
  name: 'Pat Byrne',
  email: 'pat@byrne-electrical.example',
  phone: '+44 28 9123 4501',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  type: 'ELECTRICIAN',
  description: null,
  createdAt: new Date('2026-01-05T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-01-05T10:00:00Z').toISOString(),
  ...overrides,
});

function mockListResponse(overrides: Record<string, unknown> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/admin/contractors')) {
        return new Response(
          JSON.stringify({
            items: [contractorRow(), contractorRow({ contractorId: 'c-2', name: 'Jane Doherty', companyName: 'Doherty Plumbing' })],
            pagination: { page: 1, pageSize: 8, total: 2, totalPages: 1 },
            counts: { totalCount: 5, types: { ELECTRICIAN: 3, PLUMBER: 2 } },
            ...overrides,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

const fetchMock = () => vi.mocked(fetch);

/** Display labels for every contractor type tile (must match the page's TYPE_LABELS). */
const TILE_TYPE_LABELS: Record<string, string> = {
  PAINTER: 'Painter',
  ELECTRICIAN: 'Electrician',
  PLUMBER: 'Plumber',
  GAS_ENGINEER: 'Gas Engineer',
  LIFT_MAINTENANCE: 'Lift Maintenance',
  GARDENER: 'Gardener',
  ACCOUNTANT: 'Accountant',
  FIRE_ALARMS: 'Fire Alarms',
  SOLICITOR: 'Solicitor',
  ROOFER: 'Roofer',
  WINDOW_CLEANER: 'Window Cleaner',
  OTHER: 'Other',
};

/** Last URL of a list request (query params for assertions). */
function lastListUrl(): string | null {
  const calls = fetchMock().mock.calls.filter(([u]) => String(u).includes('/api/dashboard/admin/contractors'));
  return calls.length ? String(calls[calls.length - 1][0]) : null;
}

/** Desktop table region (row content is duplicated in the mobile layout). */
function table(): HTMLElement {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ContractorsPage', () => {
  it('renders dashboard tiles, header and table with page size 8 rows', async () => {
    mockListResponse();
    render(<ContractorsPage />);

    // Stat tiles (dashboard counts from the API): Total + all 12 type tiles.
    expect(await screen.findByText('Total Contractors')).toBeInTheDocument();
    for (const label of Object.values(TILE_TYPE_LABELS)) {
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1); // tile (and table row)
    }
    expect(screen.getByText('5')).toBeInTheDocument(); // total tile
    expect(screen.getByText('3')).toBeInTheDocument(); // electricians count

    // Page header + create CTA (PageHeader renders it in two places).
    expect(screen.getByText(/Manage contractors/)).toBeInTheDocument();
    const createButtons = screen.getAllByRole('button', { name: /create contractor/i });
    expect(createButtons.length).toBeGreaterThanOrEqual(1);

    // Table rows render name, company and type label.
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });
    expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    expect(within(table()).getAllByText(/electrician/i).length).toBeGreaterThanOrEqual(1);
    expect(within(table()).getByText('Jane Doherty')).toBeInTheDocument();

    // The list fetch used pageSize=8 (table pagination requirement).
    const url = lastListUrl();
    expect(url).toContain('pageSize=8');
  });

  it('shows the empty message when no contractors exist', async () => {
    mockListResponse({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 } });
    render(<ContractorsPage />);
    expect(await screen.findByText('No contractors found')).toBeInTheDocument();
  });

  it('shows an error banner when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Failed to fetch contractors' }), { status: 500 })),
    );
    render(<ContractorsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to fetch contractors/i);
  });

  it('sends search and type filter params with the list request', async () => {
    mockListResponse();
    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    // Type dropdown.
    fireEvent.change(screen.getByLabelText(/filter by contractor type/i), { target: { value: 'PLUMBER' } });
    await waitFor(() => {
      expect(lastListUrl()).toContain('type=PLUMBER');
    });

    // Search bar (debounced 200ms — allow the debounce to fire).
    const search = screen.getByLabelText(/search contractors/i);
    fireEvent.change(search, { target: { value: 'pat' } });
    await waitFor(() => {
      expect(lastListUrl()).toContain('search=pat');
    }, { timeout: 2000 });
  });

  it('requests page 2 when pagination Next is clicked', async () => {
    mockListResponse({ pagination: { page: 1, pageSize: 8, total: 16, totalPages: 2 } });
    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(lastListUrl()).toContain('page=2');
    });
  });

  it('opens the create modal and posts a trimmed payload with the default type', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          return new Response(JSON.stringify(contractorRow({ contractorId: 'c-new' })), { status: 201 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({
              items: [contractorRow()],
              pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
              counts: { totalCount: 5, types: { ELECTRICIAN: 3, PLUMBER: 2 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    // Header CTA (first instance — PageHeader duplicates the node).
    const createButtons = screen.getAllByRole('button', { name: /create contractor/i });
    fireEvent.click(createButtons[0]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Contractor' })).toBeInTheDocument();
    });

    // Fill the required fields (labels are unique within the open modal).
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: '  New Person  ' } });
    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: 'New Company' } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: 'new@company.example' } });
    fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: '+44 28 111 222' } });
    // Address + post code inputs are disambiguated by id.
    fireEvent.change(document.getElementById('create-address') as HTMLInputElement, { target: { value: '5 New Street' } });
    fireEvent.change(document.getElementById('create-postcode') as HTMLInputElement, { target: { value: 'BT9 1ZZ' } });

    const submit = screen.getAllByRole('button', { name: 'Create Contractor' })
      .find((b) => (b as HTMLButtonElement).disabled === false)!;
    fireEvent.click(submit);

    await waitFor(() => {
      const postCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/contractors') && (i as RequestInit)?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
      expect(body.name).toBe('New Person'); // trimmed
      expect(body.companyName).toBe('New Company');
      expect(body.email).toBe('new@company.example');
      expect(body.type).toBe('OTHER');       // default
    });
  });

  it('opens the edit modal from a row action, pre-fills it and saves via PATCH', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'PATCH') {
          return new Response(JSON.stringify(contractorRow({ name: 'Pat J. Byrne' })), { status: 200 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({
              items: [contractorRow()],
              pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
              counts: { totalCount: 5, types: { ELECTRICIAN: 3, PLUMBER: 2 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    const editButtons = within(table()).getAllByRole('button', { name: /^edit/i });
    fireEvent.click(editButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Edit Contractor')).toBeInTheDocument();
    });

    // Prefilled from the row.
    const editName = document.getElementById('edit-name') as HTMLInputElement;
    expect(editName.value).toBe('Pat Byrne');

    fireEvent.change(editName, { target: { value: 'Pat J. Byrne' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const patchCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/contractors/c-1') && (i as RequestInit)?.method === 'PATCH');
      expect(patchCall).toBeDefined();
      const body = JSON.parse((patchCall?.[1] as RequestInit).body as string);
      expect(body.name).toBe('Pat J. Byrne');
    });
  });

  it('deletes via the confirm dialog and issues DELETE', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'DELETE') {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({
              items: [contractorRow()],
              pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
              counts: { totalCount: 5, types: { ELECTRICIAN: 3, PLUMBER: 2 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    const deleteButtons = within(table()).getAllByRole('button', { name: /^delete/i });
    fireEvent.click(deleteButtons[0]);
    // The ConfirmDialog message (unique — modal only, not in the table).
    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to delete pat byrne/i)).toBeInTheDocument();
    });

    // Confirm: the dialog's confirm button is the only one named exactly "Delete".
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      const deleteCall = fetchMock().mock.calls.find(([u, i]) => String(u).includes('/contractors/c-1') && (i as RequestInit)?.method === 'DELETE');
      expect(deleteCall).toBeDefined();
    });
  });

  it('shows contractor details (including description) in the view modal', async () => {
    mockListResponse();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method) return new Response(JSON.stringify({ success: true }), { status: 200 });
        const url = String(input);
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({
              items: [contractorRow({ description: '18th registered.' })],
              pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 },
              counts: { totalCount: 5, types: { ELECTRICIAN: 3, PLUMBER: 2 } },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );

    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    const viewButtons = within(table()).getAllByRole('button', { name: /^view/i });
    fireEvent.click(viewButtons[0]);
    await waitFor(() => {
      expect(screen.getByText('Contractor Details')).toBeInTheDocument();
    });
    // Description renders when present (modal only).
    expect(screen.getByText('18th registered.')).toBeInTheDocument();
  });

  it('disables the create submit while required fields are empty', async () => {
    mockListResponse();
    render(<ContractorsPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Pat Byrne')).toBeInTheDocument();
    });

    const createButtons = screen.getAllByRole('button', { name: /create contractor/i });
    fireEvent.click(createButtons[0]);
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Create Contractor' })).toBeInTheDocument();
    });

    // Two "Create Contractor" buttons exist (modal title aside): the CTA in
    // the modal footer must be disabled while name/email are empty.
    const submit = screen.getAllByRole('button', { name: 'Create Contractor' })
      .find((b) => (b as HTMLButtonElement).disabled);
    expect(submit).toBeDefined();
  });
});

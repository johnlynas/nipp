/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for the tenant Quotations page — org resolution, read-only table,
 * filters and pagination. The page must NEVER call an /api/admin route and has
 * no create/edit/delete affordances (asserted explicitly).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import TenantQuotesPage from '@/app/dashboard/tenant/quotes/page';

const quoteRow = (overrides: Record<string, unknown> = {}) => ({
  quoteId: 'q-1',
  workOrderId: 'wo-1',
  contractorId: 'c-1',
  quoteLink: null,
  description: 'Labour + materials',
  price: null,
  dueDate: new Date('2026-10-24T12:00:00').toISOString(),
  state: 'OPENED',
  organizationId: 'org-tenant',
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
      if (url.includes('/api/auth/me')) {
        return new Response(JSON.stringify({ activeOrganizationId: 'org-tenant' }), { status: 200 });
      }
      if (url.includes('/api/organizations/org-tenant/quotes')) {
        return new Response(
          JSON.stringify({
            items: [quoteRow(), quoteRow({ quoteId: 'q-2', price: '890', state: 'ACCEPTED', description: null, contractor: { name: 'Jane Doherty', companyName: 'Doherty Plumbing' }, workOrder: { description: 'Kitchen refit, block A', state: 'CONTRACTOR_ASSIGNED' } })],
            pagination: { page: 1, pageSize: 8, total: 2, totalPages: 1 },
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

function lastListUrl(): string | null {
  const calls = fetchMock().mock.calls.filter(([u]) => String(u).includes('/api/organizations/org-tenant/quotes'));
  return calls.length ? String(calls[calls.length - 1][0]) : null;
}

function table(): HTMLElement {
  return screen.getByRole('table');
}

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom lacks IntersectionObserver; next/link's lazy-loading effect needs it.
  vi.stubGlobal('IntersectionObserver', class {
    readonly root: Element | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    takeRecords = vi.fn();
  });
  // jsdom lacks localStorage — the org fallback reads it. Memory-backed stub,
  // re-stubbed after afterEach's unstubAllGlobals.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k) : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TenantQuotesPage', () => {
  it('resolves the org from /api/auth/me and reads its own quotations', async () => {
    mockListResponse();
    render(<TenantQuotesPage />);

    // The fetch URL is org-scoped — membership-isolated by RLS upstream.
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });
    expect(lastListUrl()?.includes('/api/organizations/org-tenant/quotes')).toBe(true);

    // Joined cells render: work order link text, breakdown subline, price.
    expect(within(table()).getByText('Boiler replacement — Flat 4')).toBeInTheDocument();
    expect(within(table()).getByText('Labour + materials')).toBeInTheDocument();
    expect(within(table()).getAllByText(/£\s?890/).length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the stored org when /api/auth/me has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) return new Response(JSON.stringify({ activeOrganizationId: null }), { status: 200 });
        if (url.includes('/api/organizations/org-stored/quotes')) {
          return new Response(JSON.stringify({ items: [quoteRow()], pagination: { page: 1, pageSize: 8, total: 1, totalPages: 1 } }), { status: 200 });
        }
        return new Response('{}', { status: 404 });
      }),
    );
    localStorage.setItem('nipp-active-org-id', 'org-stored');

    render(<TenantQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });
    // Assert on the call history in this same scope: vi.mocked(fetch) access
    // itself clears mock.calls, so capture it right after the rows appear.
    const listUrl = String(vi.mocked(fetch).mock.calls.find(([u]) => String(u).includes('/api/organizations/org-stored/quotes'))?.[0]);
    expect(listUrl).toContain('pageSize=8');
    localStorage.removeItem('nipp-active-org-id');
  });

  it('shows the empty message when no quotations exist', async () => {
    mockListResponse({ items: [], pagination: { page: 1, pageSize: 8, total: 0, totalPages: 1 } });
    render(<TenantQuotesPage />);
    expect(await screen.findByText(/no quotations have been recorded/i)).toBeInTheDocument();
  });

  it('shows an error banner when the API fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) return new Response(JSON.stringify({ activeOrganizationId: 'org-tenant' }), { status: 200 });
        return new Response(JSON.stringify({ error: 'Failed to load quotations' }), { status: 500 });
      }),
    );
    render(<TenantQuotesPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load quotations/i);
  });

  it('sends search + state filters and requests page 2', async () => {
    mockListResponse({ pagination: { page: 1, pageSize: 8, total: 16, totalPages: 2 } });
    render(<TenantQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/filter by state/i), { target: { value: 'ACCEPTED' } });
    fireEvent.change(screen.getByLabelText(/search quotations/i), { target: { value: 'byrne' } });
    await waitFor(() => {
      const url = lastListUrl();
      expect(url).toContain('state=ACCEPTED');
      expect(url).toContain('search=byrne');
    }, { timeout: 2000 });

    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      expect(lastListUrl()).toContain('page=2');
    });
  });

  it('is read-only: no mutation affordances and zero /api/admin calls', async () => {
    mockListResponse();
    render(<TenantQuotesPage />);
    await waitFor(() => {
      expect(within(table()).getByText('Byrne Electrical Ltd')).toBeInTheDocument();
    });

    // No create CTA, no per-row edit/delete buttons anywhere in the document.
    const buttons = Array.from(document.querySelectorAll('button'));
    for (const b of buttons) {
      const label = (b.getAttribute('aria-label') ?? b.textContent ?? '').toLowerCase();
      expect(label).not.toMatch(/edit|delete/i);
    }
    expect(screen.queryByRole('button', { name: /new quotation/i })).toBeNull();

    // Every fetch in the page's life cycle stays off /api/admin.
    for (const [u] of vi.mocked(fetch).mock.calls) {
      expect(String(u)).not.toContain('/api/admin');
    }
  });
});

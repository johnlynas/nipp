/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for WorkOrderQuotationsPanel (admin work order detail). The
 * panel is pure props-in/fetch-out — global fetch is mocked and the parent's
 * refetch + onFailed are spy callbacks. Row content lives in the desktop
 * <table> (no mobile duplicate here, so bare within(table()) queries work).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { WorkOrderQuotationsPanel } from '@/components/dashboard/WorkOrderQuotationsPanel';
import type { WorkOrderQuote } from '@/components/dashboard/work-order-shared';

const quote = (overrides: Record<string, unknown> = {}): WorkOrderQuote => ({
  quoteId: 'q-1',
  workOrderId: 'wo-1',
  contractorId: 'c-1',
  quoteLink: null,
  description: 'Labour + materials',
  price: null,
  dueDate: new Date('2026-10-24T12:00:00').toISOString(),
  state: 'OPENED',
  createdAt: new Date('2026-10-17T10:00:00Z').toISOString(),
  updatedAt: new Date('2026-10-17T10:00:00Z').toISOString(),
  contractor: { name: 'Pat Byrne', companyName: 'Byrne Electrical Ltd' },
  ...overrides,
});

interface RenderOpts {
  quotes?: WorkOrderQuote[];
  state?: WorkOrderQuote['state'];
  workOrderState?: 'OUT_FOR_QUOTES' | 'QUOTES_IN' | 'CONTRACTOR_ASSIGNED' | 'FINISHED';
  disabled?: boolean;
}

function renderPanel(opts: RenderOpts = {}) {
  const refetch = vi.fn(async () => {});
  const onFailed = vi.fn();
  render(
    <WorkOrderQuotationsPanel
      workOrderId="wo-1"
      quotes={opts.quotes ?? [quote()]}
      workOrderState={opts.workOrderState ?? 'OUT_FOR_QUOTES'}
      disabled={opts.disabled}
      refetch={refetch}
      onFailed={onFailed}
    />,
  );
  return { refetch, onFailed };
}

function table(): HTMLElement {
  return screen.getByRole('table');
}

function callsWith(urlPart: string, method?: string): Array<{ url: string; body?: Record<string, unknown>; status?: undefined }> {
  const out = [];
  for (const [u, i] of vi.mocked(fetch).mock.calls) {
    if (String(u).includes(urlPart) && (!method || (i as RequestInit | undefined)?.method === method)) {
      out.push({ url: String(u), body: i?.body ? JSON.parse(i.body as string) : undefined });
    }
  }
  return out;
}

function json(status: number, payload: Record<string, unknown>, initMethod?: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
      const method = reqInit?.method ?? 'GET';
      if (initMethod && method === initMethod) return new Response(JSON.stringify(payload), { status });
      return new Response('{}', { status: 404 });
    }),
  );
}

function mockContractors(items: Array<{ contractorId: string; companyName: string; name: string }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/dashboard/admin/contractors')) {
        return new Response(JSON.stringify({ items }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WorkOrderQuotationsPanel — read-only shell', () => {
  it('renders the received/total count and rows price-ascending (unpriced last)', () => {
    renderPanel({
      quotes: [
        quote({ quoteId: 'q-a', price: null }),
        quote({ quoteId: 'q-b', contractorId: 'c-2', price: '300', contractor: { name: 'Jane Doherty', companyName: 'Doherty Plumbing' } }),
        quote({ quoteId: 'q-c', contractorId: 'c-3', price: '150', contractor: { name: 'Sam Kerr', companyName: 'Kerr Joinery' } }),
      ],
    });

    expect(screen.getByText('2/3 received')).toBeInTheDocument();

    const rows = within(table()).getAllByRole('row').slice(1);
    const companyCells = rows.map((r) => r.querySelector('td')?.textContent ?? '');
    // Sorted: 150, 300, unpriced.
    expect(companyCells[0]).toContain('Kerr Joinery');
    expect(companyCells[1]).toContain('Doherty Plumbing');
    expect(companyCells[2]).toContain('Byrne Electrical Ltd');

    const prices = rows.map((r) => Array.from(r.querySelectorAll('td'))[1]?.textContent ?? '');
    expect(prices[0]).toMatch(/£\s?150/);
    expect(prices[1]).toMatch(/£\s?300/);
    expect(prices[2]).toBe('—');
  });

  it('teaches the empty state when no quotations exist', () => {
    renderPanel({ quotes: [] });
    expect(screen.getByText(/no quotations have been requested/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows a "Not received yet" subline for unpriced, link-less rows', () => {
    renderPanel({ quotes: [quote({ description: null })] });
    expect(within(table()).getByText('Not received yet')).toBeInTheDocument();
  });

  it('renders the breakdown subline and an external View-quote anchor when present', () => {
    renderPanel({ quotes: [quote({ quoteLink: 'https://quotes.example/byrne' })] });
    const row = within(table()).getAllByRole('row')[1];
    expect(row.textContent).toContain('Labour + materials');
    const link = within(row).getByRole('link', { name: /view quote/i });
    expect(link).toHaveAttribute('href', 'https://quotes.example/byrne');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('WorkOrderQuotationsPanel — edit affordances', () => {
  it('shows edit/delete only on OPENED rows, never on decided or disabled ones', () => {
    renderPanel({
      quotes: [
        quote({ state: 'OPENED' }),
        quote({ quoteId: 'q-2', contractorId: 'c-2', state: 'ACCEPTED', contractor: { name: 'Jane Doherty', companyName: 'Doherty Plumbing' } }),
        quote({ quoteId: 'q-3', contractorId: 'c-3', state: 'CLOSED', contractor: { name: 'Sam Kerr', companyName: 'Kerr Joinery' } }),
      ],
    });

    expect(screen.queryByRole('button', { name: /edit quotation from byrne/i })).not.toBeNull();
    expect(screen.getByRole('button', { name: /delete quotation from byrne/i })).not.toBeNull();
    // ACCEPTED + CLOSED rows: no edit affordance.
    const rows = within(table()).getAllByRole('row').slice(1);
    expect(rows[1].querySelector('button')).toBeNull();

    cleanup();
    renderPanel({ quotes: [quote()], disabled: true });
    expect(screen.queryByRole('button', { name: /edit quotation/i })).toBeNull();
    expect(within(table()).queryByText('Actions')).toBeNull(); // no actions column at all
  });
});

describe('WorkOrderQuotationsPanel — expanded-row edit', () => {
  it('pre-fills the three fields from the row on expand', () => {
    const rowWithPrice: WorkOrderQuote = { ...quote(), price: '950', quoteLink: 'https://quotes.example/x' } as WorkOrderQuote;
    renderPanel({ quotes: [rowWithPrice] });
    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));

    // type="number" inputs normalize through the browser/jsdom — assert on the raw value.
    const row = within(table()).getAllByRole('row')[1];
    expect(String((within(row).getByLabelText(/price/i) as HTMLInputElement).value)).toBe('950');
    expect(within(row).getByLabelText(/breakdown/i)).toHaveValue('Labour + materials');
    expect(within(row).getByLabelText(/quotation link/i)).toHaveValue('https://quotes.example/x');
  });

  it('fills the first price: PATCH sends numeric price and refetches on success', async () => {
    json(200, {}, 'PATCH');
    const { refetch } = renderPanel({ quotes: [quote()] }); // OUT_FOR_QUOTES, null price

    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));
    await screen.findByText(/recording the first price moves this work order to quotes in/i);

    const row = within(table()).getAllByRole('row')[1];
    fireEvent.change(within(row).getByLabelText(/price/i), { target: { value: '1200' } });
    fireEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const calls = callsWith('/api/admin/quotes/q-1', 'PATCH');
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ description: 'Labour + materials', quoteLink: '', price: 1200 });
    });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    // Expanded row collapsed again.
    expect(within(table()).queryByRole('button', { name: /^save$/i })).toBeNull();
  });

  it('emitted empty price on an unpriced row keeps the row unsent as clear (no price key)', async () => {
    json(200, {}, 'PATCH');
    renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));
    const row = within(table()).getAllByRole('row')[1];
    // Only change the breakdown — price stays empty on an unsent quote.
    fireEvent.change(within(row).getByLabelText(/breakdown/i), { target: { value: 'Updated scope' } });
    fireEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const calls = callsWith('/api/admin/quotes/q-1', 'PATCH');
      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({ description: 'Updated scope', quoteLink: '' });
      expect('price' in (calls[0].body ?? {})).toBe(false);
    });
  });

  it('blanked price on a RECEIVED quote resends the stored value, never a clear', async () => {
    json(200, {}, 'PATCH');
    renderPanel({ quotes: [quote({ price: '950' })] });

    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));
    const row = within(table()).getAllByRole('row')[1];
    fireEvent.change(within(row).getByLabelText(/price/i), { target: { value: '' } });
    expect(within(row).getByText(/leave blank to keep the current price/i)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const calls = callsWith('/api/admin/quotes/q-1', 'PATCH');
      expect(calls[0].body?.price).toBe(950);
    });
  });

  it('rejects a zero price client-side without calling the API', async () => {
    json(200, {}, 'PATCH');
    const { onFailed } = renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));
    const row = within(table()).getAllByRole('row')[1];
    fireEvent.change(within(row).getByLabelText(/price/i), { target: { value: '0' } });
    fireEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith(expect.stringMatching(/greater than zero/i)));
    expect(callsWith('/api/admin/quotes/q-1', 'PATCH')).toHaveLength(0);
  });

  it('surfaces the server PATCH error verbatim and keeps the row open', async () => {
    json(422, { error: 'price cannot be cleared once a quotation has been received' }, 'PATCH');
    const { onFailed } = renderPanel({ quotes: [quote({ price: '950' })] });

    fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));
    const row = within(table()).getAllByRole('row')[1];
    fireEvent.click(within(row).getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onFailed).toHaveBeenCalledWith('price cannot be cleared once a quotation has been received'));
    // Still editing — the form is still expanded.
    expect(within(table()).queryByRole('button', { name: /^save$/i })).toBeDefined();
  });

  it('Escape on a clean form cancels; on a dirty form asks before discarding', async () => {
    renderPanel({ quotes: [quote()] });

    const expand = () => fireEvent.click(screen.getByRole('button', { name: /edit quotation from byrne/i }));

    // Clean: straight cancel, no confirm.
    expand();
    expect(within(table()).getByRole('button', { name: /^save$/i })).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    await waitFor(() => expect(within(table()).queryByRole('button', { name: /^save$/i })).toBeNull());
    expect(screen.queryByText(/discard changes/i)).toBeNull();

    // Dirty: confirm dialog appears. (Re-query the button — React re-mounts rows.)
    expand();
    const row = within(table()).getAllByRole('row')[1];
    fireEvent.change(within(row).getByLabelText(/breakdown/i), { target: { value: 'changed' } });
    fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    expect(await screen.findByText(/discard changes/i)).toBeInTheDocument();

    // Confirm discards.
    fireEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(within(table()).queryByRole('button', { name: /^save$/i })).toBeNull());
  });
});

describe('WorkOrderQuotationsPanel — delete', () => {
  it('confirms with the incumbent copy and issues DELETE, then refetches', async () => {
    json(200, {}, 'DELETE');
    const { refetch } = renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /delete quotation from byrne/i }));
    expect(await screen.findByText(/delete byrne electrical ltd's quotation\? this removes the record only/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^delete$|^deleting…$/i }));
    await waitFor(() => {
      expect(callsWith('/api/admin/quotes/q-1', 'DELETE')).toHaveLength(1);
    });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('surfaces a blocked delete (409) verbatim to the parent banner and resyncs via refetch', async () => {
    json(409, { error: 'Quotations cannot be deleted while the work order is FINISHED' }, 'DELETE');
    const { onFailed, refetch } = renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /delete quotation from byrne/i }));
    await screen.findByText(/delete byrne electrical ltd's quotation/i);
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() =>
      expect(onFailed).toHaveBeenCalledWith('Quotations cannot be deleted while the work order is FINISHED'),
    );
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });
});

describe('WorkOrderQuotationsPanel — add quotation', () => {
  it('only offers the button in OUT_FOR_QUOTES (not disabled, not other states)', () => {
    const base = { quotes: [quote()] };
    renderPanel(base);
    expect(screen.getByRole('button', { name: /add quotation/i })).toBeInTheDocument();
    cleanup();

    renderPanel({ ...base, workOrderState: 'QUOTES_IN' });
    expect(screen.queryByRole('button', { name: /add quotation/i })).toBeNull();
    cleanup();

    renderPanel({ ...base, disabled: true });
    expect(screen.queryByRole('button', { name: /add quotation/i })).toBeNull();
  });

  it('excludes already-quoted contractors from the picker and POSTs the selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
        const url = String(input);
        if ((reqInit?.method ?? 'GET') === 'POST') return new Response(JSON.stringify({}), { status: 201 });
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({
              items: [
                { contractorId: 'c-1', companyName: 'Byrne Electrical Ltd', name: 'Pat Byrne' }, // already quoted
                { contractorId: 'c-2', companyName: 'Doherty Plumbing', name: 'Jane Doherty' },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    const { refetch } = renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /add quotation/i }));
    const heading = await screen.findByRole('heading', { name: /add quotation/i });
    expect(heading).toBeInTheDocument();

    // Open the MultiSelect dropdown — the already-quoted Byrne is filtered
    // out of the picker options (the table row still shows it, hence scoping).
    fireEvent.click(await screen.findByRole('button', { name: /select a contractor/i }));
    expect(within(screen.getByRole('dialog')).queryByText(/Byrne Electrical Ltd/)).toBeNull();
    const dohertyOption = await screen.findByText(/Doherty Plumbing/);
    fireEvent.click(dohertyOption);

    fireEvent.click(screen.getByRole('button', { name: /record quotation/i }));
    await waitFor(() => {
      const calls = vi.mocked(fetch).mock.calls.filter(([u, i]) => String(u) === '/api/admin/quotes' && (i as RequestInit)?.method === 'POST');
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0][1]!.body as string);
      expect(body.workOrderId).toBe('wo-1');
      expect(body.contractorId).toBe('c-2');
      expect(body.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}T12:00:00/); // local noon round-trip
    });
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
  });

  it('keeps the modal open with the server duplicate message on a 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, reqInit?: RequestInit) => {
        const url = String(input);
        if ((reqInit?.method ?? 'GET') === 'POST') {
          return new Response(JSON.stringify({ error: 'A quotation already exists for this contractor on this work order' }), { status: 422 });
        }
        if (url.includes('/api/dashboard/admin/contractors')) {
          return new Response(
            JSON.stringify({ items: [{ contractorId: 'c-9', companyName: 'New Entrant Ltd', name: 'Kim O\'Neill' }] }),
            { status: 200 },
          );
        }
        return new Response('{}', { status: 404 });
      }),
    );
    renderPanel({ quotes: [quote()] });

    fireEvent.click(screen.getByRole('button', { name: /add quotation/i }));
    await screen.findByRole('heading', { name: /add quotation/i });
    fireEvent.click(await screen.findByRole('button', { name: /select a contractor/i }));
    fireEvent.click(await screen.findByText(/New Entrant Ltd/));
    fireEvent.click(screen.getByRole('button', { name: /record quotation/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/a quotation already exists for this contractor on this work order/i);
    // Modal stays open for a retry.
    expect(screen.getByRole('heading', { name: /add quotation/i })).toBeInTheDocument();
  });
});

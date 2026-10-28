'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { quoteStateMeta, workOrderMoney } from '@/components/dashboard/work-order-shared';
import { QUOTE_STATES } from '@/lib/work-order-state';
import { apiFetch } from '@/lib/api-client';

/** Quote row as returned by GET /api/organizations/[orgId]/quotes (service list + joins). */
interface QuoteRow {
  quoteId: string;
  workOrderId: string;
  contractorId: string;
  quoteLink: string | null;
  description: string | null;
  price: string | null;
  dueDate: string;
  state: (typeof QUOTE_STATES)[number];
  organizationId: string;
  createdAt: string;
  updatedAt: string;
  contractor: { name: string; companyName: string };
  workOrder: { description: string; state: string };
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

/**
 * Tenant quotations — read-only, org-scoped. Organization resolution follows
 * the tenant work orders pattern: /api/auth/me → activeOrganizationId with a
 * localStorage fallback. There are no create/edit/delete affordances anywhere
 * on this page and it never calls an /api/admin route; quote management lives
 * with super admins.
 */
export default function TenantQuotesPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Active org from session first, then localStorage fallback.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let gotOrgFromApi = false;
      try {
        const meRes = await apiFetch('/api/auth/me');
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.activeOrganizationId && !cancelled) {
            setOrgId(me.activeOrganizationId);
            gotOrgFromApi = true;
          }
        }
      } catch { /* silently fall through */ }
      if (!gotOrgFromApi && !cancelled) {
        const stored = localStorage.getItem('nipp-active-org-id');
        if (stored) setOrgId(stored);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reset to page 1 when filters change.
  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, stateFilter]);

  const fetchData = useCallback(async () => {
    if (!orgId) return;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize) });
      if (search) params.set('search', search);
      if (stateFilter) params.set('state', stateFilter);

      const res = await apiFetch(`/api/organizations/${orgId}/quotes?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load quotations');
      }
      const data = await res.json();
      setRows((data.items || []) as QuoteRow[]);
      const total = data.pagination?.total ?? 0;
      setPagination({ page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load quotations';
      console.error('Failed to load quotations:', err);
      logClientError(message, 'tenant-quotes', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [orgId, pagination.page, pagination.pageSize, search, stateFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-dismiss error banner.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  const now = Date.now();

  const columns = [
    { key: 'workOrder', label: 'Work Order', render: (q: QuoteRow) => (
      <div className="min-w-0 max-w-xs">
        <Link href={`/dashboard/tenant/work-orders/${q.workOrderId}`} className="block truncate font-medium hover:underline" style={{ color: 'var(--color-navy-850)' }} title={q.workOrder.description}>
          {q.workOrder.description}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">Opened {formatDate(q.createdAt)}</div>
      </div>
    ) },
    { key: 'contractor', label: 'Contractor', render: (q: QuoteRow) => (
      <div className="min-w-0">
        <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>{q.contractor.companyName}</div>
        {q.description && <div className="max-w-xs truncate text-xs text-slate-500" title={q.description}>{q.description}</div>}
      </div>
    ) },
    { key: 'price', label: 'Price', render: (q: QuoteRow) => (
      <span className="font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>{workOrderMoney(q.price)}</span>
    ) },
    { key: 'state', label: 'State', render: (q: QuoteRow) => {
      const meta = quoteStateMeta(q.state);
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" style={{ backgroundColor: meta.bg, color: meta.text }}>
          {meta.label}
        </span>
      );
    } },
    { key: 'dueDate', label: 'Quoted By', render: (q: QuoteRow) => {
      const overdue = q.state === 'OPENED' && new Date(q.dueDate).getTime() < now;
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
          <CalendarClock className="h-3.5 w-3.5 shrink-0" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-slate-400)' }} />
          {formatDate(q.dueDate)}{overdue ? ' · Overdue' : ''}
        </span>
      );
    } },
  ];

  if (!orgId) {
    return (
      <div className="flex items-center justify-center py-16">
        <p style={{ color: 'var(--color-slate-700)' }}>No organization selected</p>
      </div>
    );
  }

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
          {error}
        </div>
      )}

      {/* Page header — no primary action: this workspace is read-only */}
      <PageHeader title="Quotations" description="Contractor quotations on your organization's work orders, as received" />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by contractor, work order..." aria-label="Search quotations" />
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by state"
        >
          <option value="">All States</option>
          {QUOTE_STATES.map((s) => (
            <option key={s} value={s}>{quoteStateMeta(s).label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<QuoteRow> columns={columns} data={rows} loading={loading || orgId === null} emptyMessage="No quotations have been recorded for this organization yet." rowKey={(q) => q.quoteId} />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />
    </div>
  );
}

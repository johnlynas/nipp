'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { WorkOrderStateBadge } from '@/components/dashboard/WorkOrderStateBadge';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { WORK_ORDER_STATES, WORK_ORDER_STATE_LABELS } from '@/lib/work-order-state';
import { isQuoteOverdue } from '@/components/dashboard/work-order-shared';

interface WorkOrderRow {
  workOrderId: string;
  description: string;
  openedBy: string;
  contractorId: string | null;
  quotesDue: string | null;
  state: (typeof WORK_ORDER_STATES)[number];
  createdAt: string;
  updatedAt: string;
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
 * Tenant work orders — read-only, org-scoped. The same incumbent vocabulary as
 * the dashboard (search + state filter + table + pagination); there are no
 * create/edit/delete affordances anywhere on this page. Organization resolution
 * follows the tenant calendar pattern: /api/auth/me → activeOrganizationId,
 * localStorage fallback.
 */
export default function TenantWorkOrdersPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
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
        const meRes = await fetch('/api/auth/me');
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

      const res = await fetch(`/api/organizations/${orgId}/work-orders?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load work orders');
      }
      const data = await res.json();
      setRows((data.items || []) as WorkOrderRow[]);
      const total = data.pagination?.total ?? 0;
      setPagination({ page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load work orders';
      console.error('Failed to load work orders:', err);
      logClientError(message, 'tenant-work-orders', 'fetch');
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
    { key: 'description', label: 'Work Order', render: (w: WorkOrderRow) => (
      <div className="min-w-0 max-w-xs">
        <Link href={`/dashboard/tenant/work-orders/${w.workOrderId}`} className="block truncate font-medium hover:underline" style={{ color: 'var(--color-navy-850)' }} title={w.description}>
          {w.description}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">Opened {formatDate(w.createdAt)} · {w.openedBy}</div>
      </div>
    ) },
    { key: 'state', label: 'State', render: (w: WorkOrderRow) => <WorkOrderStateBadge state={w.state} /> },
    { key: 'quotesDue', label: 'Quotes Due', render: (w: WorkOrderRow) => {
      const overdue = isQuoteOverdue(w, now);
      return w.quotesDue ? (
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5 shrink-0" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-slate-400)' }} />
          <span className={overdue ? 'font-medium' : ''} style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
            {formatDate(w.quotesDue)}{overdue ? ' · Overdue' : ''}
          </span>
        </span>
      ) : (
        <span className="text-slate-400">—</span>
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
      <PageHeader title="Work Orders" description="Your organization's work orders, quotes and progress" />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by description, opened by..." aria-label="Search work orders" />
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by state"
        >
          <option value="">All States</option>
          {WORK_ORDER_STATES.map((s) => (
            <option key={s} value={s}>{WORK_ORDER_STATE_LABELS[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<WorkOrderRow> columns={columns} data={rows} loading={loading || orgId === null} emptyMessage="No work orders for this organization yet." rowKey={(w) => w.workOrderId} />

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

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Eye, Pencil, Trash2, CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { WorkOrderStateBadge } from '@/components/dashboard/WorkOrderStateBadge';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { WORK_ORDER_STATES, WORK_ORDER_STATE_LABELS } from '@/lib/work-order-state';
import { isQuoteOverdue } from '@/components/dashboard/work-order-shared';

interface OrgOption {
  id: string;
  name: string;
  isPlatform?: boolean;
}

interface WorkOrderRow {
  workOrderId: string;
  description: string;
  openedBy: string;
  contractorId: string | null;
  quotesDue: string | null;
  state: (typeof WORK_ORDER_STATES)[number];
  organizationId: string;
  organizationName?: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;
const labelClass = 'mb-1 block text-sm font-medium';
const labelStyle = { color: 'var(--color-navy-850)' } as const;

/** Grouped stat tiles (semantic funnel — 9 raw states read worse than the story). */
const STATE_GROUPS: Array<{ key: string; label: string; states: ReadonlyArray<(typeof WORK_ORDER_STATES)[number]> }> = [
  { key: 'open', label: 'Open', states: ['CREATED', 'OUT_FOR_QUOTES'] },
  { key: 'quotes-in', label: 'Quotes In', states: ['QUOTES_IN'] },
  { key: 'in-progress', label: 'In Progress', states: ['CONTRACTOR_ASSIGNED', 'STARTED'] },
  { key: 'billing', label: 'Billing', states: ['COMPLETE', 'INVOICED'] },
  { key: 'finished', label: 'Finished', states: ['FINISHED'] },
  { key: 'closed', label: 'Closed', states: ['CLOSED'] },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function AdminWorkOrdersPage() {
  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create / edit / delete modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ organizationId: '', description: '', openedBy: '' });
  const [createSaving, setCreateSaving] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<WorkOrderRow | null>(null);
  const [editForm, setEditForm] = useState({ description: '', openedBy: '' });
  const [editSaving, setEditSaving] = useState(false);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<WorkOrderRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, stateFilter]);

  // Organization options (tenant orgs only — Platform is not a work-order tenant).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/organizations/list');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setOrgs((data.organizations || []).filter((o: OrgOption) => !o.isPlatform));
        }
      } catch { /* non-critical — the create form falls back to a disabled picker */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(pagination.page), pageSize: String(pagination.pageSize) });
      if (search) params.set('search', search);
      if (stateFilter) params.set('state', stateFilter);

      const res = await fetch(`/api/admin/work-orders?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load work orders');
      }
      const data = await res.json();
      setRows((data.items || []) as WorkOrderRow[]);
      const total = data.pagination?.total ?? 0;
      setPagination({ page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
      if (data.counts) setCounts(data.counts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load work orders';
      console.error('Failed to load work orders:', err);
      logClientError(message, 'work-orders', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, stateFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-dismiss error banner.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  const handleCreate = async () => {
    if (!createForm.organizationId || !createForm.description.trim()) {
      const message = 'Organization and description are required';
      logClientError(message, 'work-orders', 'create');
      setError(message);
      return;
    }
    setCreateSaving(true);
    try {
      const body: Record<string, unknown> = {
        organizationId: createForm.organizationId,
        description: createForm.description.trim(),
      };
      if (createForm.openedBy.trim()) body.openedBy = createForm.openedBy.trim();

      const res = await fetch('/api/admin/work-orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create work order');
      }
      setCreateOpen(false);
      setCreateForm({ organizationId: '', description: '', openedBy: '' });
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create work order';
      console.error('Failed to create work order:', err);
      logClientError(message, 'work-orders', 'create');
      setError(message);
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (row: WorkOrderRow) => {
    setEditing(row);
    setEditForm({ description: row.description, openedBy: row.openedBy });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editing) return;
    if (!editForm.description.trim() || !editForm.openedBy.trim()) {
      const message = 'Description and opened by are required';
      logClientError(message, 'work-orders', 'update');
      setError(message);
      return;
    }
    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/work-orders/${editing.workOrderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: editForm.description.trim(), openedBy: editForm.openedBy.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update work order');
      }
      setEditOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update work order';
      console.error('Failed to update work order:', err);
      logClientError(message, 'work-orders', 'update');
      setError(message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/admin/work-orders/${deleting.workOrderId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete work order');
      }
      setDeleteOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete work order';
      console.error('Failed to delete work order:', err);
      logClientError(message, 'work-orders', 'delete');
      setError(message);
      setDeleteBusy(false);
    }
  };

  const now = Date.now();
  const total = Object.keys(counts).length ? Object.values(counts).reduce((a, b) => a + b, 0) : pagination.total;
  const groupValue = (states: ReadonlyArray<string>) => states.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  const columns = [
    { key: 'description', label: 'Work Order', render: (w: WorkOrderRow) => (
      <div className="min-w-0 max-w-xs">
        <Link href={`/dashboard/admin/work-orders/${w.workOrderId}`} className="block truncate font-medium hover:underline" style={{ color: 'var(--color-navy-850)' }} title={w.description}>
          {w.description}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">Opened {formatDate(w.createdAt)} · {w.openedBy}</div>
      </div>
    ) },
    { key: 'organization', label: 'Organization', render: (w: WorkOrderRow) => (
      <span style={{ color: 'var(--color-navy-850)' }}>{w.organizationName ?? w.organizationId}</span>
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
    { key: 'actions', label: 'Actions', render: (w: WorkOrderRow) => (
      <div className="flex items-center gap-1">
        <Link
          href={`/dashboard/admin/work-orders/${w.workOrderId}`}
          title={`Manage ${w.description}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`Manage ${w.description}`}
        >
          <Eye className="h-4 w-4" />
        </Link>
        <button
          onClick={() => openEdit(w)}
          title={`Edit ${w.description}`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`Edit ${w.description}`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setDeleting(w); setDeleteOpen(true); }}
          title={`Delete ${w.description}`}
          className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
          aria-label={`Delete ${w.description}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ) },
  ];

  return (
    <div>
      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded border border-danger-border bg-danger-tint p-3 text-sm text-danger-ink" role="alert">
          {error}
        </div>
      )}

      {/* Stat tiles — the work-order funnel at a glance */}
      <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <StatCard label="Total Work Orders" value={loading ? '…' : total} />
        {STATE_GROUPS.map((g) => (
          <StatCard key={g.key} label={g.label} value={loading ? '…' : groupValue(g.states)} />
        ))}
      </div>

      {/* Page header */}
      <PageHeader
        title="Work Orders"
        description="Manage work orders across all organizations — RFQs, quotes, assignment and invoicing"
        primaryAction={
          <button
            onClick={() => setCreateOpen(true)}
            className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            + New Work Order
          </button>
        }
      />

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
      <DataTable<WorkOrderRow> columns={columns} data={rows} loading={loading} emptyMessage="No work orders found" rowKey={(w) => w.workOrderId} />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => !createSaving && setCreateOpen(false)} title="New Work Order" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="wo-new-org" className={labelClass} style={labelStyle}>Organization</label>
            <select
              id="wo-new-org"
              value={createForm.organizationId}
              onChange={(e) => setCreateForm((f) => ({ ...f, organizationId: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">Select an organization…</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="wo-new-desc" className={labelClass} style={labelStyle}>Description</label>
            <textarea
              id="wo-new-desc"
              value={createForm.description}
              onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
              rows={4}
              placeholder="What work needs to be done?"
              className={`${inputClass} resize-y`}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="wo-new-opened" className={labelClass} style={labelStyle}>Opened By (email)</label>
            <input
              id="wo-new-opened"
              type="email"
              value={createForm.openedBy}
              onChange={(e) => setCreateForm((f) => ({ ...f, openedBy: e.target.value }))}
              className={inputClass}
              style={inputStyle}
              placeholder="Defaults to your email"
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCreateOpen(false)} disabled={createSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={createSaving} className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>
              {createSaving ? 'Creating…' : 'Create Work Order'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => !editSaving && setEditOpen(false)} title="Edit Work Order" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="wo-edit-desc" className={labelClass} style={labelStyle}>Description</label>
            <textarea
              id="wo-edit-desc"
              value={editForm.description}
              onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              rows={4}
              className={`${inputClass} resize-y`}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="wo-edit-opened" className={labelClass} style={labelStyle}>Opened By (email)</label>
            <input
              id="wo-edit-opened"
              type="email"
              value={editForm.openedBy}
              onChange={(e) => setEditForm((f) => ({ ...f, openedBy: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
            State changes are actions on the work order page, not editable fields.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setEditOpen(false)} disabled={editSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button onClick={handleEdit} disabled={editSaving} className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>
              {editSaving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => !deleteBusy && setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Work Order"
        message={`Are you sure you want to delete “${deleting?.description ?? 'this work order'}”? Its notes, quotes and invoice are deleted with it. This action cannot be undone.`}
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
      />
    </div>
  );
}

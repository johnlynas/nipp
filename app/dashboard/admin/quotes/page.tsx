'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, CalendarClock } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { quoteStateMeta, workOrderMoney, toLocalInputDate, localInputDateToIso } from '@/components/dashboard/work-order-shared';
import { QUOTE_STATES, QUOTABLE_WORK_ORDER_STATES } from '@/lib/work-order-state';

/** Quote row as returned by GET /api/admin/quotes (service list + org join). */
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
  organizationName?: string;
  createdAt: string;
  updatedAt: string;
  contractor: { name: string; companyName: string };
  workOrder: { description: string; state: string };
}

interface WorkOrderOption {
  workOrderId: string;
  description: string;
  organizationName?: string;
  state: string;
}

interface ContractorOption {
  contractorId: string;
  companyName: string;
  name: string;
}

interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** State tiles — the quotation funnel (open → accepted, rejected/closed are outcomes). */
const STATE_TILES: Array<{ key: (typeof QUOTE_STATES)[number]; label: string; color?: 'default' | 'success' | 'danger' | 'warning' }> = [
  { key: 'OPENED', label: 'Open', color: 'warning' },
  { key: 'ACCEPTED', label: 'Accepted', color: 'success' },
  { key: 'REJECTED', label: 'Rejected', color: 'danger' },
  { key: 'CLOSED', label: 'Closed' },
];

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;
const labelClass = 'mb-1 block text-sm font-medium';
const labelStyle = { color: 'var(--color-navy-850)' } as const;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

export default function AdminQuotesPage() {
  const [rows, setRows] = useState<QuoteRow[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({ page: 1, pageSize: 8, total: 0, totalPages: 0 });
  const [search, setSearch] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [workOrderFilter, setWorkOrderFilter] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dropdown sources (lazy, cached once).
  const [workOrders, setWorkOrders] = useState<WorkOrderOption[]>([]);
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  // Create modal.
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ workOrderId: '', contractorId: '', dueDate: toLocalInputDate(new Date()) });
  const [createSaving, setCreateSaving] = useState(false);

  // Edit modal.
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<QuoteRow | null>(null);
  const [editForm, setEditForm] = useState({ price: '', description: '', quoteLink: '' });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<QuoteRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, stateFilter, workOrderFilter]);

  // Quotable work orders (dropdown for the create form + the table filter).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/work-orders?pageSize=100');
        if (res.ok) {
          const data = await res.json();
          const items: WorkOrderOption[] = (data.items || []).filter(
            (w: WorkOrderOption) => QUOTABLE_WORK_ORDER_STATES.includes(w.state),
          );
          if (!cancelled) setWorkOrders(items);
        }
      } catch { /* non-critical — create form falls back to a disabled picker */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/admin/contractors?pageSize=100');
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setContractors((data.items || []) as ContractorOption[]);
        }
      } catch { /* non-critical */ }
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
      if (workOrderFilter) params.set('workOrderId', workOrderFilter);

      const res = await fetch(`/api/admin/quotes?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load quotations');
      }
      const data = await res.json();
      setRows((data.items || []) as QuoteRow[]);
      const total = data.pagination?.total ?? 0;
      setPagination({ page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
      if (data.counts) setCounts(data.counts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load quotations';
      console.error('Failed to load quotations:', err);
      logClientError(message, 'quotations', 'fetch');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.pageSize, search, stateFilter, workOrderFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-dismiss error banner.
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(timer);
  }, [error]);

  async function loadContractorsIfNeeded(): Promise<ContractorOption[]> {
    if (contractors.length > 0) return contractors;
    try {
      const res = await fetch('/api/dashboard/admin/contractors?pageSize=100');
      if (res.ok) {
        const data = await res.json();
        const items = (data.items || []) as ContractorOption[];
        setContractors(items);
        return items;
      }
    } catch { /* handled by the modal footer error */ }
    return [];
  }

  const openCreate = async () => {
    setCreateForm({ workOrderId: '', contractorId: '', dueDate: toLocalInputDate(new Date()) });
    setCreateOpen(true);
    await loadContractorsIfNeeded();
  };

  const handleCreate = async () => {
    if (!createForm.workOrderId || !createForm.contractorId) {
      const message = 'Pick a work order and a contractor';
      logClientError(message, 'quotations', 'create');
      setError(message);
      return;
    }
    setCreateSaving(true);
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId: createForm.workOrderId,
          contractorId: createForm.contractorId,
          dueDate: localInputDateToIso(createForm.dueDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to open quotation');
      }
      setCreateOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open quotation';
      console.error('Failed to open quotation:', err);
      logClientError(message, 'quotations', 'create');
      setError(message);
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (row: QuoteRow) => {
    setEditing(row);
    setEditForm({ price: row.price ?? '', description: row.description ?? '', quoteLink: row.quoteLink ?? '' });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editing) return;
    // Price is only sent when present — the service forbids clearing a price
    // once received, so an emptied field means "keep the current value".
    const payload: Record<string, unknown> = {
      description: editForm.description.trim(),
      quoteLink: editForm.quoteLink.trim(),
    };
    const price = Number(editForm.price);
    if (editForm.price.trim() !== '') {
      if (!Number.isFinite(price) || price <= 0) {
        const message = 'Price must be greater than zero';
        logClientError(message, 'quotations', 'update');
        setError(message);
        return;
      }
      payload.price = editForm.price.trim();
    }

    setEditSaving(true);
    try {
      const res = await fetch(`/api/admin/quotes/${editing.quoteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save quotation');
      }
      setEditOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save quotation';
      console.error('Failed to save quotation:', err);
      logClientError(message, 'quotations', 'update');
      setError(message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/admin/quotes/${deleting.quoteId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete quotation');
      }
      setDeleteOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete quotation';
      console.error('Failed to delete quotation:', err);
      logClientError(message, 'quotations', 'delete');
      setError(message);
      setDeleteBusy(false);
    }
  };

  const now = Date.now();
  const totalFromCounts = Object.keys(counts).length > 0 ? Object.values(counts).reduce((a, b) => a + b, 0) : pagination.total;

  // A quote's due date is advisory while it is open — once decided it is history.
  const isOverdue = (q: QuoteRow) => q.state === 'OPENED' && new Date(q.dueDate).getTime() < now;

  const columns = [
    { key: 'workOrder', label: 'Work Order', render: (q: QuoteRow) => (
      <div className="min-w-0 max-w-xs">
        <Link href={`/dashboard/admin/work-orders/${q.workOrderId}`} className="block truncate font-medium hover:underline" style={{ color: 'var(--color-navy-850)' }} title={q.workOrder.description}>
          {q.workOrder.description}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">{q.organizationName ?? q.organizationId}</div>
      </div>
    ) },
    { key: 'contractor', label: 'Contractor', render: (q: QuoteRow) => (
      <div className="min-w-0">
        <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>{q.contractor.companyName}</div>
        <div className="truncate text-xs text-slate-500">{q.contractor.name}</div>
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
    { key: 'dueDate', label: 'Due', render: (q: QuoteRow) => {
      const overdue = isOverdue(q);
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
          <CalendarClock className="h-3.5 w-3.5 shrink-0" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-slate-400)' }} />
          {formatDate(q.dueDate)}{overdue ? ' · Overdue' : ''}
        </span>
      );
    } },
    { key: 'actions', label: 'Actions', render: (q: QuoteRow) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => openEdit(q)}
          title={`Edit ${q.contractor.companyName}'s quotation`}
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
          aria-label={`Edit ${q.contractor.companyName}'s quotation`}
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => { setDeleting(q); setDeleteOpen(true); }}
          title={`Delete ${q.contractor.companyName}'s quotation`}
          className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
          aria-label={`Delete ${q.contractor.companyName}'s quotation`}
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

      {/* Stat tiles — the quotation funnel at a glance */}
      <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <StatCard label="Total Quotations" value={loading ? '…' : totalFromCounts} />
        {STATE_TILES.map((t) => (
          <StatCard key={t.key} label={t.label} value={loading ? '…' : counts[t.key] ?? 0} color={t.color} />
        ))}
      </div>

      {/* Page header */}
      <PageHeader
        title="Quotations"
        description="Contractor quotations across all work orders — record prices, breakdowns and links as they arrive"
        primaryAction={
          <button
            onClick={openCreate}
            className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            + New Quotation
          </button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by contractor, work order, breakdown..." aria-label="Search quotations" />
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
        <select
          value={workOrderFilter}
          onChange={(e) => setWorkOrderFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by work order"
        >
          <option value="">All Work Orders</option>
          {workOrders.map((w) => (
            <option key={w.workOrderId} value={w.workOrderId}>{w.description}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable<QuoteRow> columns={columns} data={rows} loading={loading} emptyMessage="No quotations found" rowKey={(q) => q.quoteId} />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => !createSaving && setCreateOpen(false)} title="New Quotation" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="q-new-wo" className={labelClass} style={labelStyle}>Work Order</label>
            <select
              id="q-new-wo"
              value={createForm.workOrderId}
              onChange={(e) => setCreateForm((f) => ({ ...f, workOrderId: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">Select a work order…</option>
              {workOrders.map((w) => (
                <option key={w.workOrderId} value={w.workOrderId}>{w.description}{w.organizationName ? ` — ${w.organizationName}` : ''}</option>
              ))}
            </select>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-slate-500)' }}>Only work orders in Created, Out for Quotes or Quotes In states can take quotations.</p>
          </div>
          <div>
            <label htmlFor="q-new-contractor" className={labelClass} style={labelStyle}>Contractor</label>
            <select
              id="q-new-contractor"
              value={createForm.contractorId}
              onChange={(e) => setCreateForm((f) => ({ ...f, contractorId: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            >
              <option value="">Select a contractor…</option>
              {contractors.map((c) => (
                <option key={c.contractorId} value={c.contractorId}>{c.companyName} ({c.name})</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="q-new-due" className={labelClass} style={labelStyle}>Due Date</label>
            <input
              id="q-new-due"
              type="date"
              value={createForm.dueDate}
              onChange={(e) => setCreateForm((f) => ({ ...f, dueDate: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCreateOpen(false)} disabled={createSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button onClick={handleCreate} disabled={createSaving || !createForm.workOrderId || !createForm.contractorId} className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>
              {createSaving ? 'Creating…' : 'Open Quotation'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => !editSaving && setEditOpen(false)} title={`Edit Quotation — ${editing?.contractor.companyName ?? ''}`} size="md">
        {editing && (
          <div className="space-y-4">
            <div>
              <label htmlFor="q-edit-price" className={labelClass} style={labelStyle}>Price (£)</label>
              <input
                id="q-edit-price"
                type="number"
                step="0.01"
                min="0.01"
                value={editForm.price}
                onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                className={inputClass}
                style={inputStyle}
              />
              {editing.price === null && editing.workOrder.state === 'OUT_FOR_QUOTES' && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-warning-ink)' }}>
                  Recording the first price moves this work order to Quotes In.
                </p>
              )}
              {editing.price !== null && editForm.price.trim() === '' && (
                <p className="mt-1 text-xs" style={{ color: 'var(--color-slate-500)' }}>Leave blank to keep the current price — a received price cannot be cleared.</p>
              )}
            </div>
            <div>
              <label htmlFor="q-edit-desc" className={labelClass} style={labelStyle}>Breakdown</label>
              <textarea
                id="q-edit-desc"
                value={editForm.description}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className={`${inputClass} resize-y`}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="q-edit-link" className={labelClass} style={labelStyle}>Quotation Link</label>
              <input
                id="q-edit-link"
                type="url"
                value={editForm.quoteLink}
                onChange={(e) => setEditForm((f) => ({ ...f, quoteLink: e.target.value }))}
                placeholder="https://…"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>Only open quotations are editable — accepted, rejected and closed rows are immutable records.</p>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setEditOpen(false)} disabled={editSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
                Cancel
              </button>
              <button onClick={handleEdit} disabled={editSaving} className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: 'var(--color-accent)' }}>
                {editSaving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => !deleteBusy && setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Quotation"
        message={`Delete ${deleting?.contractor.companyName ?? 'this contractor'}'s quotation? This removes the record only — it does not email the contractor. Blocked once the work order is invoiced, finished or closed.`}
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
      />
    </div>
  );
}

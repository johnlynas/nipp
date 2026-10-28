'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, CalendarClock, ExternalLink } from 'lucide-react';
import { logClientError } from '@/lib/client-error-logger';
import { SearchBar } from '@/components/dashboard/SearchBar';
import { DataTable } from '@/components/dashboard/DataTable';
import { PageHeader } from '@/components/dashboard/PageHeader';
import { StatCard } from '@/components/dashboard/StatCard';
import { Modal } from '@/components/dashboard/Modal';
import { ConfirmDialog } from '@/components/dashboard/ConfirmDialog';
import { PaginationControls } from '@/components/admin/PaginationControls';
import { workOrderMoney, toLocalInputDate, localInputDateToIso } from '@/components/dashboard/work-order-shared';
import { WORK_ORDER_STATE_LABELS, workOrderStateTone, type WorkOrderState } from '@/lib/work-order-state';
import { apiFetch } from '@/lib/api-client';

/** Invoice row as returned by GET /api/admin/invoices (service list + org join). */
interface InvoiceRow {
  invoiceId: string;
  workOrderId: string;
  contractorId: string;
  invoiceLink: string | null;
  price: number;
  invoiceDate: string;
  dueDate: string;
  organizationId: string;
  organizationName?: string;
  createdAt: string;
  updatedAt: string;
  contractor: { name: string; companyName: string };
  workOrder: { description: string; state: WorkOrderState };
}

interface WorkOrderOption {
  workOrderId: string;
  description: string;
  organizationName?: string;
  /** Assigned contractor — invoices must record for exactly this one (service rule). */
  contractorId: string | null;
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

/**
 * Stat tiles follow the billing tail of the work order flow — an invoice has no
 * lifecycle of its own, so the funnel is expressed through parent states:
 * awaiting invoicing (COMPLETE) → invoiced (INVOICED) → paid/closed (FINISHED).
 */
const STATE_TILES: Array<{ key: string; label: string; color?: 'default' | 'success' | 'danger' | 'warning' }> = [
  { key: 'AWAITING', label: 'Awaiting Invoicing', color: 'warning' },
  { key: 'INVOICED', label: 'Invoiced' },
  { key: 'PAID_CLOSED', label: 'Paid + Closed', color: 'success' },
];

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;
const labelClass = 'mb-1 block text-sm font-medium';
const labelStyle = { color: 'var(--color-navy-850)' } as const;

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString();
}

/** Work order states that may be filtered on (everything from COMPLETE onward — invoices only exist there). */
const FILTERABLE_STATES: WorkOrderState[] = ['COMPLETE', 'INVOICED', 'FINISHED'];

export default function AdminInvoicesPage() {
  const [rows, setRows] = useState<InvoiceRow[]>([]);
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
  const [createForm, setCreateForm] = useState({ workOrderId: '', price: '', invoiceDate: toLocalInputDate(new Date()), dueDate: toLocalInputDate(new Date(Date.now() + 14 * 86400_000)), invoiceLink: '' });
  const [createSaving, setCreateSaving] = useState(false);

  // Edit modal.
  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState<InvoiceRow | null>(null);
  const [editForm, setEditForm] = useState({ price: '', invoiceDate: '', dueDate: '', invoiceLink: '' });
  const [editSaving, setEditSaving] = useState(false);

  // Delete confirm.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState<InvoiceRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setPagination((p) => ({ ...p, page: 1 }));
  }, [search, stateFilter, workOrderFilter]);

  // Work orders (dropdown for the create form + the table filter).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/admin/work-orders?pageSize=100');
        if (res.ok) {
          const data = await res.json();
          const items: WorkOrderOption[] = (data.items || []).filter(
            (w: WorkOrderOption) => ['COMPLETE', 'INVOICED', 'FINISHED'].includes(w.state),
          );
          if (!cancelled) setWorkOrders(items);
        }
      } catch { /* non-critical — filter falls back to no options */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Contractor directory (dropdown for the table filter + create form, cached once).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/dashboard/admin/contractors?pageSize=100');
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
      if (stateFilter) params.set('workOrderState', stateFilter);
      if (workOrderFilter) params.set('workOrderId', workOrderFilter);

      const res = await apiFetch(`/api/admin/invoices?${params}`, { signal: abortRef.current.signal });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load invoices');
      }
      const data = await res.json();
      setRows((data.items || []) as InvoiceRow[]);
      const total = data.pagination?.total ?? 0;
      setPagination({ page: pagination.page, pageSize: pagination.pageSize, total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)) });
      if (data.counts) setCounts(data.counts);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const message = err instanceof Error ? err.message : 'Failed to load invoices';
      console.error('Failed to load invoices:', err);
      logClientError(message, 'invoices', 'fetch');
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

  /** Invoice tiles map the per-state counts onto the billing funnel. */
  function tileCount(key: string): number {
    switch (key) {
      case 'AWAITING': return counts.COMPLETE ?? 0;
      case 'INVOICED': return counts.INVOICED ?? 0;
      case 'PAID_CLOSED': return (counts.FINISHED ?? 0) + (counts.CLOSED ?? 0);
      default: return 0;
    }
  }

  /** Editability follows the service rule — COMPLETE or INVOICED only. */
  const isEditable = (row: InvoiceRow) => row.workOrder.state === 'COMPLETE' || row.workOrder.state === 'INVOICED';
  /** Deletability follows the service rule — INVOICED only (correction = delete + re-record). */
  const isDeletable = (row: InvoiceRow) => row.workOrder.state === 'INVOICED';

  /** The WO's assigned contractor (service rule — invoices record for exactly this one). */
  const selectedWorkOrder = workOrders.find((w) => w.workOrderId === createForm.workOrderId);

  const openCreate = () => {
    setCreateForm({ workOrderId: '', price: '', invoiceDate: toLocalInputDate(new Date()), dueDate: toLocalInputDate(new Date(Date.now() + 14 * 86400_000)), invoiceLink: '' });
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    if (!selectedWorkOrder?.contractorId) {
      const message = 'Pick a completed work order with an assigned contractor';
      logClientError(message, 'invoices', 'create');
      setError(message);
      return;
    }
    const price = Number(createForm.price);
    if (createForm.price.trim() === '' || !Number.isFinite(price) || price <= 0) {
      const message = 'Price must be greater than zero';
      logClientError(message, 'invoices', 'create');
      setError(message);
      return;
    }

    setCreateSaving(true);
    try {
      const res = await apiFetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId: selectedWorkOrder.workOrderId,
          contractorId: selectedWorkOrder.contractorId,
          invoiceDate: localInputDateToIso(createForm.invoiceDate).toISOString(),
          dueDate: localInputDateToIso(createForm.dueDate).toISOString(),
          price,
          ...(createForm.invoiceLink.trim() ? { invoiceLink: createForm.invoiceLink.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to record invoice');
      }
      setCreateOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to record invoice';
      console.error('Failed to record invoice:', err);
      logClientError(message, 'invoices', 'create');
      setError(message);
    } finally {
      setCreateSaving(false);
    }
  };

  const openEdit = (row: InvoiceRow) => {
    setEditing(row);
    setEditForm({
      price: String(row.price),
      invoiceDate: toLocalInputDate(new Date(row.invoiceDate)),
      dueDate: toLocalInputDate(new Date(row.dueDate)),
      invoiceLink: row.invoiceLink ?? '',
    });
    setEditOpen(true);
  };

  const handleEdit = async () => {
    if (!editing) return;
    const price = Number(editForm.price);
    if (!Number.isFinite(price) || price <= 0) {
      const message = 'Price must be greater than zero';
      logClientError(message, 'invoices', 'update');
      setError(message);
      return;
    }

    setEditSaving(true);
    try {
      const res = await apiFetch(`/api/admin/invoices/${editing.invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price,
          invoiceDate: localInputDateToIso(editForm.invoiceDate).toISOString(),
          dueDate: localInputDateToIso(editForm.dueDate).toISOString(),
          invoiceLink: editForm.invoiceLink.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save invoice');
      }
      setEditOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save invoice';
      console.error('Failed to save invoice:', err);
      logClientError(message, 'invoices', 'update');
      setError(message);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`/api/admin/invoices/${deleting.invoiceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete invoice');
      }
      setDeleteOpen(false);
      fetchData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete invoice';
      console.error('Failed to delete invoice:', err);
      logClientError(message, 'invoices', 'delete');
      setError(message);
      setDeleteBusy(false);
    }
  };

  const now = Date.now();
  // A due date only pressures while the money is outstanding — FINISHED (paid)
  // and CLOSED rows are settled history.
  const isOverdue = (row: InvoiceRow) => row.workOrder.state !== 'FINISHED' && new Date(row.dueDate).getTime() < now;

  const columns = [
    { key: 'workOrder', label: 'Work Order', render: (q: InvoiceRow) => (
      <div className="min-w-0 max-w-xs">
        <Link href={`/dashboard/admin/work-orders/${q.workOrderId}`} className="block truncate font-medium hover:underline" style={{ color: 'var(--color-navy-850)' }} title={q.workOrder.description}>
          {q.workOrder.description}
        </Link>
        <div className="mt-0.5 text-xs text-slate-500">{q.organizationName ?? q.organizationId}</div>
      </div>
    ) },
    { key: 'contractor', label: 'Contractor', render: (q: InvoiceRow) => (
      <div className="min-w-0">
        <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>{q.contractor.companyName}</div>
        <div className="truncate text-xs text-slate-500">{q.contractor.name}</div>
      </div>
    ) },
    { key: 'price', label: 'Total', render: (q: InvoiceRow) => (
      <span className="font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>{workOrderMoney(q.price)}</span>
    ) },
    { key: 'invoiceDate', label: 'Invoiced', render: (q: InvoiceRow) => (
      <span className="tabular-nums" style={{ color: 'var(--color-navy-850)' }}>{formatDate(q.invoiceDate)}</span>
    ) },
    { key: 'dueDate', label: 'Due', render: (q: InvoiceRow) => {
      const overdue = isOverdue(q);
      return (
        <span className="inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
          <CalendarClock className="h-3.5 w-3.5 shrink-0" style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-slate-400)' }} />
          {formatDate(q.dueDate)}{overdue ? ' · Overdue' : ''}
        </span>
      );
    } },
    { key: 'state', label: 'Status', render: (q: InvoiceRow) => {
      const tone = workOrderStateTone(q.workOrder.state);
      return (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap" style={{ backgroundColor: tone.bg, color: tone.text }}>
          {WORK_ORDER_STATE_LABELS[q.workOrder.state]}
        </span>
      );
    } },
    { key: 'link', label: 'Link', render: (q: InvoiceRow) =>
      q.invoiceLink ? (
        <a href={q.invoiceLink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm hover:underline" style={{ color: 'var(--color-danger-ink)' }}>
          View <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <span className="text-sm text-slate-400">—</span>
      ),
    },
    { key: 'actions', label: 'Actions', render: (q: InvoiceRow) => (
      <div className="flex items-center gap-1">
        {isEditable(q) && (
          <button
            onClick={() => openEdit(q)}
            title={`Edit invoice for ${q.contractor.companyName}`}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-850 transition-colors"
            aria-label={`Edit invoice for ${q.contractor.companyName}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {isDeletable(q) && (
          <button
            onClick={() => { setDeleting(q); setDeleteOpen(true); }}
            title={`Delete invoice for ${q.contractor.companyName}`}
            className="rounded p-1.5 text-slate-500 hover:bg-danger-tint hover:text-danger-ink transition-colors"
            aria-label={`Delete invoice for ${q.contractor.companyName}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
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

      {/* Stat tiles — the billing funnel at a glance */}
      <div className="mb-6 grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
        <StatCard label="Total Invoices" value={loading ? '…' : pagination.total} />
        {STATE_TILES.map((t) => (
          <StatCard key={t.key} label={t.label} value={loading ? '…' : tileCount(t.key)} color={t.color} />
        ))}
      </div>

      {/* Page header */}
      <PageHeader
        title="Invoices"
        description="Contractor invoices across all work orders — recorded once work is complete; corrections allowed before payment"
        primaryAction={
          <button
            onClick={openCreate}
            className="w-full sm:w-auto rounded px-4 py-2 text-center text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)' }}
          >
            + New Invoice
          </button>
        }
      />

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SearchBar value={search} onChange={setSearch} placeholder="Search by contractor, work order..." aria-label="Search invoices" />
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded border px-3 py-2 text-sm bg-white hover:bg-slate-50 transition-colors focus:outline-none"
          style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {FILTERABLE_STATES.map((s) => (
            <option key={s} value={s}>{WORK_ORDER_STATE_LABELS[s]}</option>
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
      <DataTable<InvoiceRow> columns={columns} data={rows} loading={loading} emptyMessage="No invoices found — record one with the button above when a work order moves to Complete" rowKey={(q) => q.invoiceId} />

      {/* Pagination */}
      <PaginationControls
        currentPage={pagination.page}
        totalPages={pagination.totalPages}
        totalItems={pagination.total}
        pageSize={pagination.pageSize}
        onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
      />

      {/* Create modal */}
      <Modal isOpen={createOpen} onClose={() => !createSaving && setCreateOpen(false)} title="New Invoice" size="md">
        <div className="space-y-4">
          <div>
            <label htmlFor="inv-new-wo" className={labelClass} style={labelStyle}>Work Order</label>
            <select
              id="inv-new-wo"
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
            <p className="mt-1 text-xs" style={{ color: 'var(--color-slate-500)' }}>Only completed work orders can be invoiced. The invoice is recorded for the work order's assigned contractor.</p>
          </div>
          {selectedWorkOrder?.contractorId && (
            <div>
              <label className={labelClass} style={labelStyle}>Contractor</label>
              <input
                value={contractors.find((c) => c.contractorId === selectedWorkOrder.contractorId)?.companyName ?? 'Assigned contractor'}
                disabled
                className={inputClass}
                style={{ ...inputStyle, backgroundColor: 'var(--color-slate-50)', color: 'var(--color-slate-500)' }}
              />
            </div>
          )}
          <div>
            <label htmlFor="inv-new-price" className={labelClass} style={labelStyle}>Total (£)</label>
            <input
              id="inv-new-price"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={createForm.price}
              onChange={(e) => setCreateForm((f) => ({ ...f, price: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="inv-new-date" className={labelClass} style={labelStyle}>Invoice Date</label>
            <input
              id="inv-new-date"
              type="date"
              value={createForm.invoiceDate}
              onChange={(e) => setCreateForm((f) => ({ ...f, invoiceDate: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="inv-new-due" className={labelClass} style={labelStyle}>Due Date</label>
            <input
              id="inv-new-due"
              type="date"
              value={createForm.dueDate}
              onChange={(e) => setCreateForm((f) => ({ ...f, dueDate: e.target.value }))}
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <div>
            <label htmlFor="inv-new-link" className={labelClass} style={labelStyle}>Invoice Link (optional)</label>
            <input
              id="inv-new-link"
              type="url"
              value={createForm.invoiceLink}
              onChange={(e) => setCreateForm((f) => ({ ...f, invoiceLink: e.target.value }))}
              placeholder="https://…"
              className={inputClass}
              style={inputStyle}
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
            Recording the invoice does not move the work order — once the row exists, advance it with the Mark Invoiced action on the work order's detail page.
          </p>
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setCreateOpen(false)} disabled={createSaving} className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50" style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}>
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={createSaving || !createForm.workOrderId || createForm.price.trim() === ''}
              className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-accent)' }}
            >
              {createSaving ? 'Creating…' : 'Record Invoice'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={editOpen} onClose={() => !editSaving && setEditOpen(false)} title={`Edit Invoice — ${editing?.contractor.companyName ?? ''}`} size="md">
        {editing && (
          <div className="space-y-4">
            <div>
              <label htmlFor="inv-edit-price" className={labelClass} style={labelStyle}>Total (£)</label>
              <input
                id="inv-edit-price"
                type="number"
                step="0.01"
                min="0.01"
                value={editForm.price}
                onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="inv-edit-date" className={labelClass} style={labelStyle}>Invoice Date</label>
              <input
                id="inv-edit-date"
                type="date"
                value={editForm.invoiceDate}
                onChange={(e) => setEditForm((f) => ({ ...f, invoiceDate: e.target.value }))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="inv-edit-due" className={labelClass} style={labelStyle}>Due Date</label>
              <input
                id="inv-edit-due"
                type="date"
                value={editForm.dueDate}
                onChange={(e) => setEditForm((f) => ({ ...f, dueDate: e.target.value }))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="inv-edit-link" className={labelClass} style={labelStyle}>Invoice Link</label>
              <input
                id="inv-edit-link"
                type="url"
                value={editForm.invoiceLink}
                onChange={(e) => setEditForm((f) => ({ ...f, invoiceLink: e.target.value }))}
                placeholder="https://…"
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
              Corrections are allowed while the work order is {WORK_ORDER_STATE_LABELS.COMPLETE} or {WORK_ORDER_STATE_LABELS.INVOICED}. Once finished and paid, the invoice is a closed record.
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
        )}
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={deleteOpen}
        onClose={() => !deleteBusy && setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Invoice"
        message={`Delete the invoice for ${deleting?.contractor.companyName ?? 'this contractor'}? You will need to re-record it from the work order's detail page to advance. The contractor is not notified.`}
        confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
        variant="danger"
      />
    </div>
  );
}

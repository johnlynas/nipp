'use client';

import { useState, useEffect, useCallback } from 'react';
import { ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog } from './ConfirmDialog';
import {
  type WorkOrderDetail,
  workOrderDate,
  workOrderMoney,
  toLocalInputDate,
  localInputDateToIso,
} from './work-order-shared';
import { apiFetch } from '@/lib/api-client';

/**
 * Invoice section on the super-admin work order detail page — the billing tail
 * of the flow. The panel is state-aware: card view (invoice exists), creation
 * form (COMPLETE with no invoice), and a teaching muted line otherwise. All
 * mutations refetch through the parent's load() — the server owns state
 * (the API does NOT auto-hop on invoice create; "Mark Invoiced" is a separate
 * transition the action bar offers once the row exists).
 */

interface WorkOrderInvoicePanelProps {
  detail: WorkOrderDetail;
  /** Terminal states → no controls anywhere in the section. */
  disabled?: boolean;
  /** Parent's load() — refetch after any mutation. */
  load: () => Promise<void>;
  /** Parent error banner (verbatim server messages). */
  onFailed: (message: string) => void;
}

/** Label/value card row (slate labels, navy values) — the details' vocabulary. */
function CardRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="shrink-0 text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right" style={{ color: 'var(--color-navy-850)' }}>{children}</span>
    </div>
  );
}

/** Standard payment term for a recorded invoice — 14 days (flag for product: 30/60?). */
const INVOICE_PAYMENT_TERM_DAYS = 14;

const inputClass = 'w-full rounded border px-3 py-2 text-sm bg-white focus:outline-none';
const inputStyle = { borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' } as const;

export function WorkOrderInvoicePanel({ detail, disabled = false, load, onFailed }: WorkOrderInvoicePanelProps) {
  const invoice = detail.invoice;
  const overdue = !!invoice && new Date(invoice.dueDate).getTime() < Date.now();

  // ── Record form (COMPLETE, no invoice yet) ───────────────────────
  const showCreateForm = !disabled && detail.state === 'COMPLETE' && invoice === null;
  // Prefill from the ACCEPTED quote (service invariant: exactly one).
  const acceptedQuote = detail.quotes.find((q) => q.state === 'ACCEPTED');
  const [price, setPrice] = useState(() => {
    const prefilled = acceptedQuote && acceptedQuote.price !== null ? String(Number(acceptedQuote.price)) : '';
    return prefilled;
  });
  const [invoiceDate, setInvoiceDate] = useState(() => toLocalInputDate(new Date()));
  const [dueDate, setDueDate] = useState(() => toLocalInputDate(new Date(Date.now() + INVOICE_PAYMENT_TERM_DAYS * 86400_000)));
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);

  const priceNumber = Number(price.trim());
  const canSubmit = price.trim() !== '' && Number.isFinite(priceNumber) && priceNumber > 0 && invoiceDate !== '' && dueDate !== '';

  // ── Edit (pre-payment corrections — COMPLETE/INVOICED only, service rule) ──
  const canEditInvoice = !!invoice && !disabled && (detail.state === 'COMPLETE' || detail.state === 'INVOICED');
  const [editForm, setEditForm] = useState<{ price: string; invoiceDate: string; dueDate: string; link: string } | null>(null);
  const [editInitial, setEditInitial] = useState<{ price: string; invoiceDate: string; dueDate: string; link: string } | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const startEdit = () => {
    if (!invoice) return;
    const next = {
      price: String(Number(invoice.price)),
      invoiceDate: toLocalInputDate(new Date(invoice.invoiceDate)),
      dueDate: toLocalInputDate(new Date(invoice.dueDate)),
      link: invoice.invoiceLink ?? '',
    };
    setEditForm(next);
    setEditInitial(next);
  };

  const cancelEdit = useCallback(() => {
    if (editSaving) return;
    setEditForm(null);
  }, [editSaving]);

  // Escape exits editing — discard-confirm only when dirty (quotations panel pattern).
  useEffect(() => {
    if (!editForm || discardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (
        editInitial &&
        (editForm.price !== editInitial.price || editForm.invoiceDate !== editInitial.invoiceDate ||
         editForm.dueDate !== editInitial.dueDate || editForm.link !== editInitial.link)
      ) {
        setDiscardOpen(true);
      } else {
        cancelEdit();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editForm, editInitial, discardOpen, cancelEdit]);

  const handleEditSave = async () => {
    if (!invoice || !editForm) return;
    const edPrice = Number(editForm.price.trim());
    if (editForm.price.trim() === '' || !Number.isFinite(edPrice) || edPrice <= 0) {
      onFailed('Price must be greater than zero');
      return;
    }
    setEditSaving(true);
    try {
      const res = await apiFetch(`/api/admin/invoices/${invoice.invoiceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          price: edPrice,
          invoiceDate: localInputDateToIso(editForm.invoiceDate).toISOString(),
          dueDate: localInputDateToIso(editForm.dueDate).toISOString(),
          invoiceLink: editForm.link.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409 once FINISHED/CLOSED (concurrent finish) — verbatim + resync.
        onFailed(data.error || 'Failed to save invoice');
        await load();
        return;
      }
      setEditForm(null);
      await load();
    } catch {
      onFailed('Failed to save invoice');
    } finally {
      setEditSaving(false);
    }
  };

  // ── Delete (INVOICED only — server rule; see confirm copy for the consequence) ──
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleDelete = async () => {
    if (!invoice) return;
    setDeleteBusy(true);
    try {
      const res = await apiFetch(`/api/admin/invoices/${invoice.invoiceId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        onFailed(data.error || 'Failed to delete invoice');
        await load();
        return;
      }
      setDeleteOpen(false);
      await load();
    } catch {
      onFailed('Failed to delete invoice');
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleCreate = async () => {
    if (!canSubmit || !detail.contractorId) return;
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workOrderId: detail.workOrderId,
          contractorId: detail.contractorId, // always the assigned contractor — service rejects anything else
          invoiceDate: localInputDateToIso(invoiceDate).toISOString(),
          dueDate: localInputDateToIso(dueDate).toISOString(),
          price: priceNumber,
          ...(link.trim() ? { invoiceLink: link.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409 duplicate / 422 state-contractor messages verbatim to the parent.
        onFailed(data.error || 'Failed to record invoice');
        // State may have moved concurrently (e.g. already invoiced) — resync.
        await load();
        return;
      }
      await load();
    } catch {
      onFailed('Failed to record invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-lg border p-5" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas)' }}>
      {/* Heading row — the total is the visual anchor of the card; edit control group sits right. */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>Invoice</h2>
        <div className="flex items-center gap-3">
          {canEditInvoice && !editForm && (
            <div className="flex items-center gap-1">
              <button
                onClick={startEdit}
                aria-label="Edit invoice"
                className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-navy-850"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              {detail.state === 'INVOICED' && (
                <button
                  onClick={() => setDeleteOpen(true)}
                  aria-label="Delete invoice"
                  title="Delete requires re-recording before the work order can be marked invoiced again — only offer this at INVOICED."
                  className="rounded p-1.5 text-slate-500 transition-colors hover:bg-danger-tint hover:text-danger-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          {invoice && !editForm && (
            <span className="text-2xl font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
              {workOrderMoney(invoice.price)}
            </span>
          )}
        </div>
      </div>

      {invoice ? (
        editForm ? (
          // In-card edit — pre-payment corrections (service allows COMPLETE/INVOICED).
          <div className="max-w-md space-y-4">
            <div>
              <label htmlFor="wo-invoice-edit-price" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Price (£)</label>
              <input
                id="wo-invoice-edit-price"
                type="number"
                step="0.01"
                min="0.01"
                value={editForm.price}
                onChange={(e) => setEditForm((f) => (f ? { ...f, price: e.target.value } : f))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="wo-invoice-edit-date" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Invoice date</label>
              <input
                id="wo-invoice-edit-date"
                type="date"
                value={editForm.invoiceDate}
                onChange={(e) => setEditForm((f) => (f ? { ...f, invoiceDate: e.target.value } : f))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="wo-invoice-edit-due" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Due date</label>
              <input
                id="wo-invoice-edit-due"
                type="date"
                value={editForm.dueDate}
                onChange={(e) => setEditForm((f) => (f ? { ...f, dueDate: e.target.value } : f))}
                className={inputClass}
                style={inputStyle}
              />
            </div>
            <div>
              <label htmlFor="wo-invoice-edit-link" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Invoice link</label>
              <input
                id="wo-invoice-edit-link"
                type="url"
                value={editForm.link}
                onChange={(e) => setEditForm((f) => (f ? { ...f, link: e.target.value } : f))}
                className={inputClass}
                style={inputStyle}
                placeholder="https://…"
              />
            </div>
            <p className="text-xs" style={{ color: 'var(--color-slate-500)' }}>
              Corrections are allowed before payment; after the work order finishes, the record is immutable.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={cancelEdit}
                disabled={editSaving}
                className="rounded border px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-50"
                style={{ borderColor: 'var(--color-slate-200)', color: 'var(--color-navy-850)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={editSaving}
                className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-accent)' }}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
        <div className="space-y-3">
          <CardRow label="Invoice date">{workOrderDate(invoice.invoiceDate)}</CardRow>
          <CardRow label="Due date">
            <span style={{ color: overdue ? 'var(--color-warning-ink)' : 'var(--color-navy-850)' }}>
              {workOrderDate(invoice.dueDate)}{overdue ? ' · Overdue' : ''}
            </span>
          </CardRow>
          <CardRow label="Contractor">
            {invoice.contractor?.companyName ?? invoice.contractorId}
          </CardRow>
          {invoice.invoiceLink && (
            <CardRow label="Invoice">
              <a
                href={invoice.invoiceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 transition-colors hover:underline"
                style={{ color: 'var(--color-navy-850)' }}
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                View invoice
              </a>
            </CardRow>
          )}
          <p className="text-xs" style={{ color: 'var(--color-slate-400)' }}>
            Recorded {workOrderDate(invoice.createdAt)}
          </p>

          {/* Recorded but not yet hopped — make the two-step explicit (no dead-end). */}
          {detail.state === 'COMPLETE' && (
            <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
              Invoice recorded — use Mark Invoiced above to advance the work order.
            </p>
          )}
        </div>
        )
      ) : showCreateForm ? (
        <div className="max-w-md space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Work is complete — record the contractor&rsquo;s invoice below.
          </p>

          {detail.contractorId === null ? (
            // Defensive — COMPLETE implies an assigned contractor, but the API
            // would 422 without one; a dead form would be worse than a disabled note.
            <p className="text-sm" style={{ color: 'var(--color-slate-400)' }}>
              Assign a contractor to record an invoice.
            </p>
          ) : (
            <>
              <div>
                <label htmlFor="wo-invoice-price" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Price (£)</label>
                <input
                  id="wo-invoice-price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
                {acceptedQuote && acceptedQuote.price !== null && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-slate-500)' }}>
                    From {acceptedQuote.contractor?.companyName ?? 'the contractor'}&rsquo;s accepted quote.
                  </p>
                )}
              </div>
              <div>
                <label htmlFor="wo-invoice-date" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Invoice date</label>
                <input
                  id="wo-invoice-date"
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="wo-invoice-due" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Due date</label>
                <input
                  id="wo-invoice-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="wo-invoice-link" className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-navy-850)' }}>Invoice link</label>
                <input
                  id="wo-invoice-link"
                  type="url"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  className={inputClass}
                  style={inputStyle}
                  placeholder="https://…"
                />
              </div>
              <div className="flex justify-end pt-1">
                <button
                  onClick={handleCreate}
                  disabled={!canSubmit || saving}
                  className="rounded px-4 py-2 text-sm font-medium text-accent-ink transition-colors hover:opacity-90 disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-accent)' }}
                >
                  {saving ? 'Recording…' : 'Record Invoice'}
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <p className="py-1 text-sm" style={{ color: 'var(--color-slate-400)' }}>
          No invoice recorded yet — invoicing becomes available when the work order is complete.
        </p>
      )}

      {/* Escape-discard confirm for in-card edits (only offered when dirty) */}
      {discardOpen && (
        <ConfirmDialog
          isOpen
          onClose={() => setDiscardOpen(false)}
          onConfirm={() => { setDiscardOpen(false); cancelEdit(); }}
          title="Discard changes?"
          message="This invoice has unsaved edits."
          confirmLabel="Discard"
          variant="danger"
        />
      )}

      {/* Delete confirm — v1 correction escape hatch (INVOICED only) */}
      {deleteOpen && invoice && (
        <ConfirmDialog
          isOpen
          onClose={() => !deleteBusy && setDeleteOpen(false)}
          onConfirm={handleDelete}
          title="Delete invoice"
          message="Delete this invoice? You will need to re-record it before the work order can be marked invoiced again. The contractor is not notified."
          confirmLabel={deleteBusy ? 'Deleting…' : 'Delete'}
          variant="danger"
        />
      )}
    </section>
  );
}

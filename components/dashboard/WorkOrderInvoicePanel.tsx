'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import {
  type WorkOrderDetail,
  workOrderDate,
  workOrderMoney,
  toLocalInputDate,
  localInputDateToIso,
} from './work-order-shared';

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

  const handleCreate = async () => {
    if (!canSubmit || !detail.contractorId) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/invoices', {
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
      {/* Heading row — the total is the visual anchor of the card; controls sit right. */}
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>Invoice</h2>
        {invoice && (
          <span className="text-2xl font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
            {workOrderMoney(invoice.price)}
          </span>
        )}
      </div>

      {invoice ? (
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
    </section>
  );
}

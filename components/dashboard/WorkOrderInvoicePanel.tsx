'use client';

import { ExternalLink } from 'lucide-react';
import {
  type WorkOrderDetail,
  workOrderDate,
  workOrderMoney,
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

export function WorkOrderInvoicePanel({ detail, disabled = false, load, onFailed }: WorkOrderInvoicePanelProps) {
  const invoice = detail.invoice;
  const overdue = !!invoice && new Date(invoice.dueDate).getTime() < Date.now();

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

          {/* Plan 3 task 2+: record form zone lives here when there is no invoice (COMPLETE). */}
        </div>
      ) : detail.state === 'COMPLETE' ? (
        <div>
          <p className="text-sm" style={{ color: 'var(--color-slate-500)' }}>
            Work is complete — record the contractor&rsquo;s invoice below.
          </p>
          {/* Form zone — plan 3 task 2 */}
        </div>
      ) : (
        <p className="py-1 text-sm" style={{ color: 'var(--color-slate-400)' }}>
          No invoice recorded yet — invoicing becomes available when the work order is complete.
        </p>
      )}
    </section>
  );
}

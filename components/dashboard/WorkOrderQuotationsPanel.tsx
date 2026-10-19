'use client';

import { type WorkOrderQuote, workOrderDate, workOrderMoney, quoteStateMeta } from './work-order-shared';
import type { WorkOrderStateValue } from './work-order-shared';

/**
 * Quotations section on the super-admin work order detail page. Compact
 * comparison table (price ascending, unpriced last — display-only); controls
 * land in follow-up tasks. Rendering mirrors `QuoteTable` internals exactly so
 * the two quote surfaces read as one component family.
 */

interface WorkOrderQuotationsPanelProps {
  workOrderId: string;
  quotes: WorkOrderQuote[];
  workOrderState: WorkOrderStateValue;
  /** Terminal states → no controls anywhere in the section. */
  disabled?: boolean;
  /** Parent's load() — refetch after any mutation (server owns quote state). */
  refetch: () => Promise<void>;
  /** Parent error banner. */
  onFailed: (message: string) => void;
}

export function WorkOrderQuotationsPanel({
  quotes,
  workOrderState,
  disabled = false,
}: WorkOrderQuotationsPanelProps) {
  const sorted = [...quotes].sort((a, b) => {
    const pa = a.price === null ? Number.POSITIVE_INFINITY : Number(a.price);
    const pb = b.price === null ? Number.POSITIVE_INFINITY : Number(b.price);
    return pa - pb;
  });

  const received = quotes.filter((q) => q.price !== null).length;

  return (
    <section className="rounded-lg border p-5" style={{ borderColor: 'var(--color-slate-200)', backgroundColor: 'var(--color-canvas)' }}>
      {/* Heading row — the operational question: how many quotes have prices? */}
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--color-slate-500)' }}>Quotations</h2>
        <span className="text-xs tabular-nums" style={{ color: 'var(--color-slate-500)' }}>
          {received}/{quotes.length} received
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="py-2 text-sm" style={{ color: 'var(--color-slate-400)' }}>
          No quotations have been requested — send an RFQ from the actions above.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--color-slate-200)' }}>
          <table className="min-w-full divide-y divide-slate-200">
            {/* Columns extend in Task 2 (Actions). workOrderState / disabled are
                consumed there; the contract is on the props interface. */}
            <thead>
              <tr className="bg-canvas-subtle">
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Contractor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Price</th>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">State</th>
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Due date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {sorted.map((q) => {
                const meta = quoteStateMeta(q.state);
                return (
                  <tr key={q.quoteId}>
                    <td className="min-w-0 px-4 py-3 text-sm">
                      <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>
                        {q.contractor ? q.contractor.companyName : q.contractorId}
                      </div>
                      {q.contractor && (
                        <div className="text-xs text-slate-500">{q.contractor.name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
                      {workOrderMoney(q.price)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
                        style={{ backgroundColor: meta.bg, color: meta.text }}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
                      {workOrderDate(q.dueDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

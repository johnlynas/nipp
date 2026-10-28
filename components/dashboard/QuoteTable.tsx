'use client';

import { type WorkOrderQuote, workOrderDate, workOrderMoney, quoteStateMeta } from './work-order-shared';

/**
 * Quote comparison table — display-only. Used by the admin assign dialog
 * (with selection) and the tenant detail page (read-only). Rows render
 * price-ascending with unpriced quotes last; the sort is display-only.
 */
export function QuoteTable({
  quotes,
  selectedQuoteId,
  onSelect,
}: {
  quotes: WorkOrderQuote[];
  /** When set, rows eligible for assignment (priced + OPENED/ACCEPTED) render a radio. */
  selectedQuoteId?: string | null;
  onSelect?: (quoteId: string) => void;
}) {
  const sorted = [...quotes].sort((a, b) => {
    const pa = a.price === null ? Number.POSITIVE_INFINITY : Number(a.price);
    const pb = b.price === null ? Number.POSITIVE_INFINITY : Number(b.price);
    return pa - pb;
  });

  if (sorted.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded border" style={{ borderColor: 'var(--color-slate-200)' }}>
      <table className="min-w-full divide-y divide-slate-200">
        <thead>
          <tr className="bg-canvas-subtle">
            {onSelect && <th className="w-8 px-3 py-3" />}
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Contractor</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Price</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">State</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500" scope="col">Due date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {sorted.map((q) => {
            const meta = quoteStateMeta(q.state);
            const selectable = !!onSelect && q.price !== null && (q.state === 'OPENED' || q.state === 'ACCEPTED');
            return (
              <tr
                key={q.quoteId}
                onClick={selectable ? () => onSelect?.(q.quoteId) : undefined}
                className={`transition-colors ${selectable ? 'cursor-pointer hover:bg-slate-50' : ''}`}
              >
                {onSelect && (
                  <td className="px-3 py-3">
                    {selectable ? (
                      <input
                        type="radio"
                        name="wo-quote-select"
                        aria-label={`Assign ${q.contractor?.companyName ?? 'this quote'}`}
                        checked={selectedQuoteId === q.quoteId}
                        onChange={() => onSelect?.(q.quoteId)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                )}
                <td className="min-w-0 px-4 py-3 text-sm">
                  <div className="truncate font-medium" style={{ color: 'var(--color-navy-850)' }}>
                    {q.contractor ? q.contractor.companyName : q.contractorId}
                  </div>
                  {q.contractor && (
                    <div className="text-xs text-slate-500">{q.contractor.name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm tabular-nums" style={{ color: 'var(--color-navy-850)' }}>
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
  );
}

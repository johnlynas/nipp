'use client';

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Show the "Showing X–Y of Z entries" label beside the controls (default true). */
  showRangeLabel?: boolean;
}

/**
 * Smart pagination with ellipsis truncation.
 * Shows: 1 … 4 5 [6] 7 8 … N   (when on page 6 of 20)
 */
export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  showRangeLabel = true,
}: PaginationControlsProps) {
  const safeTotalPages = Math.max(1, totalPages);
  if (safeTotalPages <= 1 && totalPages > 0) {
    // Single page: still render the "Showing X–Y of Z entries" label and
    // inert prev/next so the layout is consistent across admin pages.
    return (
      <div className="mt-4 flex items-center justify-between px-4 py-3 border-t border-slate-200">
        {showRangeLabel ? (
          <div className="text-sm text-slate-500">
            Showing 1–{Math.min(totalItems, pageSize)} of {totalItems} entries
          </div>
        ) : (
          <div aria-hidden />
        )}
        <div className="flex items-center gap-1">
          <span className="rounded border border-slate-300 text-slate-700 px-3 py-1 text-sm opacity-40">Previous</span>
          <span className="rounded bg-navy-850 text-white px-3 py-1 text-sm">1</span>
          <span className="rounded border border-slate-300 text-slate-700 px-3 py-1 text-sm opacity-40">Next</span>
        </div>
      </div>
    );
  }

  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  // Build the list of page numbers to show
  const pages: (number | 'ellipsis')[] = [];

  if (totalPages <= 7) {
    // Few enough pages — show them all
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    // Always show first page
    pages.push(1);

    if (currentPage > 3) {
      pages.push('ellipsis');
    }

    // Show current page and up to 1 neighbor on each side
    const lo = Math.max(2, currentPage - 1);
    const hi = Math.min(totalPages - 1, currentPage + 1);
    for (let i = lo; i <= hi; i++) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) {
      pages.push('ellipsis');
    }

    // Always show last page
    pages.push(totalPages);
  }

  return (
    <div className="mt-4 flex items-center justify-between px-4 py-3 border-t border-slate-200">
      {showRangeLabel ? (
        <div className="text-sm text-slate-500">
          Showing {start}–{end} of {totalItems} entries
        </div>
      ) : (
        <div aria-hidden />
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          className={`rounded border border-slate-300 text-slate-700 px-3 py-1 text-sm hover:bg-slate-100 ${
            currentPage <= 1 ? 'opacity-40 pointer-events-none' : ''
          }`}
          aria-label="Previous page"
        >
          Previous
        </button>

        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e-${idx}`} className="px-2 py-1 text-sm text-slate-400 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`rounded px-3 py-1 text-sm ${
                p === currentPage
                  ? 'bg-navy-850 text-white'
                  : 'border border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(currentPage + 1)}
          className={`rounded border border-slate-300 text-slate-700 px-3 py-1 text-sm hover:bg-slate-100 ${
            currentPage >= totalPages ? 'opacity-40 pointer-events-none' : ''
          }`}
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

'use client';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * Shared pagination control with smart ellipsis truncation.
 * Shows: 1 … 4 5 [6] 7 8 … N   (when on page 6 of 20)
 * - "Showing X–Y of Z entries" on the left
 * - Previous / numbered pages / Next on the right
 * - Current page highlighted in dark navy (#1B2A4A)
 * - Stays within its container bounds
 */
export function Pagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }: PaginationProps) {
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
    <div className="mt-4 flex items-center justify-between px-4 py-3 border-t border-gray-200">
      <div className="text-sm text-gray-500">
        Showing {start}–{end} of {totalItems} entries
      </div>
      <div className="flex items-center gap-1">
        {/* Previous */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          className={`rounded border border-gray-300 text-gray-700 px-3 py-1 text-sm hover:bg-gray-100 ${
            currentPage <= 1 ? 'opacity-40 pointer-events-none' : ''
          }`}
          aria-label="Previous page"
        >
          Previous
        </button>

        {/* Page numbers */}
        {pages.map((p, idx) =>
          p === 'ellipsis' ? (
            <span key={`e-${idx}`} className="px-2 py-1 text-sm text-gray-400 select-none">
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`rounded px-3 py-1 text-sm ${
                p === currentPage
                  ? 'bg-[#1B2A4A] text-white'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {p}
            </button>
          )
        )}

        {/* Next */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          className={`rounded border border-gray-300 text-gray-700 px-3 py-1 text-sm hover:bg-gray-100 ${
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

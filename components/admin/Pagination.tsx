'use client';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

/**
 * Shared pagination control matching the screenshot style.
 * - "Showing X–Y of Z entries" on the left
 * - Previous / numbered pages / Next on the right
 * - Current page highlighted in dark navy (#1B2A4A)
 * - Stays within its container bounds
 */
export function Pagination({ currentPage, totalPages, totalItems, pageSize, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 max-w-full overflow-x-auto">
      <p className="text-sm text-gray-500 whitespace-nowrap flex-shrink-0">
        Showing {start}–{end} of {totalItems} entries
      </p>
      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Previous */}
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-white hover:bg-gray-100 text-gray-700 transition-colors"
          aria-label="Previous page"
        >
          Previous
        </button>

        {/* Page numbers */}
        {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
          <button
            key={page}
            onClick={() => onPageChange(page)}
            className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
              page === currentPage
                ? 'bg-[#1B2A4A] text-white'
                : 'border border-gray-300 bg-white hover:bg-gray-100 text-gray-700'
            }`}
          >
            {page}
          </button>
        ))}

        {/* Next */}
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed bg-white hover:bg-gray-100 text-gray-700 transition-colors"
          aria-label="Next page"
        >
          Next
        </button>
      </div>
    </div>
  );
}

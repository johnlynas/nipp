'use client';

import { useState } from 'react';
import { Pagination } from './Pagination';

interface AuditEntry {
  id: string;
  timestamp: string | Date;
  userId?: string | null;
  userName?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  organizationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  metadata?: Record<string, unknown> | null;
}

interface AuditLogViewerProps {
  entries: AuditEntry[];
  isLoading?: boolean;
}

const ROWS_PER_PAGE = 8;

/**
 * Filterable audit log table with pagination.
 */
export function AuditLogViewer({ entries, isLoading }: AuditLogViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);

  const formatDate = (date: string | Date) => {
    return new Date(date).toLocaleString('en-GB');
  };

  const totalPages = Math.max(1, Math.ceil(entries.length / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);

  const startIndex = (safePage - 1) * ROWS_PER_PAGE;
  const paginatedEntries = entries.slice(startIndex, startIndex + ROWS_PER_PAGE);

  function goToPage(page: number) {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }

  if (isLoading) {
    return <div className="py-8 text-center">Loading audit logs...</div>;
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200" role="table">
          <thead className="bg-[#1B2A4A]">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                Timestamp
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                User
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                Action
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                Resource
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-white" scope="col">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {paginatedEntries.map((entry) => (
              <tr key={entry.id}>
                <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                  {formatDate(entry.timestamp)}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-sm" style={{ color: '#1B2A4A' }}>
                  {entry.userName || entry.userId || '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-sm font-mono text-gray-600">
                  {entry.action}
                </td>
                <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-500">
                  {entry.resourceType}
                </td>
                <td className="whitespace-nowrap px-4 py-2">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      entry.success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {entry.success ? 'Success' : 'Failed'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        currentPage={safePage}
        totalPages={totalPages}
        totalItems={entries.length}
        pageSize={ROWS_PER_PAGE}
        onPageChange={goToPage}
      />
    </div>
  );
}

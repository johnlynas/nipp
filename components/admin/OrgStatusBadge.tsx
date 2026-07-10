'use client';

interface OrgStatusBadgeProps {
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

/**
 * Color-coded status badge for organizations.
 */
export function OrgStatusBadge({ status }: OrgStatusBadgeProps) {
  const styles: Record<string, string> = {
    ACTIVE: 'bg-green-500 text-white',
    PENDING: 'bg-amber-500 text-white',
    SUSPENDED: 'bg-red-500 text-white',
    ARCHIVED: 'bg-gray-400 text-white',
  };

  const labels: Record<string, string> = {
    ACTIVE: 'Active',
    PENDING: 'Pending',
    SUSPENDED: 'Suspended',
    ARCHIVED: 'Archived',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status]}`} role="status" aria-label={`Status: ${labels[status]}`}>
      {labels[status]}
    </span>
  );
}

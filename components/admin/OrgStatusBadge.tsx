'use client';

interface OrgStatusBadgeProps {
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';
}

/**
 * Color-coded status badge for organizations.
 */
export function OrgStatusBadge({ status }: OrgStatusBadgeProps) {
  const styles: Record<string, string> = {
    ACTIVE: 'text-success bg-success-tint border border-success-border',
    PENDING: 'text-warning-ink bg-warning-tint border border-warning-border',
    SUSPENDED: 'text-danger-ink bg-danger-tint border border-danger-border',
    ARCHIVED: 'text-slate-600 bg-slate-100 border border-slate-200',
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

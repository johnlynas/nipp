'use client';

interface StatusBadgeProps {
  status: string;
}

const statusStyles: Record<string, { bg: string; text: string }> = {
  ACTIVE: { bg: '#f0fdf4', text: '#166534' },
  Verified: { bg: '#f0fdf4', text: '#166534' },
  'Email Verified': { bg: '#f0fdf4', text: '#166534' },
  PENDING: { bg: '#fffbeb', text: '#92400e' },
  SUSPENDED: { bg: '#fef2f2', text: '#991b1b' },
  Banned: { bg: '#fef2f2', text: '#991b1b' },
  ARCHIVED: { bg: '#f8f9fa', text: '#6c757d' },
  INACTIVE: { bg: '#f8f9fa', text: '#6c757d' },
  Default: { bg: '#f8f9fa', text: '#6c757d' },
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const style = statusStyles[status] || statusStyles.Default;

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: style.bg, color: style.text }}
    >
      {status}
    </span>
  );
}

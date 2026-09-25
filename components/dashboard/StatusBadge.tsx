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
  ARCHIVED: { bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-500)' },
  INACTIVE: { bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-500)' },
  Default: { bg: 'var(--color-canvas-subtle)', text: 'var(--color-slate-500)' },
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

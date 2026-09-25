'use client';

import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: ReactNode;
  color?: 'default' | 'success' | 'danger' | 'warning';
  className?: string;
}

const colorMap = {
  default: { bg: 'var(--color-canvas)', border: 'var(--color-slate-200)', text: 'var(--color-slate-900)' },
  success: { bg: 'var(--color-success-tint)', border: 'var(--color-success-border)', text: 'var(--color-success)' },
  danger: { bg: 'var(--color-danger-tint)', border: 'var(--color-danger-border)', text: 'var(--color-danger-ink)' },
  warning: { bg: 'var(--color-warning-tint)', border: 'var(--color-warning-border)', text: 'var(--color-warning-ink)' },
};

export function StatCard({ label, value, icon, color = 'default', className }: StatCardProps) {
  const c = colorMap[color];

  return (
    <div
      className={`flex flex-col rounded-lg border p-4 ${className ?? ''}`}
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <div className="mb-1 flex items-center gap-2">
        {icon && <span style={{ color: c.text }}>{icon}</span>}
        <span className="text-sm font-medium" style={{ color: 'var(--color-slate-500)' }}>{label}</span>
      </div>
      <span className="text-2xl font-semibold tracking-tight tabular" style={{ color: c.text }}>{value}</span>
    </div>
  );
}

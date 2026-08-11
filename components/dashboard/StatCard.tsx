'use client';

import { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon?: ReactNode;
  color?: 'default' | 'success' | 'danger' | 'warning';
}

const colorMap = {
  default: { bg: '#ffffff', border: '#dee2e6', text: '#1B2A4A' },
  success: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
  danger: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
  warning: { bg: '#fffbeb', border: '#fde68a', text: '#92400e' },
};

export function StatCard({ label, value, icon, color = 'default' }: StatCardProps) {
  const c = colorMap[color];

  return (
    <div
      className="flex flex-col rounded-lg border p-4 transition-shadow hover:shadow-md"
      style={{ backgroundColor: c.bg, borderColor: c.border }}
    >
      <div className="mb-1 flex items-center gap-2">
        {icon && <span style={{ color: c.text }}>{icon}</span>}
        <span className="text-sm font-medium" style={{ color: c.text }}>{label}</span>
      </div>
      <span className="text-2xl font-bold" style={{ color: c.text }}>{value}</span>
    </div>
  );
}

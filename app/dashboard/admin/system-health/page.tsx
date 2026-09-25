'use client';

import { PageHeader } from '@/components/dashboard/PageHeader';
import SystemHealthCard from '@/components/admin/SystemHealthCard';

export default function SystemHealthPage() {
  return (
    <div>
      <PageHeader title="" description="Monitor system status and dependencies" />

      {/* Health Card Container */}
      <div className="bg-white rounded-lg shadow-sm border p-6" style={{ borderColor: 'var(--color-slate-200)' }}>
        <SystemHealthCard />
      </div>
    </div>
  );
}

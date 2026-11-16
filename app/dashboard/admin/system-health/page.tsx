'use client';

import { PageHeader } from '@/components/dashboard/PageHeader';
import SystemHealthCard from '@/components/admin/SystemHealthCard';

export default function SystemHealthPage() {
  return (
    <div>
      <PageHeader title="System Health" description="Live status of the portal and its monitored dependencies" />
      <SystemHealthCard />
    </div>
  );
}

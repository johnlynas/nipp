'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageSkeleton } from '@/components/dashboard/PageSkeleton';

export default function AdminDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/dashboard/admin/users');
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center" style={{ color: 'var(--color-slate-500)' }}>
      <PageSkeleton rows={5} cols={4} />
    </div>
  );
}

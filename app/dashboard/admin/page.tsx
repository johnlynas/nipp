'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminDashboardPage() {
  const router = useRouter();

  useEffect(() => {
    router.push('/dashboard/admin/users');
  }, [router]);

  return (
    <div className="flex h-64 items-center justify-center" style={{ color: '#6c757d' }}>
      Loading...
    </div>
  );
}

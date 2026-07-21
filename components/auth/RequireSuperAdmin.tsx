'use client';

import { useIsSuperAdmin } from '@/hooks/usePermission';
import { ReactNode } from 'react';
import { AccessDenied } from '@/components/admin/AccessDenied';

interface RequireSuperAdminProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function RequireSuperAdmin({ children, fallback }: RequireSuperAdminProps) {
  const isSuperAdmin = useIsSuperAdmin();

  // Show loading state while checking permissions
  if (isSuperAdmin === null || isSuperAdmin === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#1B2A4A]"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isSuperAdmin) {
    return <>{fallback ?? <AccessDenied />}</>;
  }

  return <>{children}</>;
}
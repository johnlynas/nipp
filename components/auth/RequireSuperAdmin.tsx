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

  // If we can't determine super admin status, show a blank screen
  // (the loading state causes UI flash on navigation)
  if (isSuperAdmin === null || isSuperAdmin === undefined) {
    return null;
  }

  if (!isSuperAdmin) {
    return <>{fallback ?? <AccessDenied />}</>;
  }

  return <>{children}</>;
}
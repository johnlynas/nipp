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

  // Optimistic rendering: If we can't determine super admin status yet (loading),
  // render content immediately to prevent UI flash. The check happens in background.
  if (isSuperAdmin === null || isSuperAdmin === undefined) {
    return <>{children}</>;
  }

  if (!isSuperAdmin) {
    return <>{fallback ?? <AccessDenied />}</>;
  }

  return <>{children}</>;
}
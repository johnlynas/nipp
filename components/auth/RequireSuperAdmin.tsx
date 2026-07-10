'use client';

import { useIsSuperAdmin } from '@/hooks/usePermission';
import { ReactNode } from 'react';
import { AccessDenied } from '@/components/admin/AccessDenied';

interface RequireSuperAdminProps {
  children: ReactNode;
  fallback?: ReactNode;
}

/**
 * Wrapper that checks useIsSuperAdmin().
 * Renders children if the user is a Super Admin, otherwise renders AccessDenied.
 */
export function RequireSuperAdmin({ children, fallback }: RequireSuperAdminProps) {
  const isSuperAdmin = useIsSuperAdmin();

  if (!isSuperAdmin) {
    return <>{fallback ?? <AccessDenied />}</>;
  }

  return <>{children}</>;
}

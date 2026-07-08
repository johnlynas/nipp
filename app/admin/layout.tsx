/**
 * Admin dashboard layout — scaffolding with role-based navigation.
 *
 * Uses usePermission to conditionally render sidebar menu items
 * based on the user's resolved permissions.
 */

'use client';

import { useHasPermission, useIsSuperAdmin } from '@/hooks/usePermission';
import { RequirePermission } from '@/components/auth/require-permission';

interface NavItem {
  label: string;
  href: string;
  permission?: string;
  anyOf?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', href: '/admin' },
  {
    label: 'Users & Members',
    href: '/admin/members',
    anyOf: ['members:view', 'members:manage'],
  },
  {
    label: 'Roles & Permissions',
    href: '/admin/roles',
    anyOf: ['roles:view', 'roles:manage'],
  },
  {
    label: 'Properties',
    href: '/admin/properties',
    anyOf: ['properties:view', 'properties:manage'],
  },
  {
    label: 'Tenants',
    href: '/admin/tenants',
    anyOf: ['tenants:view', 'tenants:manage'],
  },
  {
    label: 'Financials',
    href: '/admin/financials',
    anyOf: ['financials:view', 'financials:manage'],
  },
  {
    label: 'Maintenance',
    href: '/admin/maintenance',
    anyOf: ['maintenance:view', 'maintenance:manage'],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const isSuperAdmin = useIsSuperAdmin();

  // Super Admins see all menu items; others see only permitted ones
  const visibleItems = isSuperAdmin
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => {
        if (item.permission) return useHasPermission(item.permission);
        if (item.anyOf) return true; // Handled by RequirePermission below
        return true;
      });

  return (
    <div className="flex min-h-screen">
      {/* Sidebar Navigation */}
      <aside className="w-64 border-r bg-slate-900 p-4">
        <h2 className="mb-4 text-lg font-semibold text-amber-400">Admin Panel</h2>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <RequirePermission
              key={item.href}
              permission={item.permission}
              anyOf={item.anyOf}
            >
              <a
                href={item.href}
                className="block rounded px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </a>
            </RequirePermission>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

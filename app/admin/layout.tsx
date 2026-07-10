/**
 * Admin dashboard layout — scaffolding with role-based navigation.
 *
 * All /admin/* routes are strictly gated by <RequireSuperAdmin>.
 */

'use client';

import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useIsSuperAdmin } from '@/hooks/usePermission';

interface NavItem {
  label: string;
  href: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Organizations', href: '/admin/organizations' },
  { label: 'Permissions', href: '/admin/permissions' },
  { label: 'Audit Logs', href: '/admin/audit-logs' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const isSuperAdmin = useIsSuperAdmin();

  if (!isSuperAdmin) {
    return null; // RequireSuperAdmin wrapper handles the fallback
  }

  return (
    <RequireSuperAdmin>
      <div className="flex min-h-screen">
        {/* Sidebar Navigation */}
        <aside className="w-64 border-r p-4" style={{ backgroundColor: '#1B2A4A' }}>
          <h2 className="mb-4 text-lg font-semibold" style={{ color: '#F5A623' }}>Admin Panel</h2>
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="block rounded px-3 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </RequireSuperAdmin>
  );
}

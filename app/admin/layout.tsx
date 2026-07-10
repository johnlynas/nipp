'use client';

import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/sign-out', { method: 'POST' });
    } catch (error) {
      console.error('Logout failed:', error);
    }
    window.location.href = '/login';
  };

  const navLinks = [
    { href: '/admin/organizations', label: 'Organizations' },
    { href: '/admin/permissions', label: 'Permissions' },
    { href: '/admin/audit-logs', label: 'Audit Logs' },
  ];

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen bg-gray-50 flex">
        {/* Sidebar - Property NI Navy */}
        <aside className="w-64 bg-[#1B2A4A] text-white flex-shrink-0">
          <div className="p-6">
            <h2 className="text-2xl font-bold text-[#F5A623]">Admin Panel</h2>
          </div>
          <nav className="mt-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`block px-6 py-3 text-sm font-medium transition-colors ${
                  pathname === link.href
                    ? 'bg-[#24355c] text-[#F5A623] border-r-4 border-[#F5A623]'
                    : 'text-gray-300 hover:bg-[#24355c] hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col">
          {/* Top Header - Property NI Navy */}
          <header className="bg-[#1B2A4A] text-white px-8 py-4 flex justify-between items-center shadow-md">
            <h1 className="text-xl font-semibold">Property NI Admin</h1>
            
            {/* Logout Button - Property NI Amber */}
            <button
              onClick={handleLogout}
              className="bg-[#F5A623] hover:bg-[#e0951f] text-white px-4 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2 focus:ring-offset-[#1B2A4A]"
            >
              Logout
            </button>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-8 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </RequireSuperAdmin>
  );
}
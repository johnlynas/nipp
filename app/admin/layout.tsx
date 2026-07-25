'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authClient } from '@/lib/auth-client';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error('Logout failed:', error);
    }
    
    document.cookie = 'better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = '__Secure-better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = 'better-auth-session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = '__Secure-better-auth-session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';

    window.location.href = '/login';
  };

  const navLinks = [
    { href: '/admin/organizations', label: 'Organizations' },
    { href: '/admin/permissions', label: 'Permissions' },
    { href: '/admin/audit-logs', label: 'Security Audit Logs' },
    { href: '/admin/system-health', label: 'System Health' },
    { href: '/admin/system-logs', label: 'System Logs' },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-[#1B2A4A] text-white flex-shrink-0 overflow-hidden">
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
        {/* Top Header */}
        <header className="bg-[#1B2A4A] text-white px-8 py-4 flex justify-between items-center shadow-md">
          <div />
          
          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="bg-[#F5A623] hover:bg-[#e0951f] text-white px-4 py-2 rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[#F5A623] focus:ring-offset-2 focus:ring-offset-[#1B2A4A]"
          >
            Logout
          </button>
        </header>

        {/* Page Content - Wrapped in RequireSuperAdmin to prevent flash */}
        <main className="flex-1 p-8 overflow-y-auto">
          <RequireSuperAdmin>{children}</RequireSuperAdmin>
        </main>
      </div>
    </div>
  );
}

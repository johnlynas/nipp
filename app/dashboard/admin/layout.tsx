'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, UserRound, Building2, UsersRound, Shield, Key, LogOut } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';

const navItems = [
  { href: '/dashboard/admin/users', label: 'Users', icon: UserRound },
  { href: '/dashboard/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/dashboard/admin/teams', label: 'Teams', icon: UsersRound },
  { href: '/dashboard/admin/roles', label: 'Roles', icon: Shield },
  { href: '/dashboard/admin/permissions', label: 'Permissions', icon: Key },
];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
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

  const handleNavClick = () => {
    if (window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  return (
    <RequireSuperAdmin>
      <div className="min-h-screen bg-[#f8f9fa] flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 bg-[#1B2A4A] text-white flex flex-col transition-all duration-200 overflow-hidden ${
            sidebarOpen ? 'w-64' : 'w-16'
          }`}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: '#24355c' }}>
            {sidebarOpen && <div className="flex-1" />}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded p-1.5 text-gray-300 hover:text-white hover:bg-[#24355c] transition-colors"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? <X className="h-[30px] w-[30px]" /> : <Menu className="h-[30px] w-[30px]" />}
            </button>
          </div>

          {/* Navigation */}
          <nav className="flex-1 mt-4 overflow-y-auto">
            {navItems.map((item) => {
              const isActive = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  title={item.label}
                  className={`flex items-center gap-3 mx-2 my-1.5 rounded transition-colors ${
                    isActive
                      ? 'bg-[#24355c] text-[#F5A623]'
                      : 'text-gray-300 hover:bg-[#24355c] hover:text-white'
                  }`}
                  style={isActive ? { borderLeft: '3px solid #F5A623' } : {}}
                >
                  <Icon className="h-[30px] w-[30px] shrink-0 mx-3" />
                  {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="border-t p-4" style={{ borderColor: '#24355c' }}>
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 rounded px-2 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#24355c] transition-colors w-full ${
                !sidebarOpen ? 'justify-center' : ''
              }`}
              aria-label="Logout"
            >
              <LogOut className="h-[30px] w-[30px] shrink-0 mx-3" />
              {sidebarOpen && <span>Logout</span>}
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Bar */}
          <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm" style={{ borderColor: '#dee2e6' }}>
            <h1 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
              {navItems.find((item) => item.href === pathname)?.label || 'Dashboard'}
            </h1>
          </header>

          {/* Page Content */}
          <main className="flex-1 p-6 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </RequireSuperAdmin>
  );
}

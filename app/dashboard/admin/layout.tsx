'use client';

import { useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, UserRound, Building2, UsersRound, Shield, Key, Layers, LogOut, CalendarDays, Bell, XCircle, HeartPulse, ChartNoAxesCombined, Network } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useNotifications, PRIORITY_COLORS, getPriorityIcon } from '@/hooks/useNotifications';

const navItems = [
  { href: '/dashboard/admin/users', label: 'Users', icon: UserRound },
  { href: '/dashboard/admin/organizations', label: 'Organizations', icon: Building2 },
  { href: '/dashboard/admin/teams', label: 'Teams', icon: UsersRound },
  { href: '/dashboard/admin/roles', label: 'Roles', icon: Shield },
  { href: '/dashboard/admin/permissions', label: 'Permissions', icon: Key },
  { href: '/dashboard/admin/resources', label: 'Resources', icon: Layers },
  { href: '/dashboard/admin/notifications', label: 'Notifications', icon: Bell },
  { href: '/dashboard/admin/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/dashboard/admin/org-chart', label: 'Org Chart', icon: Network },
  { href: '/dashboard/admin/system-health', label: 'System Health', icon: HeartPulse },
  { href: '/dashboard/admin/cache-metrics', label: 'Cache Metrics', icon: ChartNoAxesCombined },
];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const isCalendarPage = useMemo(() => pathname === '/dashboard/admin/calendar', [pathname]);
  // Org chart is full-bleed like the calendar (no top header, no content padding).
  const isFullScreenPage = isCalendarPage || pathname === '/dashboard/admin/org-chart';
  const { notifications, isConnected, dismissNotification, clearNotifications } = useNotifications();

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
      <div className="h-screen bg-[#f8f9fa] flex overflow-hidden">
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
          {!isFullScreenPage && (
            <header className="bg-white border-b px-6 py-3 flex items-center justify-between shadow-sm" style={{ borderColor: '#dee2e6' }}>
              <h1 className="text-lg font-semibold" style={{ color: '#1B2A4A' }}>
                {navItems.find((item) => item.href === pathname)?.label || 'Dashboard'}
              </h1>
            </header>
          )}

          {/* Page Content */}
          <main className={`flex-1 min-h-0 min-w-0 ${isFullScreenPage ? 'flex flex-col overflow-hidden' : 'p-6 overflow-y-auto'}`}>
            {children}
          </main>

          {/* Footer Notification Ticker — always visible so connection status is apparent */}
          <footer className="bg-[#1B2A4A] border-t px-6 py-3 overflow-x-auto whitespace-nowrap" style={{ borderColor: '#24355c' }}>
              <div className="flex items-center gap-4">
                {/* Connection status indicator */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
                  <span className="text-xs text-gray-400">{isConnected ? 'Live' : 'Reconnecting...'}</span>
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-gray-600" />

                {/* Notification items — ticker style like stock quotes */}
                {notifications.length > 0 ? (
                  <div className="flex items-center gap-6 overflow-x-auto flex-1">
                    {notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={`flex items-center gap-2 px-3 py-1 rounded text-sm border ${PRIORITY_COLORS[notif.priority] || PRIORITY_COLORS.INFO}`}
                      >
                        <span className="text-xs">{getPriorityIcon(notif.priority)}</span>
                        <span className="font-medium truncate max-w-[200px]">{notif.title}</span>
                        <button
                          onClick={() => dismissNotification(notif.id)}
                          className="ml-1 text-current opacity-50 hover:opacity-100"
                          aria-label="Dismiss notification"
                        >
                          <XCircle className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-gray-500 italic">No active notifications</span>
                )}

                {/* Clear all */}
                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    className="text-xs text-gray-400 hover:text-white flex-shrink-0"
                    aria-label="Clear all notifications"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </footer>
        </div>
      </div>
    </RequireSuperAdmin>
  );
}

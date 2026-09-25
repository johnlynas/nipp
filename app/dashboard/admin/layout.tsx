'use client';

import { useState, useMemo } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Menu, X, UserRound, Building2, UsersRound, Shield, Key, Layers, LogOut, CalendarDays, Bell, XCircle, HeartPulse, ChartNoAxesCombined, ScrollText, Network, FileSearch, TerminalSquare } from 'lucide-react';
import { authClient } from '@/lib/auth-client';
import { RequireSuperAdmin } from '@/components/auth/RequireSuperAdmin';
import { useNotifications, PRIORITY_COLORS, getPriorityIcon } from '@/hooks/useNotifications';
import { TopBarNotificationBell } from '@/components/dashboard/TopBarNotificationBell';
import { TopBarUserIdentityChip } from '@/components/dashboard/TopBarUserIdentityChip';

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: 'People',
    items: [
      { href: '/dashboard/admin/users', label: 'Users', icon: UserRound },
      { href: '/dashboard/admin/organizations', label: 'Organizations', icon: Building2 },
      { href: '/dashboard/admin/teams', label: 'Teams', icon: UsersRound },
    ],
  },
  {
    label: 'Platform',
    items: [
      { href: '/dashboard/admin/roles', label: 'Roles', icon: Shield },
      { href: '/dashboard/admin/permissions', label: 'Permissions', icon: Key },
      { href: '/dashboard/admin/resources', label: 'Resources', icon: Layers },
      { href: '/dashboard/admin/notifications', label: 'Notifications', icon: Bell },
      { href: '/dashboard/admin/calendar', label: 'Calendar', icon: CalendarDays },
      { href: '/dashboard/admin/org-chart', label: 'Org Chart', icon: Network },
    ],
  },
  {
    label: 'Ops',
    items: [
      { href: '/dashboard/admin/system-health', label: 'System Health', icon: HeartPulse },
      { href: '/dashboard/admin/cache-metrics', label: 'Cache Metrics', icon: ChartNoAxesCombined },
      { href: '/dashboard/admin/custom-scripts', label: 'Custom Scripts', icon: ScrollText },
      { href: '/dashboard/admin/audit-logs', label: 'Audit Logs', icon: FileSearch },
      { href: '/dashboard/admin/system-logs', label: 'System Logs', icon: TerminalSquare },
    ],
  },
];

const navItems = navGroups.flatMap((g) => g.items);

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  // Below 768px ship in icon-rail mode by default; user can expand per-session
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const router = useRouter();
  const pathname = usePathname();
  const isCalendarPage = useMemo(() => pathname === '/dashboard/admin/calendar', [pathname]);
  // Full-bleed pages (no content padding) so their canvases + slide-in panels
  // anchor edge-to-edge between the top bar and the footer rail.
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
      <div className="h-screen bg-canvas-subtle flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={`flex-shrink-0 bg-navy-850 text-white flex flex-col transition-all duration-200 overflow-hidden ${
            sidebarOpen ? 'w-64' : 'w-16'
          }`}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: 'var(--color-navy-800)' }}>
            {sidebarOpen && <div className="flex-1" />}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="rounded p-1.5 text-slate-300 hover:text-white hover:bg-navy-800 transition-colors"
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? <X className="h-[30px] w-[30px]" /> : <Menu className="h-[30px] w-[30px]" />}
            </button>
          </div>

          {/* Navigation — grouped */}
          <nav className="flex-1 mt-4 overflow-y-auto scroll-dark">
            {navGroups.map((group, gi) => (
              <div key={group.label} className={gi > 0 ? 'mt-3 border-t pt-2' : ''} style={{ borderColor: 'var(--color-navy-800)' }}>
                {sidebarOpen && (
                  <p className="px-5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                    {group.label}
                  </p>
                )}
                {group.items.map((item) => {
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
                          ? 'bg-navy-700/40 text-white'
                          : 'text-slate-400 hover:bg-navy-800/60 hover:text-white'
                      }`}
                    >
                      <Icon className="h-[30px] w-[30px] shrink-0 mx-3" />
                      {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Sidebar Footer */}
          <div className="border-t p-4" style={{ borderColor: 'var(--color-navy-800)' }}>
            <button
              onClick={handleLogout}
              className={`flex items-center gap-3 rounded px-2 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-navy-800 transition-colors w-full ${
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
          {/* Top Bar — page title left; identity chip + notification bell right on every page */}
          <header className="bg-white border-b px-6 py-2.5 flex items-center justify-between gap-4 shadow-sm" style={{ borderColor: 'var(--color-slate-200)' }}>
            <p className="min-w-0 truncate text-xs font-medium uppercase tracking-widest text-slate-500">
              {navItems.find((item) => item.href === pathname)?.label || 'Dashboard'}
            </p>
            <div className="flex items-center gap-1 pl-4" style={{ borderLeft: '1px solid var(--color-slate-200)' }}>
              <TopBarUserIdentityChip />
              <TopBarNotificationBell />
            </div>
          </header>

          {/* Page Content */}
          <main className={`flex-1 min-h-0 min-w-0 ${isFullScreenPage ? 'flex flex-col overflow-hidden' : 'p-6 pb-24 sm:pb-6 overflow-y-auto'}`}>
            {children}
          </main>

          {/* Footer Notification Ticker — always visible so connection status is apparent */}
          <footer className="bg-navy-850 border-t px-6 py-3 overflow-x-auto whitespace-nowrap" style={{ borderColor: 'var(--color-navy-800)' }}>
              <div className="flex items-center gap-4">
                {/* Connection status indicator */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400 animate-pulse'}`} />
                  <span className="text-xs text-slate-400">{isConnected ? 'Live' : 'Reconnecting...'}</span>
                </div>

                {/* Divider */}
                <div className="w-px h-4 bg-slate-600" />

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
                  <span className="text-xs text-slate-400 italic">No active notifications</span>
                )}

                {/* Clear all */}
                {notifications.length > 0 && (
                  <button
                    onClick={clearNotifications}
                    className="text-xs text-slate-400 hover:text-white flex-shrink-0"
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

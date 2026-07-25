'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { authClient } from '@/lib/auth-client';

export default function AdminContent({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      // 1. Officially revoke session and clear cookie via BetterAuth client
      await authClient.signOut();
    } catch (error) {
      console.error('Logout failed:', error);
    }
    
    // 2. Manual fallback: Explicitly clear the cookies in the browser 
    // in case the server response was somehow blocked
    document.cookie = 'better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = '__Secure-better-auth.session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = 'better-auth-session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    document.cookie = '__Secure-better-auth-session_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';

    // 3. Hard redirect to bust all React/SWR/Next.js caches
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
    <>
      {/* Top Header - Property NI Navy */}
      <header className="bg-[#1B2A4A] text-white px-8 py-4 flex justify-between items-center shadow-md">
        <div />
        
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
    </>
  );
}

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOutUser } from '@/lib/auth-client';
import { useIsSuperAdmin } from '@/hooks/usePermission';

export default function Home() {
  const router = useRouter();
  const isSuperAdmin = useIsSuperAdmin();

  useEffect(() => {
    if (isSuperAdmin) {
      router.replace('/admin/organizations');
    }
  }, [isSuperAdmin, router]);

  if (isSuperAdmin) {
    return null; // Redirecting to /admin/organizations
  }

  return (
    <main className="min-h-screen bg-[#f8f9fa] p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-[#1e3a5f] mb-4">
          Property NI Multi-Tenant Portal
        </h1>
        <p className="text-[#6c757d] mb-8">
          Welcome — your session is active.
        </p>

        <LogoutButton />
      </div>
    </main>
  );
}

function LogoutButton() {
  async function handleLogout() {
    const result = await signOutUser();

    if (result.error) {
      console.error('Logout failed:', result.error);
      return;
    }

    // Force full page reload to login (bypasses Next.js routing + ensures cookies are respected)
    window.location.replace('/login?t=' + Date.now());
  }

  return (
    <button
      onClick={handleLogout}
      className="px-6 py-3 rounded-pill font-semibold text-white transition cursor-pointer"
      style={{ background: '#1e3a5f' }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#152940';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = '#1e3a5f';
      }}
    >
      Logout
    </button>
  );
}

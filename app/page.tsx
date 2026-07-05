'use client';

/**
 * Home page — Property NI Multi-Tenant Portal.
 *
 * Displays a welcome message and a logout button for authenticated users.
 */

import { signOutUser } from '@/lib/auth-client';

export default function Home() {
  async function handleLogout() {
    await signOutUser();
    // Redirect to login after session is destroyed
    window.location.href = '/login';
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

        <button
          onClick={handleLogout}
          className="px-6 py-3 rounded-pill font-semibold text-white transition cursor-pointer"
          style={{
            background: '#1e3a5f',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#152940';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = '#1e3a5f';
          }}
        >
          Logout
        </button>
      </div>
    </main>
  );
}

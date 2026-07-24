'use client';

import { signOutUser } from '@/lib/auth-client';

export function LogoutButton() {
  async function handleLogout() {
    const result = await signOutUser();

    if (result.error) {
      console.error('Logout failed:', result.error);
      return;
    }

    // Force full page reload to login (bypasses Next.js routing + ensures cookies are cleared)
    window.location.replace('/login?t=' + Date.now());
  }

  return (
    <button
      onClick={handleLogout}
      className="mt-6 px-6 py-3 rounded-md font-semibold text-white transition-colors cursor-pointer bg-[#1B2A4A] hover:bg-[#152940]"
    >
      Logout
    </button>
  );
}

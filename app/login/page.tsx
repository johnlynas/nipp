'use client';

/**
 * Login page — Property NI Multi-Tenant Portal.
 *
 * Split-screen layout:
 *   Left  — Branding panel (Navy background, logo/heading)
 *   Right — Login form (Amber accent button, rounded inputs)
 */

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInEmail } from '@/lib/auth-client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signInEmail(email, password);
      if (result.error) {
        setError(result.error);
      } else {
        // Redirect to callback URL or home page
        const callbackUrl = searchParams.get('callbackUrl') || '/';
        router.push(callbackUrl);
      }
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel: Branding (Navy) ─────────────────────────── */}
      <div className="hidden lg:flex lg:w-1/2 bg-[#1e3a5f] items-center justify-center p-12 flex-col">
        <h1 className="text-[36px] font-bold text-white mb-4">
          Property NI
        </h1>
        <p className="text-[20px] text-white/70 leading-relaxed">
          Multi-Tenant Property Management Portal
        </p>
      </div>

      {/* ── Right panel: Login form ─────────────────────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-[#f8f9fa]">
        <div className="w-full max-w-[320px]">
          {/* Mobile-only heading */}
          <h1 className="text-2xl font-bold text-[#1e3a5f] mb-8 lg:hidden">
            Property NI — Login
          </h1>

          {/* Error message */}
          {error && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-[26px] text-sm font-medium bg-red-500/10 text-red-600 border border-red-500/20"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* User ID (email) input */}
            <div className="mb-5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-[#1e3a5f] mb-2"
              >
                User ID (Email)
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@organisation.gov.uk"
                className="w-full h-12 px-5 rounded-[26px] border border-gray-300 bg-white text-[#1e3a5f] text-base outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/10 box-border"
              />
            </div>

            {/* Password input */}
            <div className="mb-6">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-[#1e3a5f] mb-2"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full h-12 px-5 rounded-[26px] border border-gray-300 bg-white text-[#1e3a5f] text-base outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/10 box-border"
              />
            </div>

            {/* Login button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full h-12 rounded-[26px] bg-[#f4a261] text-white text-base font-semibold border-none cursor-pointer shadow-lg shadow-orange-300/30 ${
                loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-[#e76f51]'
              }`}
            >
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

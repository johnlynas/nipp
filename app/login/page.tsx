'use client';

/**
 * Login page — Property NI Multi-Tenant Portal.
 *
 * Split-screen layout:
 *   Left  — Branding panel (Navy background, logo/heading)
 *   Right — Login form (Amber accent button, rounded inputs)
 */

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInEmail } from '@/lib/auth-client';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signInEmail(email, password);
      if (result.error) {
        const errorMsg = result.error;
        // Detect banned user error
        if (errorMsg.toLowerCase().includes('banned') || errorMsg.toLowerCase().includes('access denied')) {
          setIsBanned(true);
        }
        setError(errorMsg);
      } else {
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
      <div className="hidden lg:flex lg:w-1/2 bg-navy-850 items-center justify-center p-12 flex-col">
        <h1 className="text-[36px] font-bold text-white mb-4">
          Property NI
        </h1>
        <p className="text-[20px] text-white/70 leading-relaxed">
          Multi-Tenant Property Management Portal
        </p>
      </div>

      {/* ── Right panel: Login form ─────────────────────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8 bg-canvas-subtle">
        <div className="w-full max-w-[320px]">
          {/* Mobile-only heading */}
          <h1 className="text-2xl font-bold text-slate-900 mb-8 lg:hidden">
            Property NI — Login
          </h1>

          {/* Error message */}
          <div aria-live="assertive">
            {error && (
              <div
                role="alert"
                className={`mb-6 p-4 rounded-[26px] text-sm font-medium border ${
                  isBanned
                    ? 'bg-danger-tint text-danger-ink border-danger-border'
                    : 'bg-danger-tint text-danger-ink border-danger-border'
                }`}
              >
                {isBanned ? (
                  <div>
                    <p className="font-semibold mb-1">Account banned</p>
                    <p>{error}</p>
                    <p className="mt-2 font-normal">Contact your administrator to restore access.</p>
                  </div>
                ) : (
                  <span>
                    {error === 'Invalid credentials'
                      ? 'The email or password is incorrect. Check both and try again.'
                      : error}
                  </span>
                )}
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            {/* User ID (email) input */}
            <div className="mb-5">
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-900 mb-2"
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
                className="w-full h-12 px-5 rounded-[26px] border border-slate-300 bg-white text-slate-900 text-base outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 box-border"
              />
            </div>

            {/* Password input */}
            <div className="mb-6">
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-900 mb-2"
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
                className="w-full h-12 px-5 rounded-[26px] border border-slate-300 bg-white text-slate-900 text-base outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 box-border"
              />
            </div>

            {/* Login button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full h-12 rounded-[26px] bg-accent text-accent-ink text-base font-semibold border-none cursor-pointer shadow-lg shadow-orange-300/30 ${
                loading ? 'opacity-60 cursor-not-allowed' : 'hover:bg-accent-strong hover:text-white'
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

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
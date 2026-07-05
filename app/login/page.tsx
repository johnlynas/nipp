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

const pillRadius = '26px';

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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    height: '48px',
    paddingLeft: '20px',
    paddingRight: '20px',
    borderRadius: pillRadius,
    border: '1px solid #dee2e6',
    backgroundColor: '#ffffff',
    color: '#1e3a5f',
    fontSize: '16px',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const inputFocusStyle: React.CSSProperties = {
    ...inputStyle,
    borderColor: '#1e3a5f',
    boxShadow: '0 0 0 3px rgba(30, 58, 95, 0.1)',
  };

  const buttonStyle: React.CSSProperties = {
    width: '100%',
    height: '48px',
    borderRadius: pillRadius,
    background: '#f4a261',
    color: '#ffffff',
    fontSize: '16px',
    fontWeight: 600,
    border: 'none',
    cursor: loading ? 'not-allowed' : 'pointer',
    boxShadow: '0 4px 12px rgba(244, 162, 97, 0.3)',
    opacity: loading ? 0.6 : 1,
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex' }}>
      {/* ── Left panel: Branding (Navy) ─────────────────────────── */}
      <div
        className="hidden lg:flex lg:w-1/2 bg-[#1e3a5f] items-center justify-center p-12"
        style={{ flexDirection: 'column' }}
      >
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: '#ffffff', marginBottom: '16px' }}>
          Property NI
        </h1>
        <p style={{ fontSize: '20px', color: 'rgba(255,255,255,0.7)', lineHeight: 1.6 }}>
          Multi-Tenant Property Management Portal
        </p>
      </div>

      {/* ── Right panel: Login form ─────────────────────────────── */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-8" style={{ backgroundColor: '#f8f9fa' }}>
        <div style={{ width: '100%', maxWidth: '320px' }}>
          {/* Mobile-only heading */}
          <h1 className="text-2xl font-bold text-[#1e3a5f] mb-8 lg:hidden">
            Property NI — Login
          </h1>

          {/* Error message */}
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: '24px',
                padding: '16px',
                borderRadius: pillRadius,
                fontSize: '14px',
                fontWeight: 500,
                backgroundColor: 'rgba(220,53,69,0.1)',
                color: '#dc3545',
                border: '1px solid rgba(220,53,69,0.2)',
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* User ID (email) input */}
            <div style={{ marginBottom: '20px' }}>
              <label
                htmlFor="email"
                style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#1e3a5f', marginBottom: '8px' }}
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
                style={inputStyle}
                onFocus={(e) => { Object.assign(e.currentTarget.style, inputFocusStyle); }}
                onBlur={(e) => { Object.assign(e.currentTarget.style, inputStyle); }}
              />
            </div>

            {/* Password input */}
            <div style={{ marginBottom: '24px' }}>
              <label
                htmlFor="password"
                style={{ display: 'block', fontSize: '14px', fontWeight: 500, color: '#1e3a5f', marginBottom: '8px' }}
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
                style={inputStyle}
                onFocus={(e) => { Object.assign(e.currentTarget.style, inputFocusStyle); }}
                onBlur={(e) => { Object.assign(e.currentTarget.style, inputStyle); }}
              />
            </div>

            {/* Login button */}
            <button
              type="submit"
              disabled={loading}
              style={buttonStyle}
              onMouseEnter={(e) => {
                if (!loading) e.currentTarget.style.background = '#e76f51';
              }}
              onMouseLeave={(e) => {
                if (!loading) e.currentTarget.style.background = '#f4a261';
              }}
            >
              {loading ? 'Signing in…' : 'Login'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

'use client';

/**
 * Reset password — Property NI Multi-Tenant Portal (local users).
 *
 * Reached from the single-use email link (/auth/reset-password?token=…). Same
 * visual family as /login (brand panel via components/auth/AuthBrand, 380px
 * column, squared controls, accent CTA). States:
 *   loading  → "Checking your reset link…" (verify pre-flight)
 *   invalid  → "Link no longer valid" + CTA back into the request flow — the
 *              page owns this redirect decision; the verify route stays a JSON API
 *              (Phase 3.3 deviation note)
 *   form     → new password + confirm, client guards mirroring /api/auth/password
 *   success  → "Password updated" for ~900ms → /login?password_reset=1
 *
 * Token hygiene (design T12): the token is read once on mount, remembered in
 * state, and stripped from the URL with router.replace — it never persists in
 * history or the rendered address bar. The server remains authoritative
 * (verify is read-only; consumption happens atomically inside BetterAuth at
 * reset time).
 */

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, KeyRound, Mail } from 'lucide-react';
import { SkylineField, Wordmark } from '@/components/auth/AuthBrand';

const MIN_LEN = 8; // matches BetterAuth emailAndPassword min length (surfaced copy)
const MAX_LEN = 72; // scrypt input ceiling — same pre-check as /api/auth/password

type ResetState = 'loading' | 'invalid' | 'form' | 'success';

function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoFocus?: boolean;
  invalid: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-900">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id}
          type={visible ? 'text' : 'password'}
          autoComplete="new-password"
          autoFocus={autoFocus}
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid ? true : undefined}
          className={`w-full h-12 pl-4 pr-12 rounded-lg border bg-white text-slate-900 text-base outline-none box-border transition-shadow focus:ring-[3px] ${
            invalid
              ? 'border-danger focus:border-danger focus:ring-danger/25'
              : 'border-slate-300 focus:border-navy-700 focus:ring-accent/25'
          }`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          className="absolute inset-y-0 right-1 my-auto flex h-10 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-800 cursor-pointer"
        >
          {visible ? (
            <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}

function ResetPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read the token exactly once, at mount — then it lives in state only.
  const initialToken = useRef<string | null>(null);
  if (initialToken.current === null) {
    initialToken.current = searchParams.get('token');
  }
  const [state, setState] = useState<ResetState>('loading');
  const [token, setToken] = useState(initialToken.current ?? '');
  const [expiresInSeconds, setExpiresInSeconds] = useState<number | null>(null);
  const [newPassword, setNewPasswordRaw] = useState('');
  const [confirm, setConfirmRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Typing either field clears any submit-time error so the correction is felt
  // immediately — same idiom as TopBarChangePasswordModal's mismatch guard.
  const setNewPassword = (v: string) => {
    setNewPasswordRaw(v);
    if (state === 'form') setError(null);
  };
  const setConfirm = (v: string) => {
    setConfirmRaw(v);
    if (state === 'form') setError(null);
  };


  useEffect(() => {
    let cancelled = false;

    // Pre-flight (read-only — never consumes the token). The page owns the
    // UX decision: valid → form, anything else → invalid state.
    fetch(`/api/auth/password-reset/verify?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as
          | { valid?: boolean; expiresInSeconds?: number }
          | null;
        if (cancelled) return;
        if (res.ok && data?.valid === true) {
          setExpiresInSeconds(typeof data.expiresInSeconds === 'number' ? data.expiresInSeconds : null);
          setState('form');
        } else {
          setState('invalid');
        }
      })
      .catch(() => {
        if (!cancelled) setState('invalid');
      });

    // One-shot strip (design T12): the address bar must not keep carrying the
    // token in history after verification. Runs unconditionally — with no
    // token the URL is already clean, so this is a harmless same-state replace.
    router.replace('/auth/reset-password', { scroll: false });

    return () => {
      cancelled = true;
    };
    // Verify exactly once per page load. `token` is captured from the initial
    // search params above and never changes, so [router] is the complete dep set —
    // a param-strip re-render must not re-issue the pre-flight (double audit).
  }, [router]);

  const submitReset = useCallback(
    async (pw: string) => {
      setError(null);
      setSaving(true);
      try {
        const res = await fetch('/api/auth/password-reset/reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: pw, token }),
        });
        if (res.ok) {
          setState('success');
          // Brief confirmation, then hand the user to sign-in with a marker
          // (login page renders the ?password_reset=1 banner, Phase 4.4).
          setTimeout(() => router.push('/login?password_reset=1'), 900);
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data?.error ?? 'Something went wrong — try again.');
      } catch {
        setError('We couldn’t reach the sign-in service. Check your connection and try again.');
      } finally {
        setSaving(false);
      }
    },
    [token, router],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Client guards mirror the server's order (length ceiling/floor before
    // anything leaves the browser; mismatch is the modal's established copy).
    if (!newPassword) {
      setError('Enter a new password.');
      return;
    }
    if (newPassword.length > MAX_LEN) {
      setError(`Password must be at most ${MAX_LEN} characters.`);
      return;
    }
    if (newPassword.length < MIN_LEN) {
      setError(`Password must be at least ${MIN_LEN} characters.`);
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    void submitReset(newPassword);
  }

  const fieldsInvalid = error !== null && state === 'form';

  return (
    <div className="min-h-screen flex flex-col bg-canvas-subtle lg:flex-row">
      {/* ── Mobile brand band (below lg) ───────────────────────────── */}
      <div className="relative h-48 overflow-hidden rounded-b-[24px] bg-navy-950 lg:hidden">
        <SkylineField />
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-navy-950/80 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-5">
          <Wordmark onDark />
        </div>
      </div>

      {/* ── Left panel: Branding + skyline field (desktop) ─────────── */}
      <aside className="relative hidden lg:flex lg:w-[46%] overflow-hidden rounded-r-[28px] bg-navy-950">
        <SkylineField />
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-navy-950 via-navy-950/60 to-transparent" />
        <div className="relative z-10 flex h-full w-full flex-col justify-between px-12 pt-12 pb-[clamp(88px,14vh,176px)]">
          <Wordmark onDark />
          <div className="w-full max-w-[400px] login-rise-delayed">
            <span className="block h-[2px] w-16 bg-accent" aria-hidden="true" />
            <h1 className="mt-5 text-[17px] leading-relaxed text-white/70">
              A Multi-tenant property management portal for directors, management agents, tenants and contractors
            </h1>
          </div>
        </div>
      </aside>

      {/* ── Right panel: state machine ─────────────────────────────── */}
      <main className="flex w-full flex-1 items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[380px] login-rise">
          {state === 'loading' && (
            <div role="status" aria-live="assertive" className="mt-6">
              <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">Reset your password</h2>
              <p className="mt-4 flex items-center gap-3 text-sm leading-relaxed text-slate-500">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden="true" />
                Checking your reset link…
              </p>
            </div>
          )}

          {state === 'invalid' && (
            <div role="status" className="mt-6">
              <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">Link no longer valid</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                This reset link has expired or has already been used. Request a fresh one — it takes a minute.
              </p>
              <div className="mt-6 space-y-3">
                <button
                  type="button"
                  onClick={() => router.push('/auth/forgot-password')}
                  className="w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-lg bg-accent text-accent-ink text-[15px] font-semibold cursor-pointer transition-colors active:translate-y-px hover:bg-accent-strong"
                >
                  <Mail className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                  Email me a new link
                </button>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    router.push('/login');
                  }}
                  className="inline-flex w-full items-center justify-center text-sm font-medium text-navy-700 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-navy-950 hover:decoration-navy-700"
                >
                  Back to sign in
                </a>
              </div>
            </div>
          )}

          {state === 'form' && (
            <>
              <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">Choose a new password</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Enter it twice to confirm. Minimum {MIN_LEN} characters{expiresInSeconds !== null ? `, single-use, expires in about ${Math.max(1, Math.round(expiresInSeconds / 60))} ${Math.round(expiresInSeconds / 60) === 1 ? 'minute' : 'minutes'}` : ''}.
              </p>

              <div aria-live="assertive" className="mt-6 space-y-3 empty:mt-0">
                {error && (
                  <div role="alert" className="rounded-lg border border-danger-border bg-danger-tint p-4 text-sm leading-relaxed text-danger-ink">
                    {error}
                  </div>
                )}
              </div>

              <form onSubmit={handleSubmit} className="mt-4" noValidate>
                <div className="mb-5">
                  <PasswordField
                    id="new-password"
                    label="New password"
                    value={newPassword}
                    onChange={setNewPassword}
                    placeholder="Enter a new password"
                    autoFocus
                    invalid={fieldsInvalid}
                  />
                </div>

                <div className="mb-6">
                  <PasswordField
                    id="confirm-new-password"
                    label="Confirm new password"
                    value={confirm}
                    onChange={setConfirm}
                    placeholder="Repeat the new password"
                    invalid={fieldsInvalid}
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving}
                  className={`w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-lg bg-accent text-accent-ink text-[15px] font-semibold cursor-pointer transition-colors active:translate-y-px hover:bg-accent-strong ${
                    saving ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                  {saving ? 'Updating…' : 'Update password'}
                </button>
              </form>

              <p className="mt-6 text-xs leading-relaxed text-slate-500">
                After updating, you’ll be asked to sign in with the new password.
              </p>
            </>
          )}

          {state === 'success' && (
            <div role="status" className="mt-6">
              <div className="flex items-start gap-3 rounded-lg border border-success-border bg-success-tint p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <p className="text-sm font-medium leading-relaxed text-success">Password updated</p>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-500">Taking you to sign in…</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordContent />
    </Suspense>
  );
}

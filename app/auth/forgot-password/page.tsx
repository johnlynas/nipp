'use client';

/**
 * Forgot password — Property NI Multi-Tenant Portal (local users).
 *
 * Same visual family as /login: split-screen with the dusk-waterway brand
 * panel (shared via components/auth/AuthBrand), 380px form column, squared
 * controls, accent CTA. Client component calling POST /api/auth/password-reset
 * in-process — token generation and the Verification row stay single-sourced
 * in BetterAuth server-side.
 *
 * Copy discipline (design §7.1 no-oracle): the success card is IDENTICAL for
 * known and unknown emails ("If this account exists…") — the page never reveals
 * whether an account matched, matching the route's idempotent 200 pass-through.
 */

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, Mail, RefreshCw } from 'lucide-react';
import { SkylineField, Wordmark } from '@/components/auth/AuthBrand';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Resend cooldown after a send — the request tier is 5/min per IP (plan §3.1). */
const RESEND_COOLDOWN_MS = 60_000;

function ForgotPasswordContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [loading, setLoading] = useState(false);
  // 'sent' renders the idempotent success card + resend affordance.
  const [sent, setSent] = useState(false);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // One-shot ?expired=1 — the verify flow lands here when a token died between
  // issue and use (T7). Announce once, then strip the param so a refresh
  // doesn't re-announce (login page's one-shot-param idiom).
  const [expiredNote, setExpiredNote] = useState(false);
  useEffect(() => {
    if (searchParams.get('expired') === '1') {
      setExpiredNote(true);
      router.replace('/auth/forgot-password', { scroll: false });
    }
  }, [searchParams, router]);

  function clearCooldown() {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    cooldownTimer.current = null;
  }

  function startCooldown() {
    setCooldownLeft(RESEND_COOLDOWN_MS / 1000);
    clearCooldown();
    cooldownTimer.current = setInterval(() => {
      setCooldownLeft((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
  }

  useEffect(() => () => clearCooldown(), []);

  const submit = useCallback(
    async (value: string) => {
      setError(null);
      setIsBanned(false);
      setLoading(true);
      try {
        const res = await fetch('/api/auth/password-reset', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: value.trim().toLowerCase() }),
        });
        if (res.ok) {
          setSent(true);
          startCooldown();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // The ban gate runs before BetterAuth server-side — surface its copy,
        // classified like the login page so it reads as a rejection banner.
        if (res.status === 401) setIsBanned(true);
        setError(data?.error ?? 'Something went wrong — try again.');
      } catch {
        // Request never reached the server — distinct sentinel copy naming the recovery.
        setError('We couldn’t reach the sign-in service. Check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) {
      setError('A valid email is required — enter the address you sign in with.');
      return; // client-side pre-check: no fetch, nothing leaves the browser
    }
    void submit(email);
  }

  const cooldownRunning = cooldownLeft > 0;

  return (
    <div className="min-h-screen flex flex-col bg-canvas-subtle lg:flex-row">
      {/* ── Mobile brand band: same dusk waterway compressed to a header (below lg) ── */}
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

      {/* ── Right panel: form / success card ───────────────────────── */}
      <main className="flex w-full flex-1 items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[380px] login-rise">
          {/* Rejection banners — same tone strings as /login (banned → danger,
              other server rejections → warning) for visual family consistency */}
          <div aria-live="assertive" className="mt-6 space-y-3 empty:mt-0">
            {expiredNote && !sent && (
              <div role="status" className="rounded-lg border border-warning-border bg-warning-tint p-4 text-sm leading-relaxed text-warning-ink">
                That reset link has expired or is invalid — enter your email below and we’ll send you a fresh one.
              </div>
            )}
            {error && !sent && (
              <div
                role="alert"
                className={`rounded-lg border p-4 text-sm leading-relaxed ${
                  isBanned
                    ? 'border-danger-border bg-danger-tint text-danger-ink'
                    : 'border-warning-border bg-warning-tint text-warning-ink'
                }`}
              >
                {isBanned ? (
                  <div>
                    <p className="font-semibold mb-1">Account banned</p>
                    <p>{error}</p>
                    <p className="mt-2 font-normal">Contact your portal administrator to restore access.</p>
                  </div>
                ) : (
                  <span>{error}</span>
                )}
              </div>
            )}
          </div>

          {sent ? (
            /* Idempotent success card — deliberately identical for known and
               unknown emails (no-oracle). role=status so the switch from form
               is announced. */
            <div role="status" className="mt-6">
              <div className="flex items-start gap-3 rounded-lg border border-success-border bg-success-tint p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium leading-relaxed text-success">Reset email sent</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    If this account exists, a reset link is on its way — check your inbox (and spam) within the next
                    minute. The link is single-use and expires in about an hour.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={cooldownRunning || loading}
                onClick={() => void submit(email)}
                className={`mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:border-navy-700 ${
                  cooldownRunning || loading ? 'cursor-not-allowed opacity-60' : 'cursor-pointer active:translate-y-px'
                }`}
              >
                <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
                {loading ? 'Sending…' : cooldownRunning ? `Resend in ${cooldownLeft}s` : 'Email me a new link'}
              </button>

              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  router.push('/login');
                }}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 text-sm font-medium text-navy-700 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-navy-950 hover:decoration-navy-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to sign in
              </a>

              <p className="mt-8 text-xs leading-relaxed text-slate-500">
                Didn’t request a reset? You can safely ignore this page. Something feels off about a link you received?{' '}
                Contact your portal administrator.
              </p>
            </div>
          ) : (
            <>
              <h2 className="mt-6 text-[28px] font-semibold tracking-tight text-slate-900">Reset your password</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Enter the email you sign in with and we’ll send you a link to choose a new one.
              </p>

              <form onSubmit={handleSubmit} className="mt-6" noValidate>
                {/* Mirrors /login's "User ID" field (same id, same copy) */}
                <div className="mb-6">
                  <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-900">
                    User ID
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email address"
                    aria-invalid={error ? true : undefined}
                    className={`w-full h-12 px-4 rounded-lg border bg-white text-slate-900 text-base outline-none box-border transition-shadow focus:ring-[3px] ${
                      error
                        ? 'border-danger focus:border-danger focus:ring-danger/25'
                        : 'border-slate-300 focus:border-navy-700 focus:ring-accent/25'
                    }`}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-lg bg-accent text-accent-ink text-[15px] font-semibold cursor-pointer transition-colors active:translate-y-px hover:bg-accent-strong ${
                    loading ? 'opacity-60 cursor-not-allowed' : ''
                  }`}
                >
                  <Mail className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                  {loading ? 'Sending…' : 'Email me a reset link'}
                </button>
              </form>

              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  router.push('/login');
                }}
                className="mt-4 inline-flex items-center justify-center gap-1.5 text-sm font-medium text-navy-700 underline decoration-slate-300 underline-offset-2 transition-colors hover:text-navy-950 hover:decoration-navy-700"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to sign in
              </a>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  );
}

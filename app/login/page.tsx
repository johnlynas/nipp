'use client';

/**
 * Login page — Property NI Multi-Tenant Portal.
 *
 * Split-screen layout:
 *   Left  — Branding panel: author-drawn waterfront skyline at dusk
 *           (navy chrome palette, amber window light = the live-status accent)
 *   Right — Sign-in form: email/password (functional), Google & Apple
 *           providers shown for presentation only. Squared (rounded-lg) controls,
 *           no pills.
 */

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail } from 'lucide-react';
import { signInEmail } from '@/lib/auth-client';

/* ── Brand marks ────────────────────────────────────────────────── */

const GOOGLE_G_PATH =
  'M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z';

const APPLE_PATH =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" className={className}>
      <path fill="currentColor" d={GOOGLE_G_PATH} />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" role="img" aria-hidden="true" className={className}>
      <path fill="currentColor" d={APPLE_PATH} />
    </svg>
  );
}

function BrandMark({ onDark, className }: { onDark?: boolean; className?: string }) {
  return (
    <span
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border ${
        onDark ? 'border-white/20 bg-white/10' : 'border-navy-700/30 bg-navy-850'
      } ${className ?? ''}`}
    >
      {/* House glyph — the product's subject, drawn in the accent */}
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
        <path
          d="M4.5 11.5 12 5l7.5 6.5"
          fill="none"
          stroke="#F5A623"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 10.5V19h11v-8.5"
          fill="none"
          stroke="#F5A623"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Wordmark({ onDark }: { onDark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark onDark={onDark} />
      <span className={`text-[30px] font-semibold tracking-tight ${onDark ? 'text-white' : 'text-slate-900'}`}>
        Property NI
      </span>
    </div>
  );
}

/* ── Waterfront scene (author SVG, deterministic — SSR-safe) ───── */

function hash(n: number): number {
  let x = (n ^ 61) ^ (n >>> 16);
  x = (x + (x << 3)) | 0;
  x ^= x >>> 4;
  x = (Math.imul(x, 0x27d4eb2d)) | 0;
  x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
}

const SCENE_W = 640;
const QUAY_Y = 636;

interface Building {
  x: number;
  w: number;
  h: number;
  tone: number;
}

const FRONT_BUILDINGS: Building[] = [
  { x: 14,  w: 72, h: 208, tone: 0 },
  { x: 96,  w: 56, h: 284, tone: 1 },
  { x: 162, w: 88, h: 196, tone: 0 },
  { x: 260, w: 64, h: 330, tone: 1 },
  { x: 334, w: 98, h: 250, tone: 0 },
  { x: 442, w: 72, h: 176, tone: 1 },
  { x: 524, w: 58, h: 300, tone: 0 },
  { x: 590, w: 38, h: 206, tone: 1 },
];

const BACK_BUILDINGS: Building[] = [
  { x: -8,  w: 70,  h: 148, tone: 1 },
  { x: 72,  w: 84,  h: 118, tone: 0 },
  { x: 184, w: 66,  h: 92,  tone: 1 },
  { x: 356, w: 84,  h: 128, tone: 0 },
  { x: 448, w: 104, h: 142, tone: 1 },
  { x: 572, w: 76,  h: 104, tone: 0 },
];

const TONES = ['#2B3E66', '#24355C'];

function windowTier(id: number): number {
  const r = hash(id);
  if (r > 0.88) return 0.6;   // lit rooms — the amber accent, softly
  if (r > 0.78) return 0.38;
  if (r > 0.52) return 0.16;  // dim
  return 0.05;                // dark glass
}

function SceneWindows({ b, bi }: { b: Building; bi: number }) {
  const WIN_W = 11;
  const WIN_H = 13;
  const GX = 9;
  const GY = 11;
  const topPad = 16;
  const bottomPad = 12;
  const cols = Math.floor((b.w - 14 + GX) / (WIN_W + GX));
  const rows = Math.max(1, Math.floor((b.h - topPad - bottomPad + GY) / (WIN_H + GY)));
  const gridW = cols * (WIN_W + GX) - GX;
  const x0 = b.x + (b.w - gridW) / 2;
  const yTop = QUAY_Y - b.h;

  const wins: { x: number; y: number; o: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      wins.push({
        x: x0 + c * (WIN_W + GX),
        y: yTop + topPad + r * (WIN_H + GY),
        o: windowTier(bi * 431 + r * 37 + c),
      });
    }
  }
  return (
    <>
      {wins.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width={WIN_W} height={WIN_H} rx={2.5} fill="#F5A623" opacity={w.o} />
      ))}
    </>
  );
}

function WaterfrontScene() {
  const stars = Array.from({ length: 22 }, (_, i) => ({
    x: 8 + hash(i * 7 + 1) * (SCENE_W - 16),
    y: 10 + hash(i * 13 + 5) * 420,
    r: 0.7 + hash(i * 31 + 9) * 0.9,
    o: 0.15 + hash(i * 19 + 3) * 0.25,
  }));
  const glints = Array.from({ length: 14 }, (_, i) => ({
    x: 16 + hash(i * 17 + 2) * (SCENE_W - 90),
    y: QUAY_Y + 22 + i * ((900 - QUAY_Y - 40) / 14) + hash(i * 29) * 8,
    w: 26 + hash(i * 3 + 8) * 44,
    o: 0.05 + hash(i * 5 + 4) * 0.09,
  }));

  return (
    <svg
      viewBox={`0 0 ${SCENE_W} 900`}
      preserveAspectRatio="xMidYMax slice"
      className="absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="login-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#121C30" />
          <stop offset="0.7" stopColor="#16223A" />
          <stop offset="1" stopColor="#1B2A4A" />
        </linearGradient>
        <linearGradient id="login-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#121C30" />
          <stop offset="1" stopColor="#0B1322" />
        </linearGradient>
        <radialGradient id="login-moon-halo">
          <stop offset="0" stopColor="#F8FAFC" stopOpacity="0.2" />
          <stop offset="0.55" stopColor="#F8FAFC" stopOpacity="0.06" />
          <stop offset="1" stopColor="#F8FAFC" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="login-glint" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5A623" stopOpacity="0.16" />
          <stop offset="1" stopColor="#F5A623" stopOpacity="0" />
        </linearGradient>
        {/* Horizon haze — dissolves the skyline into the sky */}
        <linearGradient id="login-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1B2A4A" stopOpacity="0" />
          <stop offset="1" stopColor="#1B2A4A" stopOpacity="0.85" />
        </linearGradient>
        <filter id="login-blur-lg" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="login-blur-sm" x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      {/* Sky */}
      <rect width={SCENE_W} height={QUAY_Y} fill="url(#login-sky)" />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#F8FAFC" opacity={s.o} filter="url(#login-blur-sm)" />
      ))}

      {/* Moon — diffused disc and broad halo */}
      <circle cx={506} cy={142} r={110} fill="url(#login-moon-halo)" />
      <circle cx={506} cy={142} r={34} fill="#F8FAFC" opacity={0.85} filter="url(#login-blur-sm)" />

      {/* Distant birds */}
      <g stroke="#F8FAFC" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity={0.3} filter="url(#login-blur-sm)">
        <path d="M118 168q7-6 14 0q7-6 14 0" />
        <path d="M172 196q6-5 12 0q6-5 12 0" />
        <path d="M84 236q5-4 10 0q5-4 10 0" />
      </g>

      {/* Back skyline (silhouette, softened) */}
      <g filter="url(#login-blur-lg)">
        {BACK_BUILDINGS.map((b, i) => (
          <rect key={i} x={b.x} y={QUAY_Y - b.h} width={b.w} height={b.h} fill="#1A2743" rx={6} />
        ))}
      </g>

      {/* Front buildings + window light */}
      <g filter="url(#login-blur-sm)">
        {FRONT_BUILDINGS.map((b, i) => (
          <rect key={i} x={b.x} y={QUAY_Y - b.h} width={b.w} height={b.h} fill={TONES[b.tone]} rx={4} />
        ))}
      </g>

      {/* Horizon haze over the skyline — atmospheric depth */}
      <rect x={0} y={QUAY_Y - 120} width={SCENE_W} height={120} fill="url(#login-haze)" />

      {/* Window light (kept above the haze, blurred once as a group — soft bokeh) */}
      <g filter="url(#login-blur-sm)">
        {FRONT_BUILDINGS.map((b, i) => <SceneWindows key={i} b={b} bi={i + 1} />)}
      </g>
      <g filter="url(#login-blur-sm)" opacity={0.75}>
        {FRONT_BUILDINGS.map((b, i) => (
          <rect key={i} x={b.x} y={QUAY_Y - b.h} width={b.w} height={14} fill="#F5A623" opacity={0.08} />
        ))}
      </g>

      {/* Quay edge — the accent line marking the working waterway */}
      <rect x={0} y={QUAY_Y - 4} width={SCENE_W} height={8} fill="#121C30" opacity={0.9} />
      <line x1={0} y1={QUAY_Y + 4} x2={SCENE_W} y2={QUAY_Y + 4} stroke="#F5A623" strokeWidth={1} opacity={0.3} />

      {/* Water */}
      <rect x={0} y={QUAY_Y + 4} width={SCENE_W} height={900 - QUAY_Y - 4} fill="url(#login-water)" />
      {glints.map((g, i) => (
        <rect key={i} x={g.x} y={g.y} width={g.w} height={2.5} rx={1.25} fill="#F5A623" opacity={g.o * 0.8} filter="url(#login-blur-sm)" />
      ))}
      {/* Moon glint column */}
      <rect x={470} y={QUAY_Y + 8} width={72} height={900 - QUAY_Y - 16} fill="url(#login-glint)" opacity={0.5} filter="url(#login-blur-lg)" />
    </svg>
  );
}

/* ── Form ───────────────────────────────────────────────────────── */

const SSO_NOTES: Record<string, string> = {
  google: 'Google sign-in isn’t connected to this portal yet. Ask an administrator to enable it.',
  apple: 'Apple Sign In isn’t connected to this portal yet. Ask an administrator to enable it.',
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ssoNote, setSsoNote] = useState<string | null>(null);

  useEffect(() => {
    if (!ssoNote) return;
    const t = setTimeout(() => setSsoNote(null), 5000);
    return () => clearTimeout(t);
  }, [ssoNote]);

  // Auto-dismiss a sign-in error after 10 seconds so the form clears on its own
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => {
      setError(null);
      setIsBanned(false);
    }, 10000);
    return () => clearTimeout(t);
  }, [error]);

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

  const socialButtonCls =
    'w-full h-12 inline-flex items-center justify-center gap-3 rounded-lg border bg-white text-slate-900 text-[15px] font-medium transition-colors cursor-pointer hover:border-navy-700 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen flex bg-canvas-subtle">
      {/* ── Left panel: Branding + waterfront scene ─────────────── */}
      <aside className="relative hidden lg:flex lg:w-[46%] overflow-hidden bg-navy-950">
        <WaterfrontScene />

        {/* Readability fade behind the heading block */}
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-navy-950 via-navy-950/60 to-transparent" />

        <div className="relative z-10 flex h-full w-full flex-col justify-between p-12">
          <Wordmark onDark />

          <div className="mt-16 w-full max-w-[400px] login-rise-delayed">
            <h1 className="text-[24px] leading-[1.25] font-semibold tracking-tight text-white">
              Multi-tenant property management, built for Northern Ireland
            </h1>
            <span className="mt-4 block h-[3px] w-full bg-accent" aria-hidden="true" />
            <p className="mt-5 text-[17px] leading-relaxed text-white/65">
              Management companies, Agents, Tenants and Contractors - one portal to cover them all
            </p>
          </div>
        </div>
      </aside>

      {/* ── Right panel: Sign-in form ───────────────────────────── */}
      <main className="flex w-full flex-1 items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[380px] login-rise">
          {/* Mobile brand (left panel hidden below lg) */}
          <div className="mb-10 lg:hidden">
            <Wordmark />
          </div>

          <h2 className="text-[28px] font-semibold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            Sign in to your Property NI workspace.
          </p>

          {/* Error message */}
          <div aria-live="assertive" className="mt-6 empty:mt-0">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger-border bg-danger-tint p-4 text-sm leading-relaxed text-danger-ink"
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

          <form onSubmit={handleSubmit} className="mt-6">
            {/* User ID (email) input */}
            <div className="mb-5">
              <label htmlFor="email" className="block text-sm font-medium text-slate-900 mb-2">
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
                className="w-full h-12 px-4 rounded-lg border border-slate-300 bg-white text-slate-900 text-base outline-none box-border focus:border-navy-700 focus:ring-[3px] focus:ring-accent/25 transition-shadow"
              />
            </div>

            {/* Password input */}
            <div className="mb-6">
              <label htmlFor="password" className="block text-sm font-medium text-slate-900 mb-2">
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
                className="w-full h-12 px-4 rounded-lg border border-slate-300 bg-white text-slate-900 text-base outline-none box-border focus:border-navy-700 focus:ring-[3px] focus:ring-accent/25 transition-shadow"
              />
            </div>

            {/* Primary: email/password sign-in (functional) */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full h-12 inline-flex items-center justify-center gap-2.5 rounded-lg bg-accent text-accent-ink text-[15px] font-semibold cursor-pointer transition-colors active:translate-y-px hover:bg-accent-strong ${
                loading ? 'opacity-60 cursor-not-allowed' : ''
              }`}
            >
              <Mail className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              {loading ? 'Signing in…' : 'Signin with email'}
            </button>

            {/* Divider */}
            <div className="mt-7 flex items-center gap-3 select-none" aria-hidden="true">
              <span className="h-px flex-1 bg-slate-200" />
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-slate-500">
                or continue with
              </span>
              <span className="h-px flex-1 bg-slate-200" />
            </div>

            {/* Social providers — presentation only until wired up */}
            <div className="mt-5 space-y-3">
              <button type="button" disabled={loading} onClick={() => setSsoNote(SSO_NOTES.google)} className={socialButtonCls}>
                <GoogleIcon className="h-[18px] w-[18px] text-slate-900" />
                Sign in with Google
              </button>
              <button type="button" disabled={loading} onClick={() => setSsoNote(SSO_NOTES.apple)} className={socialButtonCls}>
                <AppleIcon className="h-[18px] w-[18px] text-slate-900" />
                Sign in with Apple
              </button>

              {/* Transient notice for the not-yet-wired providers */}
              <div aria-live="polite" className="empty:mt-0">
                {ssoNote && (
                  <p className="rounded-lg border border-warning-border bg-warning-tint px-4 py-3 text-sm leading-relaxed text-warning-ink">
                    {ssoNote}
                  </p>
                )}
              </div>
            </div>
          </form>

          <p className="mt-8 text-xs text-slate-500">
            Trouble signing in? Contact your portal administrator.
          </p>
        </div>
      </main>
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

'use client';

/**
 * Login page — Property NI Multi-Tenant Portal.
 *
 * Split-screen layout:
 *   Left  — Conceptual branding panel: abstract dusk skyline field
 *           (two depth layers over a working waterway, sparse amber
 *           beacons = the live-status accent). Straight edge with a
 *           soft rounded corner into the canvas.
 *   Top (mobile) — the same field compressed to a 192px brand band
 *           with the wordmark, so the dark world doesn't disappear below lg.
 *   Right — Sign-in form: email/password (functional), Google & Apple
 *           providers shown for presentation only. Squared (rounded-lg)
 *           controls, no pills.
 */

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Mail } from 'lucide-react';
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

/* ── Abstract skyline field (author SVG, deterministic — SSR-safe) ─
   Conceptual take on the brand subject: distant city columns over a
   working waterway at dusk. Two depth layers, one amber horizon line,
   a pale reflection — drawn entirely in the standard navy palette,
   amber reserved for the live-status accents. */

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

interface Column {
  x: number;
  w: number;
  h: number;
  tone: number;
}

/** Deterministic row of variable-width columns rising from the horizon. */
function makeColumns(seed: number, minH: number, spanH: number): Column[] {
  const cols: Column[] = [];
  let x = -4;
  for (let i = 0; i < 60 && x < SCENE_W; i++) {
    const w = 7 + Math.floor(hash(seed * 131 + i) * 21);        // 7–27px column
    const h = minH + hash(seed * 97 + i * 7 + 3) * spanH;       // seeded height
    cols.push({ x: Math.round(x), w, h: Math.round(h), tone: (i + seed) % 2 });
    x += w + 5 + Math.floor(hash(seed * 53 + i * 11) * 9);      // 5–13px gap
  }
  return cols;
}

const BACK_COLUMNS = makeColumns(3, 88, 224);   // far layer — dimmer atmosphere
const FRONT_COLUMNS = makeColumns(7, 44, 248);  // near layer — crisp chrome tones

const TONES = ['#2B3E66', '#24355C'];

function SkylineField() {
  const stars = Array.from({ length: 18 }, (_, i) => ({
    x: 8 + hash(i * 7 + 1) * (SCENE_W - 16),
    y: 8 + hash(i * 13 + 5) * 400,
    r: 0.6 + hash(i * 31 + 9) * 0.9,
    o: 0.12 + hash(i * 19 + 3) * 0.2,
  }));
  const glints = Array.from({ length: 9 }, (_, i) => ({
    x: 18 + hash(i * 17 + 4) * (SCENE_W - 80),
    y: QUAY_Y + 18 + i * ((900 - QUAY_Y - 30) / 9) + hash(i * 29 + 6) * 6,
    w: 24 + hash(i * 3 + 8) * 40,
    o: 0.04 + hash(i * 5 + 4) * 0.07,
  }));
  const beaconIdx = [3, 10, 17].filter((i) => i < FRONT_COLUMNS.length);

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
          <stop offset="0" stopColor="#0E1830" />
          <stop offset="1" stopColor="#0A1120" />
        </linearGradient>
        {/* Horizon haze — dissolves the far layer into the sky */}
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

      {/* Far columns — atmospheric depth layer */}
      <g filter="url(#login-blur-lg)" opacity={0.55}>
        {BACK_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill="#24355C" rx={2} />
        ))}
      </g>

      {/* Horizon haze over the far layer */}
      <rect x={0} y={QUAY_Y - 110} width={SCENE_W} height={110} fill="url(#login-haze)" />

      {/* Near columns — crisp, alternating chrome tones */}
      <g filter="url(#login-blur-sm)">
        {FRONT_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill={TONES[c.tone]} rx={2} />
        ))}
      </g>

      {/* Beacon lights — the city is occupied */}
      <g filter="url(#login-blur-sm)">
        {beaconIdx.map((i) => {
          const c = FRONT_COLUMNS[i];
          return (
            <circle key={i} cx={c.x + c.w / 2} cy={QUAY_Y - c.h - 3} r={1.7} fill="#F5A623" opacity={0.45} />
          );
        })}
      </g>

      {/* Water */}
      <rect x={0} y={QUAY_Y + 4} width={SCENE_W} height={900 - QUAY_Y - 4} fill="url(#login-water)" />

      {/* Reflection — near columns mirrored, compressed and dimmed */}
      <g transform={`translate(0 ${2 * QUAY_Y}) scale(1 -0.5)`} filter="url(#login-blur-lg)" opacity={0.4}>
        {FRONT_COLUMNS.map((c, i) => (
          <rect key={i} x={c.x} y={QUAY_Y - c.h} width={c.w} height={c.h} fill={TONES[c.tone]} rx={2} />
        ))}
      </g>

      {/* Amber horizon — the working waterway, a live-status line */}
      <line x1={0} y1={QUAY_Y + 4.5} x2={SCENE_W} y2={QUAY_Y + 4.5} stroke="#F5A623" strokeWidth={1.2} opacity={0.4} />

      {/* Quiet amber glints on the water */}
      {glints.map((g, i) => (
        <rect key={i} x={g.x} y={g.y} width={g.w} height={2} rx={1} fill="#F5A623" opacity={g.o * 0.9} filter="url(#login-blur-sm)" />
      ))}
    </svg>
  );
}

/* ── Form ───────────────────────────────────────────────────────── */

const SSO_NOTES: Record<string, string> = {
  google: 'Google sign-in isn’t connected to this portal yet. Ask an administrator to enable it.',
  apple: 'Apple Sign In isn’t connected to this portal yet. Ask an administrator to enable it.',
  reset: 'Password resets are handled by your portal administrator. Contact them to have your password restored.',
};

// Set to the organisation's admin contact (e.g. 'admin@propertyni.gov.uk') once
// decided — the "Contact your portal administrator" line becomes a mailto link
// only when this is configured, so a placeholder address never ships.
const ADMIN_CONTACT_EMAIL = '';

// Sentinel for "the request never reached the server" — kept distinct from
// server-returned messages so the banner can phrase each recovery accurately.
const NETWORK_ERROR_KEY = 'login.network-error';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBanned, setIsBanned] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ssoNote, setSsoNote] = useState<string | null>(null);

  useEffect(() => {
    if (!ssoNote) return;
    const t = setTimeout(() => setSsoNote(null), 5000);
    return () => clearTimeout(t);
  }, [ssoNote]);

  // Auto-dismiss a transient sign-in error after 10s; a banned-account message
  // stays until the user acts on it — it's longer and they may be mid-read
  useEffect(() => {
    if (!error || isBanned) return;
    const t = setTimeout(() => {
      setError(null);
      setIsBanned(false);
    }, 10000);
    return () => clearTimeout(t);
  }, [error, isBanned]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsBanned(false);
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
      // Sign-in request never reached the server (offline, DNS, proxy block) —
      // set a sentinel so the banner phrases the recovery, not raw text.
      setError(NETWORK_ERROR_KEY);
    } finally {
      setLoading(false);
    }
  }

  const socialButtonCls =
    'w-full h-12 inline-flex items-center justify-center gap-3 rounded-lg border bg-white text-slate-900 text-[15px] font-medium transition-colors cursor-pointer hover:border-navy-700 active:translate-y-px disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="min-h-screen flex flex-col bg-canvas-subtle lg:flex-row">
      {/* ── Mobile brand band: the same dusk waterway, compressed to a header (below lg) ── */}
      <div className="relative h-48 overflow-hidden rounded-b-[24px] bg-navy-950 lg:hidden">
        <SkylineField />
        {/* Readability veil behind the wordmark */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-navy-950/80 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 px-6 pb-5">
          <Wordmark onDark />
        </div>
      </div>

      {/* ── Left panel: Branding + skyline field (desktop) ─────── */}
      <aside className="relative hidden lg:flex lg:w-[46%] overflow-hidden rounded-r-[28px] bg-navy-950">
        <SkylineField />

        {/* Readability fade behind the heading block */}
        <div className="absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-navy-950 via-navy-950/60 to-transparent" />

        <div className="relative z-10 flex h-full w-full flex-col justify-between px-12 pt-12 pb-[clamp(88px,14vh,176px)]">
          <Wordmark onDark />

          {/* Statement block — anchored over the quiet water below the horizon */}
          <div className="w-full max-w-[400px] login-rise-delayed">
            <span className="block h-[2px] w-16 bg-accent" aria-hidden="true" />
            <h1 className="mt-5 text-[17px] leading-relaxed text-white/70">
              A Multi-tenant property management portal for directors, management agents, tenants and contractors
            </h1>
          </div>
        </div>
      </aside>

      {/* ── Right panel: Sign-in form ───────────────────────────── */}
      <main className="flex w-full flex-1 items-center justify-center px-6 py-14 sm:px-10">
        <div className="w-full max-w-[380px] login-rise">
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
                    <p className="mt-2 font-normal">Contact your portal administrator to restore access.</p>
                    {ADMIN_CONTACT_EMAIL && (
                      <a
                        href={`mailto:${ADMIN_CONTACT_EMAIL}?subject=Portal%20account%20access`}
                        className="mt-2 inline-block text-sm font-semibold underline decoration-slate-400 underline-offset-2 hover:decoration-danger-ink"
                      >
                        Contact administrator
                      </a>
                    )}
                  </div>
                ) : (
                  <span>
                    {error === 'Invalid credentials'
                      ? 'The email or password is incorrect. Check both and try again.'
                      : error === NETWORK_ERROR_KEY
                        ? 'We couldn’t reach the sign-in service. Check your connection and try again.'
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
                User ID
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email address"
                className="w-full h-12 px-4 rounded-lg border border-slate-300 bg-white text-slate-900 text-base outline-none box-border focus:border-navy-700 focus:ring-[3px] focus:ring-accent/25 transition-shadow"
              />
            </div>

            {/* Password input */}
            <div className="mb-6">
              <div className="mb-2 flex items-baseline justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-slate-900">
                  Password
                </label>
                <button
                  type="button"
                  onClick={() => setSsoNote(SSO_NOTES.reset)}
                  className="cursor-pointer rounded text-[13px] font-medium text-navy-700 transition-colors hover:text-navy-950"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-12 pl-4 pr-12 rounded-lg border border-slate-300 bg-white text-slate-900 text-base outline-none box-border focus:border-navy-700 focus:ring-[3px] focus:ring-accent/25 transition-shadow"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-1 my-auto flex h-10 w-9 items-center justify-center rounded-md text-slate-500 transition-colors hover:text-slate-800 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
                  ) : (
                    <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
                  )}
                </button>
              </div>
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
              {loading ? 'Signing in…' : 'Sign in with email'}
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
            Trouble signing in?{' '}
            {ADMIN_CONTACT_EMAIL ? (
              <a
                href={`mailto:${ADMIN_CONTACT_EMAIL}?subject=Portal%20sign-in%20help`}
                className="font-medium underline decoration-slate-300 underline-offset-2 text-slate-700 transition-colors hover:text-slate-900 hover:decoration-navy-700"
              >
                Contact your portal administrator
              </a>
            ) : (
              <span className="text-slate-600">Contact your portal administrator.</span>
            )}
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

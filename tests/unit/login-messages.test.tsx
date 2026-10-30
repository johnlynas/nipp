/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── /login page behaviour (Phase 4.4: forgot-password link + reset banner) ──
// The page component is rendered here with its network-facing modules stubbed;
// the pure-helper tests below don't need them.
import LoginPage from '@/app/login/page';
import { PASSWORD_RESET_BANNER_TEXT } from '@/lib/oidc-login-ui';

const loginNav = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));
const LOGIN_ROUTER = { push: loginNav.push, replace: loginNav.replace };

// Cache the URLSearchParams per search-string — a fresh object on every hook
// call lands in an effect deps array and re-runs the mount effect forever.
let cachedSearch: string | null = null;
let cachedParams: URLSearchParams | null = null;
function makeSearchParams(): URLSearchParams {
  if (cachedParams === null || cachedSearch !== loginNav.search) {
    cachedSearch = loginNav.search;
    cachedParams = new URLSearchParams(cachedSearch);
  }
  return cachedParams;
}

vi.mock('next/navigation', () => ({
  useRouter: () => LOGIN_ROUTER,
  useSearchParams: makeSearchParams,
}));
vi.mock('@/lib/auth-client', () => ({
  authClient: { signIn: { social: vi.fn() } },
  signInEmail: vi.fn(async () => { throw new Error('not used in these tests'); }),
}));

describe('/login page (Phase 4.4)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    loginNav.search = '';
  });

  it('“Forgot password?” navigates to the reset request page (no admin note, no fetch)', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<LoginPage />);

    fireEvent.click(screen.getByText('Forgot password?'));
    expect(loginNav.push).toHaveBeenCalledWith('/auth/forgot-password');
    // The old dead-end admin note is gone — nothing was sent, nothing announced.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/handled by your portal administrator/i)).not.toBeInTheDocument();
  });

  it('?password_reset=1 shows the success banner (auto-dismisses after 10s)', async () => {
    // Real timers: the mount effect clears the param and sets a 10s dismissal.
    loginNav.search = 'password_reset=1';
    render(<LoginPage />);

    expect(
      await screen.findByText(PASSWORD_RESET_BANNER_TEXT),
    ).toBeInTheDocument();

    // Param stripped by the one-shot consumption (no re-announce on refresh).
    const replaces = loginNav.replace.mock.calls.map((c: string[]) => String(c[0]));
    expect(replaces.every((u) => !u.includes('password_reset='))).toBe(true);
  });

  it('the password-reset banner auto-dismisses after ~10s (real clock)', async () => {
    loginNav.search = 'password_reset=1';
    render(<LoginPage />);
    await screen.findByText(PASSWORD_RESET_BANNER_TEXT);

    // One honest wall-clock wait — the page's documented 10s auto-dismiss.
    // Needs a per-test timeout: this is one of the suite's slow-pokes (10s).
    await waitFor(() => expect(screen.queryByText(PASSWORD_RESET_BANNER_TEXT)).not.toBeInTheDocument(), {
      timeout: 13_000,
    });
  }, 20_000);
});

// The original file header (pure-helper suite) follows below.
import {
  classifyGateMessage,
  NOT_INVITED_MSG,
  oidcParamBanner,
  resolveSameOriginTarget,
  OIDC_LINK_VERIFIED_TEXT,
  OIDC_LINK_FAILED_TEXT,
} from '@/lib/oidc-login-ui';

// Mirrors the exact messages thrown by enforceOidcProvisioning in lib/auth.ts.
const INBOX_CHECK_MSG =
  'Access denied. We need to confirm your email first — check your inbox for a verification link, then try signing in with Google again.';
const NOT_PROVISIONED_MSG =
  'Access denied. This account has not been provisioned by an administrator yet. Contact your portal administrator.';
// Stray-identity branch (uninvited auto-registered rows) — matches the gate's thrown text.
const STRAY_INVITED_MISSING_MSG =
  'Access denied. This account has not been invited to the portal yet. Contact your portal administrator.';

describe('classifyGateMessage', () => {
  it('classifies the unverified-inbox gate message as needs-inbox-check (NOT banned)', () => {
    expect(classifyGateMessage(INBOX_CHECK_MSG)).toBe('needs-inbox-check');
  });

  it('classifies the not-provisioned gate message distinctly', () => {
    expect(classifyGateMessage(NOT_PROVISIONED_MSG)).toBe('not-provisioned');
  });

  it('classifies better-auth stock "signup disabled" wording as not-invited (the disableSignUp callback path)', () => {
    expect(classifyGateMessage('signup disabled')).toBe('not-invited');
  });

  it('classifies the gate stray-identity message ("not been invited") as not-invited, NOT banned', () => {
    expect(classifyGateMessage(STRAY_INVITED_MISSING_MSG)).toBe('not-invited');
    expect(STRAY_INVITED_MISSING_MSG).toBe(NOT_INVITED_MSG); // single source of truth for the login banner copy
  });

  it('keeps genuine ban messages classified as banned', () => {
    expect(classifyGateMessage('Access denied. Your account has been banned.')).toBe('banned');
    expect(classifyGateMessage('Banned for abuse by admin')).toBe('banned');
  });

  it('returns null for ordinary sign-in errors', () => {
    expect(classifyGateMessage('Invalid credentials')).toBeNull();
    expect(classifyGateMessage('Google sign-in failed. Try again or use your password.')).toBeNull();
    expect(classifyGateMessage('')).toBeNull();
  });
});

describe('oidcParamBanner', () => {
  it('renders the success banner for link-verified', () => {
    expect(oidcParamBanner('link-verified')).toEqual({ tone: 'success', text: OIDC_LINK_VERIFIED_TEXT });
  });

  it('renders the info banner for link-expired', () => {
    expect(oidcParamBanner('link-expired')).toEqual({ tone: 'info', text: OIDC_LINK_FAILED_TEXT });
  });

  it('treats unknown values (e.g. legacy inbox-check) as the info banner', () => {
    const banner = oidcParamBanner('inbox-check');
    expect(banner?.tone).toBe('info');
    expect(banner?.text).toBe(OIDC_LINK_FAILED_TEXT);
  });

  it('returns null when the param is absent', () => {
    expect(oidcParamBanner(null)).toBeNull();
    expect(oidcParamBanner('')).toBeNull();
  });
});

describe('resolveSameOriginTarget', () => {
  const origin = 'http://localhost:3000';

  it('accepts relative paths from the portal', () => {
    expect(resolveSameOriginTarget('/dashboard', origin)).toBe('/dashboard');
    expect(resolveSameOriginTarget('/', origin)).toBe('/');
    expect(resolveSameOriginTarget('/dashboard?x=1', origin)).toBe('/dashboard?x=1');
  });

  it('rejects absolute forms (even same-origin) — only relative paths ship', () => {
    expect(resolveSameOriginTarget('http://localhost:3000/dashboard', origin)).toBe('/');
  });

  it('rejects cross-origin and protocol-relative targets', () => {
    expect(resolveSameOriginTarget('https://evil.example/x', origin)).toBe('/');
    expect(resolveSameOriginTarget('//evil.example/x', origin)).toBe('/');
  });

  it('falls back to home for null/unparseable input', () => {
    expect(resolveSameOriginTarget(null, origin)).toBe('/');
  });
});

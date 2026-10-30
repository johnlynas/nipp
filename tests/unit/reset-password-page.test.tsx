/**
 * @vitest-environment jsdom
 * Unit tests: /auth/reset-password page (Phase 4.3).
 *
 * Pins the token lifecycle contract against the Phase 3 routes:
 *   - on mount GET verify decides loading → form vs invalid state;
 *   - the token is stripped from the URL after verification (one-shot param
 *     idiom — it must not persist in history, design T12);
 *   - client-side guards (mismatch / length) block submit before any POST;
 *   - POST success → brief confirmation then router.push('/login?password_reset=1');
 *   - server rejection copy (400/401/403) surfaces verbatim in the alert.
 *
 * Async settles use testing-library's findBy* (polling) rather than manual
 * flushes — the verify handler is fetch().then(async res => await res.json())
 * and several hops land before the form mounts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));

// One stable router object — the real next/navigation hook returns a stable
// instance across renders; a fresh object per render would re-run effects.
const STABLE_ROUTER = { push: nav.push, replace: nav.replace };

vi.mock('next/navigation', () => ({
  useRouter: () => STABLE_ROUTER,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import ResetPasswordPage from '@/app/auth/reset-password/page';

const OK_VERIFY = { valid: true, expiresInSeconds: 3600 };

function apiStub(stub: Record<string, [number, Record<string, unknown>]>) {
  const fn = vi.fn(async (url: string | URL | Request, options: RequestInit = {}) => {
    const u = String(url);
    const key = Object.keys(stub).find((k) => u.includes(k));
    if (!key) return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    const [status, body] = stub[key];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Wait until the verify round-trip has resolved to a form (or invalid) render. */
function openForm() {
  render(<ResetPasswordPage />);
  return screen.findByLabelText('New password');
}

describe('/auth/reset-password page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nav.search = '';
  });

  it('no token → invalid state (verify says missing) and URL is left clean', async () => {
    const fetchMock = apiStub({ '/api/auth/password-reset/verify': [200, { valid: false, reason: 'missing' }] });
    render(<ResetPasswordPage />);

    expect(screen.getByRole('status')).toHaveTextContent(/checking your reset link/i);
    await screen.findByText(/link no longer valid/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Invalid state renders the "no longer valid" card + CTA:
    expect(screen.getAllByText(/email me a new link/i).length).toBeGreaterThan(0);
  });

  it('verify invalid-or-expired → "Link no longer valid" + CTA to forgot-password', async () => {
    apiStub({ '/api/auth/password-reset/verify': [200, { valid: false, reason: 'invalid-or-expired' }] });
    nav.search = 'token=dead';
    render(<ResetPasswordPage />);
    await screen.findByText(/link no longer valid/i);

    const cta = screen.getByRole('button', { name: /email me a new link/i }) as HTMLButtonElement;
    fireEvent.click(cta);
    expect(nav.push).toHaveBeenCalledWith('/auth/forgot-password');
  });

  it('verify succeeds → form with two password fields + visibility toggles, and token stripped from URL', async () => {
    apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [200, { success: true, message: 'Password updated' }],
    });
    nav.search = 'token=tok123';

    const newPw = await openForm();
    expect(newPw).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Confirm new password')).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: /show new password/i })).toBeInTheDocument();

    // One-shot consumption (T12): the replace call must not carry the token.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledTimes(1));
    const replaces = nav.replace.mock.calls.map((c) => String(c[0]));
    expect(replaces.every((u) => !u.includes('token='))).toBe(true);

    fireEvent.change(newPw, { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    expect(screen.getByRole('button', { name: /update password/i })).toBeEnabled();
  });

  it('mismatch blocks submit — inline error, no POST; typing clears it', async () => {
    const fetchMock = apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [200, { success: true }],
    });
    nav.search = 'token=tok123';

    fireEvent.change(await openForm(), { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'other!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    const posts = fetchMock.mock.calls.filter(([, o]) => String(o?.method).toUpperCase() === 'POST');
    expect(posts.length).toBe(0);

    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    await act(async () => {}); // submit() clears the error on its next run — nothing pending here; just settle
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('short password (<8) blocks submit client-side with the length hint', async () => {
    const fetchMock = apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [200, { success: true }],
    });
    nav.search = 'token=tok123';

    fireEvent.change(await openForm(), { target: { value: 'short' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 8 characters/i);
    const posts = fetchMock.mock.calls.filter(([, o]) => String(o?.method).toUpperCase() === 'POST');
    expect(posts.length).toBe(0);
  });

  it('success → "Password updated" then push /login?password_reset=1 with the POST body intact', async () => {
    const fetchMock = apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [200, { success: true, message: 'Password updated' }],
    });
    nav.search = 'token=tok123';

    fireEvent.change(await openForm(), { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    // 900ms confirmation window before the navigation (real timers + poll).
    await screen.findByText(/password updated/i);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/login?password_reset=1'), { timeout: 3000 });

    const posts = fetchMock.mock.calls.filter(([, o]) => String(o?.method).toUpperCase() === 'POST');
    expect(posts.length).toBe(1);
    const [, opts] = posts[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toEqual({ newPassword: 'S3cretpass!', token: 'tok123' });
  });

  it('server rejection (400 replay) surfaces the server message verbatim', async () => {
    apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [400, { error: 'Invalid or expired reset link.' }],
    });
    nav.search = 'token=replay';

    fireEvent.change(await openForm(), { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await screen.findByText(/invalid or expired reset link/i);
  });

  it('server rejection (401 banned at mutation) surfaces the ban copy', async () => {
    apiStub({
      '/api/auth/password-reset/verify': [200, OK_VERIFY],
      '/api/auth/password-reset/reset': [401, { error: 'Access denied. Your account has been banned.' }],
    });
    nav.search = 'token=banned';

    fireEvent.change(await openForm(), { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    await screen.findByText(/access denied/i);
  });

  it('network failure during submit → recovery copy, form stays', async () => {
    // Verify succeeds; only the reset POST throws (request never reached the server).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, options: RequestInit = {}) => {
        if (String(url).includes('/api/auth/password-reset/verify')) {
          return new Response(JSON.stringify(OK_VERIFY), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        throw new TypeError('failed to fetch');
      }),
    );
    nav.search = 'token=tok123';

    fireEvent.change(await openForm(), { target: { value: 'S3cretpass!' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'S3cretpass!' } });
    fireEvent.click(screen.getByRole('button', { name: /update password/i }));

    expect(await screen.findByText(/couldn.t reach/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });
});

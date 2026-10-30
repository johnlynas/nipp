/**
 * @vitest-environment jsdom
 * Unit tests: /auth/forgot-password page (Phase 4.2).
 *
 * Pins the no-oracle copy discipline (identical success card for known and
 * unknown emails), client-side email pre-check (no fetch on invalid input),
 * the ?expired=1 one-shot warning variant, the resend cooldown, and banner
 * mapping for server rejections (401 ban / 429 throttle / network failure).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const nav = vi.hoisted(() => ({
  search: '',
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import ForgotPasswordPage from '@/app/auth/forgot-password/page';

type FetchMock = ReturnType<typeof vi.fn>;

function postResponses(routes: Record<string, [number, Record<string, unknown>]>) {
  const fn = vi.fn(async (url: string | URL | Request, options: RequestInit = {}) => {
    const u = String(url);
    if (u.includes('/api/auth/password-reset') && (options.method ?? 'GET').toUpperCase() === 'POST') {
      const [status, body] = routes['/api/auth/password-reset'];
      return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function submit(email: string) {
  fireEvent.change(screen.getByLabelText('User ID'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: /email me a reset link/i }));
}

describe('/auth/forgot-password page', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    nav.search = '';
  });

  it('renders the email form with heading and Back-to-sign-in affordance on load', () => {
    postResponses({ '/api/auth/password-reset': [200, { status: true, message: 'ok' }] });
    render(<ForgotPasswordPage />);
    expect(screen.getByText(/reset your password/i)).toBeInTheDocument();
    expect(screen.getByLabelText('User ID')).toHaveAttribute('type', 'email');
    expect(screen.getByRole('button', { name: /email me a reset link/i })).toBeEnabled();
  });

  it('blocks empty and invalid emails client-side — no fetch, inline error names the fix', () => {
    const fetchMock = postResponses({ '/api/auth/password-reset': [200, { status: true }] });
    render(<ForgotPasswordPage />);

    fireEvent.click(screen.getByRole('button', { name: /email me a reset link/i }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);

    submit('not-an-email');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/valid email/i);
  });

  it('POST 200 → idempotent success card ("if this account exists") + Back to sign in; form is gone', async () => {
    const fetchMock = postResponses({ '/api/auth/password-reset': [200, { status: true, message: 'ok' }] });
    render(<ForgotPasswordPage />);
    submit('John@Example.com');

    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(opts.body))).toEqual({ email: 'john@example.com' });

    // No-oracle copy — identical for known and unknown emails.
    expect(screen.getByText(/check your inbox/i)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/if this account exists/i);
    expect(screen.queryByLabelText('User ID')).not.toBeInTheDocument();
    const back = screen.getByRole('link', { name: /back to sign in/i });
    fireEvent.click(back);
    expect(nav.push).toHaveBeenCalledWith('/login');
  });

  it('resend is disabled with a countdown, then re-POSTs when the window closes', async () => {
    const fetchMock = postResponses({ '/api/auth/password-reset': [200, { status: true, message: 'ok' }] });
    vi.useFakeTimers();
    try {
      render(<ForgotPasswordPage />);
      submit('john@example.com');
      await act(async () => {});

      const resend = screen.getByRole('button', { name: /resend/i }) as HTMLButtonElement;
      expect(resend).toBeDisabled();
      expect(resend).toHaveTextContent(/60s/);

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(screen.getByRole('button', { name: /^email me a new link$/i })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: /^email me a new link$/i }));
      await act(async () => {});
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('?expired=1 renders the expired warning variant on load and strips the param', async () => {
    nav.search = 'expired=1';
    postResponses({ '/api/auth/password-reset': [200, { status: true }] });
    render(<ForgotPasswordPage />);
    await act(async () => {});

    expect(screen.getByRole('status')).toHaveTextContent(/expired or is invalid/i);
    // One-shot: param stripped so a refresh doesn't re-announce.
    const replaceCalls = nav.replace.mock.calls.map((c) => String(c[0]));
    expect(replaceCalls.some((u) => !u.includes('expired='))).toBe(true);
  });

  it('401 banned → banner surfaces the server message', async () => {
    postResponses({ '/api/auth/password-reset': [401, { error: 'Access denied. Your account has been banned.' }] });
    render(<ForgotPasswordPage />);
    submit('john@example.com');
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(/access denied/i);
    // Form stays for the admin-contact path below it.
    expect(screen.getByLabelText('User ID')).toBeInTheDocument();
  });

  it('429 → banner carries the throttle copy, form untouched', async () => {
    postResponses({ '/api/auth/password-reset': [429, { error: 'Too many requests — try again in a minute.' }] });
    render(<ForgotPasswordPage />);
    submit('john@example.com');
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(/too many requests/i);
  });

  it('network failure → recovery copy (not raw text)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('failed to fetch'); }));
    render(<ForgotPasswordPage />);
    submit('john@example.com');
    await act(async () => {});

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn.t reach/i);
  });

  it('a second valid submit clears a previous banner', async () => {
    const fetchMock = postResponses({ '/api/auth/password-reset': [429, { error: 'Too many requests — try again in a minute.' }] });
    render(<ForgotPasswordPage />);
    submit('john@example.com');
    await act(async () => {});
    expect(screen.getByRole('alert')).toBeInTheDocument();

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify({ status: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    submit('john@example.com');
    await act(async () => {});
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // first attempt only — second used fresh stub
  });
});

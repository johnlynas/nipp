/**
 * @vitest-environment jsdom
 * Unit tests for lib/auth-client.ts — BetterAuth client wrapper.
 *
 * Mocks:
 *  - better-auth/client            → createAuthClient factory + authClient methods
 *  - ./payload-key-manager         → clearPayloadKey
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

// Captured at module-load time (before beforeEach clears any mock call logs).
// Must live inside vi.hoisted — the mocked factories execute during import,
// before plain `let` declarations in this file are initialised.
const {
  captured,
  mockSessionAtomGet,
  mockSessionAtomSubscribe,
  mockSignInEmail,
  mockSignOut,
  mockClearPayloadKey,
} = vi.hoisted(() => ({
  captured: { clientConfig: undefined as unknown, organizationCall: undefined as Record<string, unknown> | undefined },
  mockSessionAtomGet: vi.fn(),
  mockSessionAtomSubscribe: vi.fn(),
  mockSignInEmail: vi.fn(),
  mockSignOut: vi.fn(),
  mockClearPayloadKey: vi.fn(),
}));

vi.mock('better-auth/client', () => ({
  createAuthClient: (config: unknown) => {
    captured.clientConfig = config;
    return {
      useSession: {
        get: mockSessionAtomGet,
        subscribe: mockSessionAtomSubscribe,
      },
      signIn: { email: mockSignInEmail },
      signOut: mockSignOut,
    };
  },
}));

vi.mock('better-auth/client/plugins', () => ({
  organizationClient: (opts: Record<string, unknown>) => {
    captured.organizationCall = opts;
    return {};
  },
}));

vi.mock('@/lib/payload-key-manager', async (importOriginal) => {
  // Keep the real module shape; only swap the stateful function.
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, clearPayloadKey: (...args: unknown[]) => mockClearPayloadKey(...args) };
});

import { authClient, useSession, signInEmail, signOutUser } from '@/lib/auth-client';

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

let cookieWrites: string[];

function resetCookieCapture() {
  cookieWrites = [];
  vi.spyOn(document, 'cookie', 'set').mockImplementation((value: string) => {
    cookieWrites.push(value);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCookieCapture();
  // Default: no session yet.
  mockSessionAtomGet.mockReturnValue({ data: null, error: null, isPending: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Module-level client construction
// ---------------------------------------------------------------------------

describe('authClient', () => {
  it('is created via createAuthClient with exactly one plugin (organization)', () => {
    const config = captured.clientConfig as { plugins: unknown[] };
    expect(config).toBeDefined();
    expect(config.plugins).toHaveLength(1);
  });

  it('enables teams mode on the organization client plugin', () => {
    expect(captured.organizationCall?.teams).toEqual({ enabled: true });
  });

  it('exposes the expected client surface used by the rest of the app', () => {
    expect(authClient.useSession.get).toBe(mockSessionAtomGet);
    expect(authClient.signIn.email).toBe(mockSignInEmail);
    expect(authClient.signOut).toBe(mockSignOut);
  });
});

// ---------------------------------------------------------------------------
// useSession hook
// ---------------------------------------------------------------------------

describe('useSession', () => {
  it('reports loading=true while the session atom is pending', () => {
    mockSessionAtomGet.mockReturnValue({ data: null, error: null, isPending: true });

    const { result } = renderHook(() => useSession());
    expect(result.current).toEqual({ data: null, loading: true });
  });

  it('reports the session data when available', () => {
    mockSessionAtomGet.mockReturnValue({
      data: { session: { token: 'tok' }, user: { id: 'u1', email: 'a@b.c' } },
      error: null,
      isPending: false,
    });

    const { result } = renderHook(() => useSession());
    expect(result.current.loading).toBe(false);
    expect((result.current.data as { user: { id: string } }).user.id).toBe('u1');
  });

  it('normalises a missing data payload to null (not undefined)', () => {
    mockSessionAtomGet.mockReturnValue({ data: null, error: null, isPending: false });

    const { result } = renderHook(() => useSession());
    expect(result.current.data).toBeNull();
  });

  it('subscribes the atom and reacts to updates', async () => {
    mockSessionAtomGet.mockReturnValue({ data: null, error: null, isPending: true });
    let notify: (() => void) | undefined;
    mockSessionAtomSubscribe.mockImplementation((cb: () => void) => {
      notify = cb;
      return () => {};
    });

    const { result } = renderHook(() => useSession());
    expect(result.current.loading).toBe(true);
    expect(mockSessionAtomSubscribe).toHaveBeenCalledTimes(1);

    mockSessionAtomGet.mockReturnValue({
      data: { session: { token: 'tok2' } },
      error: null,
      isPending: false,
    });
    act(() => {
      notify?.();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).not.toBeNull();
  });

  it('handles a subscribe callback that never returns an unsubscribe without erroring', () => {
    mockSessionAtomSubscribe.mockImplementation((() => {}) as unknown as typeof mockSessionAtomSubscribe);
    expect(() => renderHook(() => useSession())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// signInEmail
// ---------------------------------------------------------------------------

describe('signInEmail', () => {
  it('returns { success: true } when there is no error', async () => {
    mockSignInEmail.mockResolvedValue({ data: {}, error: null });

    await expect(signInEmail('user@example.com', 'hunter2')).resolves.toEqual({ success: true });
    expect(mockSignInEmail).toHaveBeenCalledWith({ email: 'user@example.com', password: 'hunter2' });
  });

  it('surfaces the error message when sign-in fails', async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: { message: 'Invalid credentials.' } });

    await expect(signInEmail('user@example.com', 'nope')).resolves.toEqual({
      error: 'Invalid credentials.',
    });
  });

  it('falls back to a generic message when the error has no message', async () => {
    mockSignInEmail.mockResolvedValue({ data: null, error: {} });

    await expect(signInEmail('user@example.com', 'nope')).resolves.toEqual({
      error: 'Invalid credentials',
    });
  });
});

// ---------------------------------------------------------------------------
// signOutUser
// ---------------------------------------------------------------------------

describe('signOutUser', () => {
  it('revokes the server-side payload key, signs out, clears the client key and session cookies on success', async () => {
    const calls: Array<{ fetchOptions?: { onSuccess?: () => void } }> = [];
    mockSignOut.mockImplementation((opts: { fetchOptions?: { onSuccess?: () => void } }) => {
      calls.push(opts);
      return Promise.resolve({ data: null, error: null });
    });

    const globalFetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(signOutUser()).resolves.toEqual({ success: true });

    // Step 1: best-effort server-side revocation.
    expect(globalFetchSpy).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).toHaveBeenCalledWith('/api/security/payload-key/revoke', { method: 'POST' });

    // authClient.signOut must be wired with an onSuccess cleanup callback.
    expect(calls.length).toBe(1);
    expect(typeof calls[0].fetchOptions?.onSuccess).toBe('function');

    // Simulate the transport reporting success — the callback must perform
    // the client-side cleanup (steps 2 + 3).
    act(() => {
      calls[0].fetchOptions!.onSuccess!();
    });

    expect(mockClearPayloadKey).toHaveBeenCalledTimes(1);
    expect(cookieWrites.length).toBeGreaterThanOrEqual(4);
    for (const variant of [
      '__Secure-better-auth.session_token',
      'better-auth.session_token',
      '__Secure-better-auth-session_token',
      'better-auth-session_token',
    ]) {
      expect(cookieWrites.some((c) => c.startsWith(`${variant}=;`))).toBe(true);
    }
  });

  it('succeeds even when the revocation endpoint is unavailable (non-fatal)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('endpoint missing')));
    mockSignOut.mockResolvedValue({ data: null, error: null });

    await expect(signOutUser()).resolves.toEqual({ success: true });
    vi.unstubAllGlobals();
  });

  it('succeeds even when the revocation endpoint errors with a non-2xx status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('nope', { status: 404 })),
    );
    mockSignOut.mockResolvedValue({ data: null, error: null });

    await expect(signOutUser()).resolves.toEqual({ success: true });
    vi.unstubAllGlobals();
  });

  it('skips client-side cleanup entirely when the BetterAuth signOut fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    // Simulates a failed signOut: the transport never invokes onSuccess.
    mockSignOut.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'boom' } }));

    await expect(signOutUser()).resolves.toEqual({ error: 'boom' });

    expect(mockClearPayloadKey).not.toHaveBeenCalled();
    expect(cookieWrites.length).toBe(0);
  });

  it('returns the error message when signOut fails with an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    mockSignOut.mockResolvedValue({ data: null, error: { message: 'Session already expired' } });

    await expect(signOutUser()).resolves.toEqual({ error: 'Session already expired' });
    vi.unstubAllGlobals();
  });

  it('falls back to a generic message when the signOut error has no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    mockSignOut.mockResolvedValue({ data: null, error: {} });

    await expect(signOutUser()).resolves.toEqual({ error: 'Sign out failed' });
    vi.unstubAllGlobals();
  });
});

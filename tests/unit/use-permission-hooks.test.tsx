/**
 * @vitest-environment jsdom
 */

/**
 * Unit tests for hooks/usePermission.ts — client-side permission hooks.
 *
 * Both dependencies (auth session + React Query permissions) are mocked so we
 * can exercise every branch: the session "fast path" and the query-cache
 * "slow path" (loading vs loaded), for each hook.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted so instances exist before imports evaluate.
// useSession comes from a mock of @/lib/auth-client (avoids pulling in
// better-auth client). usePermissions is the real hook from
// features/permissions/api, with its transport (@/lib/api-client) mocked.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  let sessionData: unknown = null;
  const setSession = (data: unknown) => {
    sessionData = data;
  };
  return {
    setSession,
    getSessionData: () => sessionData,
    mockUseSession: vi.fn((() => ({ data: sessionData, loading: false })) as () => { data: unknown; loading: boolean }),
    mockEncryptedFetch: vi.fn(),
  };
});

vi.mock('@/lib/auth-client', () => ({
  useSession: mocks.mockUseSession,
}));

// Keep the mock's returned object reference-stable between renders so React
// Query does not see a "changed" session on every re-render. This matters
// for useSyncExternalStore-like consumers; here it simply keeps semantics
// predictable while we flip the underlying value via setSession().
const stableSessionResult = () => {
  mocks.mockUseSession.mockReset();
  mocks.mockUseSession.mockImplementation(() => ({ data: mocks.getSessionData(), loading: false }));
};

vi.mock('@/lib/api-client', () => ({
  encryptedFetch: (...args: unknown[]) => mocks.mockEncryptedFetch(...args),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  usePermission,
  useAnyPermission,
  useIsSuperAdmin,
  useHasPermission,
  useAllPermissions,
} from '@/hooks/usePermission';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// usePermission / useHasPermission
// ---------------------------------------------------------------------------

describe('usePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSessionResult();
    mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));
  });

  describe('fast path — session carries permissions', () => {
    it('returns true when the session has the permission', () => {
      mocks.setSession({ user: { permissions: ['logs:view', 'users:manage'] } });

      const { result } = renderHook(() => usePermission('logs:view'), { wrapper: makeWrapper() });

      expect(result.current).toBe(true);
    });

    it('returns false when the session lacks the permission', () => {
      mocks.setSession({ user: { permissions: ['logs:view'] } });

      const { result } = renderHook(() => usePermission('users:manage'), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
    });

    it('does not consult the query cache when session permissions exist', async () => {
      // Query returns a DIFFERENT set — if the hook wrongly waited on the
      // query result, 'users:manage' (in query, not in session) would appear.
      mocks.setSession({ user: { permissions: ['logs:view'] } });
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['users:manage']));

      const { result } = renderHook(() => usePermission('users:manage'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(false));
    });
  });

  describe('slow path — no session permissions, use query cache', () => {
    it('returns false while the permissions query is loading', () => {
      mocks.setSession({ user: { email: 'x@y.z' } }); // user present, no permissions key
      let release!: (v: Response) => void;
      mocks.mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = renderHook(() => usePermission('logs:view'), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
      release(jsonResponse(['logs:view'])); // resolve to keep teardown clean
    });

    it('returns true once the query has loaded and includes the permission', async () => {
      mocks.setSession({ user: { email: 'x@y.z' } });
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['org:manage']));

      const { result } = renderHook(() => usePermission('org:manage'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('returns false when the query loaded but lacks the permission', async () => {
      mocks.setSession({ user: { email: 'x@y.z' } });
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['logs:view']));

      const { result } = renderHook(() => usePermission('org:manage'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(false));
    });
  });

  describe('no session at all', () => {
    it('falls back to the query cache result when session is null', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['logs:view']));

      const { result } = renderHook(() => usePermission('logs:view'), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('returns false with no session and no loaded permissions', () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));

      const { result } = renderHook(() => usePermission('anything'), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
    });
  });
});

describe('useHasPermission (alias of usePermission)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSessionResult();
    mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));
  });

  it('behaves identically to usePermission', async () => {
    mocks.setSession({ user: { permissions: ['a:b'] } });

    const { result } = renderHook(() => useHasPermission('a:b'), { wrapper: makeWrapper() });

    expect(result.current).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// useAnyPermission
// ---------------------------------------------------------------------------

describe('useAnyPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSessionResult();
    mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));
  });

  describe('fast path — session carries permissions', () => {
    it('returns true when ANY candidate is in session permissions (OR logic)', () => {
      mocks.setSession({ user: { permissions: ['org:manage'] } });

      const { result } = renderHook(
        () => useAnyPermission(['logs:view', 'org:manage']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(true);
    });

    it('returns false when NONE of the candidates are in session permissions', () => {
      mocks.setSession({ user: { permissions: ['logs:view'] } });

      const { result } = renderHook(
        () => useAnyPermission(['org:manage', 'users:manage']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(false);
    });

    it('returns false for an empty candidate list against populated permissions', () => {
      mocks.setSession({ user: { permissions: ['logs:view'] } });

      const { result } = renderHook(() => useAnyPermission([]), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
    });
  });

  describe('slow path — query cache', () => {
    it('returns false while the permissions query is loading', () => {
      mocks.setSession(null);
      let release!: (v: Response) => void;
      mocks.mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = renderHook(
        () => useAnyPermission(['a']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(false);
      release(jsonResponse([]));
    });

    it('returns true once loaded with a matching permission', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['users:manage']));

      const { result } = renderHook(
        () => useAnyPermission(['logs:view', 'users:manage']),
        { wrapper: makeWrapper() },
      );

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('returns false once loaded with no matches', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['logs:view']));

      const { result } = renderHook(
        () => useAnyPermission(['a:b', 'c:d']),
        { wrapper: makeWrapper() },
      );

      await waitFor(() => expect(result.current).toBe(false));
    });
  });
});

// ---------------------------------------------------------------------------
// useIsSuperAdmin
// ---------------------------------------------------------------------------

describe('useIsSuperAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSessionResult();
    mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));
  });

  describe('fast path — session carries isSuperAdmin flag', () => {
    it('returns true when the session says super admin', () => {
      mocks.setSession({ user: { isSuperAdmin: true } });

      const { result } = renderHook(() => useIsSuperAdmin(), { wrapper: makeWrapper() });

      expect(result.current).toBe(true);
    });

    it('returns false when the session explicitly says not super admin', () => {
      mocks.setSession({ user: { isSuperAdmin: false, permissions: ['*'] } });

      const { result } = renderHook(() => useIsSuperAdmin(), { wrapper: makeWrapper() });

      // The flag short-circuits the '*' wildcard check.
      expect(result.current).toBe(false);
    });
  });

  describe('slow path — no flag in session, check query cache', () => {
    it('returns null while the permissions query is loading', () => {
      mocks.setSession({ user: { email: 'x@y.z' } });
      let release!: (v: Response) => void;
      mocks.mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = renderHook(() => useIsSuperAdmin(), { wrapper: makeWrapper() });

      expect(result.current).toBeNull();
      release(jsonResponse([]));
    });

    it('returns true when the loaded permissions include the "*" wildcard', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['*']));

      const { result } = renderHook(() => useIsSuperAdmin(), { wrapper: makeWrapper() });

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('returns false when the loaded permissions lack the "*" wildcard', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['logs:view', 'org:manage']));

      const { result } = renderHook(() => useIsSuperAdmin(), { wrapper: makeWrapper() });

      await waitFor(() => expect(result.current).toBe(false));
    });
  });
});

// ---------------------------------------------------------------------------
// useAllPermissions
// ---------------------------------------------------------------------------

describe('useAllPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableSessionResult();
    mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse([]));
  });

  describe('fast path', () => {
    it('returns true immediately for a session super admin, regardless of permissions', () => {
      mocks.setSession({ user: { isSuperAdmin: true } });

      const { result } = renderHook(
        () => useAllPermissions(['a:b', 'c:d']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(true);
    });

    it('returns true when every required permission is in session permissions (AND logic)', () => {
      mocks.setSession({ user: { permissions: ['logs:view', 'users:manage'] } });

      const { result } = renderHook(
        () => useAllPermissions(['logs:view', 'users:manage']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(true);
    });

    it('returns false when any required permission is missing from session permissions', () => {
      mocks.setSession({ user: { permissions: ['logs:view'] } });

      const { result } = renderHook(
        () => useAllPermissions(['logs:view', 'users:manage']),
        { wrapper: makeWrapper() },
      );

      expect(result.current).toBe(false);
    });

    it('returns false for a non-super-admin with empty session permissions', () => {
      mocks.setSession({ user: { isSuperAdmin: false, permissions: [] } });

      const { result } = renderHook(() => useAllPermissions(['a:b']), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
    });
  });

  describe('slow path — no session info, query cache', () => {
    it('returns false while the permissions query is loading', () => {
      mocks.setSession(null);
      let release!: (v: Response) => void;
      mocks.mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = renderHook(() => useAllPermissions(['a:b']), { wrapper: makeWrapper() });

      expect(result.current).toBe(false);
      release(jsonResponse([]));
    });

    it('returns true once loaded with all required permissions present', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['a:b', 'c:d', 'e:f']));

      const { result } = renderHook(() => useAllPermissions(['a:b', 'e:f']), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(true));
    });

    it('returns false once loaded when one permission is missing', async () => {
      mocks.setSession(null);
      mocks.mockEncryptedFetch.mockResolvedValue(jsonResponse(['a:b']));

      const { result } = renderHook(() => useAllPermissions(['a:b', 'c:d']), {
        wrapper: makeWrapper(),
      });

      await waitFor(() => expect(result.current).toBe(false));
    });
  });
});

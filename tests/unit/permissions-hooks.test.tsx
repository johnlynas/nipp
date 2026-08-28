/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// --- Mock the transport layer ---
const mockEncryptedFetch = vi.fn();
vi.mock('@/lib/api-client', () => ({
  encryptedFetch: (...args: unknown[]) => mockEncryptedFetch(...args),
}));

const mockGlobalFetch = vi.fn();
vi.stubGlobal('fetch', mockGlobalFetch);

import {
  usePermissions,
  useHasPermission,
  useHasAnyPermission,
  useUserRoles,
} from '@/features/permissions/api/usePermissions';

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

describe('features/permissions/api/usePermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------
  // usePermissions
  // ------------------------------------------------------------------
  describe('usePermissions', () => {
    it('hits /api/auth/user-permissions with the pii flag', async () => {
      mockEncryptedFetch.mockResolvedValue(jsonResponse(['logs:view']));
      const wrapper = makeWrapper();

      const { result } = renderHook(() => usePermissions(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockEncryptedFetch).toHaveBeenCalledTimes(1);
      expect(mockEncryptedFetch).toHaveBeenCalledWith('/api/auth/user-permissions', {
        pii: true,
      });
      expect(result.current.data).toEqual(['logs:view']);
    });

    it('throws when the backend responds with an error status', async () => {
      mockEncryptedFetch.mockResolvedValue(new Response('server exploded', { status: 500 }));
      const wrapper = makeWrapper();

      const { result } = renderHook(() => usePermissions(), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error?.message).toBe(
        'Failed to fetch permissions from the backend'
      );
    });
  });

  // ------------------------------------------------------------------
  // useHasPermission (AND logic)
  // ------------------------------------------------------------------
  describe('useHasPermission', () => {
    function setup(perms: string[], required: string[]) {
      mockEncryptedFetch.mockResolvedValue(jsonResponse(perms));
      const wrapper = makeWrapper();
      return renderHook(() => useHasPermission(required), { wrapper });
    }

    it('returns undefined while the query is loading', () => {
      let release: (v: Response) => void;
      mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        })
      );
      const wrapper = makeWrapper();

      const { result } = renderHook(() => useHasPermission(['logs:view']), {
        wrapper,
      });

      expect(result.current).toBeUndefined();
      expect(mockEncryptedFetch).toHaveBeenCalledTimes(1);

      // Unblocking the query must not throw; just resolve it to keep teardown clean.
      release!(jsonResponse([]));
    });

    it('grants access when every required permission is present', async () => {
      const { result } = setup(['logs:view', 'users:manage'], ['logs:view', 'users:manage']);
      await waitFor(() => expect(result.current).toBe(true));
      expect(result.current).toBe(true);
    });

    it('denies access when any required permission is missing (AND logic)', async () => {
      const { result } = setup(['logs:view'], ['logs:view', 'users:manage']);
      await waitFor(() => expect(result.current).toBe(false));
      expect(result.current).toBe(false);
    });

    it('grants access for the wildcard "*" permission', async () => {
      const { result } = setup(['*'], ['anything:at-all']);
      await waitFor(() => expect(result.current).toBe(true));
      expect(result.current).toBe(true);
    });

    it('denies when nothing is granted and nothing matches', async () => {
      const { result } = setup([], ['logs:view']);
      await waitFor(() => expect(result.current === undefined ? false : true).toBe(true));
      expect(result.current).toBe(false);
    });
  });

  // ------------------------------------------------------------------
  // useHasAnyPermission (OR logic)
  // ------------------------------------------------------------------
  describe('useHasAnyPermission', () => {
    function setup(perms: string[], required: string[]) {
      mockEncryptedFetch.mockResolvedValue(jsonResponse(perms));
      const wrapper = makeWrapper();
      return renderHook(() => useHasAnyPermission(required), { wrapper });
    }

    it('returns undefined while the query is loading', () => {
      let release: (v: Response) => void;
      mockEncryptedFetch.mockReturnValue(
        new Promise<Response>((resolve) => {
          release = resolve;
        })
      );
      const wrapper = makeWrapper();

      const { result } = renderHook(() => useHasAnyPermission(['logs:view']), {
        wrapper,
      });

      expect(result.current).toBeUndefined();
      release!(jsonResponse([]));
    });

    it('grants access when at least ONE required permission is present (OR logic)', async () => {
      const { result } = setup(['users:manage'], ['logs:view', 'users:manage']);
      await waitFor(() => expect(result.current).toBe(true));
      expect(result.current).toBe(true);
    });

    it('denies access when NONE of the required permissions are present', async () => {
      const { result } = setup(['logs:view'], ['org:manage', 'users:manage']);
      await waitFor(() => expect(result.current === undefined ? false : true).toBe(true));
      expect(result.current).toBe(false);
    });

    it('grants access via the wildcard "*" permission', async () => {
      const { result } = setup(['*'], ['org:manage', 'users:manage']);
      await waitFor(() => expect(result.current).toBe(true));
      expect(result.current).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // useUserRoles
  // ------------------------------------------------------------------
  describe('useUserRoles', () => {
    it('fetches /api/auth/user-roles and returns the role list', async () => {
      mockGlobalFetch.mockResolvedValue(jsonResponse(['manager', 'viewer']));
      const wrapper = makeWrapper();

      const { result } = renderHook(() => useUserRoles(), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(mockGlobalFetch).toHaveBeenCalledTimes(1);
      expect(mockGlobalFetch).toHaveBeenCalledWith('/api/auth/user-roles');
      expect(result.current.data).toEqual(['manager', 'viewer']);
    });
  });
});

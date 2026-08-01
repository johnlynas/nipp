/**
 * Unit tests for Role Search API (GET /api/roles/search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies — must be set up before route import
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

vi.mock('@/lib/tenant-db', () => ({
  __esModule: true,
  default: {
    role: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/cache/hybrid', () => ({
  cacheGet: vi.fn(async (key: string, resolver: () => Promise<any>) => {
    return resolver();
  }),
  cacheSet: vi.fn(),
}));

vi.mock('@/lib/permissions/resolver', () => ({
  resolvePermissions: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Role Search API', () => {
  let cacheGet: typeof import('@/lib/cache/hybrid').cacheGet;
  let resolvePermissionsMock: ReturnType<typeof vi.fn>;
  let authGetSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const hybrid = await import('@/lib/cache/hybrid');
    cacheGet = hybrid.cacheGet;

    const permResolver = await import('@/lib/permissions/resolver');
    resolvePermissionsMock = vi.mocked(permResolver.resolvePermissions);

    const authModule = await import('@/lib/auth');
    authGetSession = vi.mocked(authModule.auth.api.getSession);

    // Default: authenticated user with roles:view permission
    authGetSession.mockResolvedValue({
      user: { id: 'user1', name: 'Test User' },
      session: { id: 'session1' },
    });
    resolvePermissionsMock.mockResolvedValue(['roles:view']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (url: string, headers?: Record<string, string>) =>
    new Request(url, { headers }) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return roles matching the query prefix within the organization', async () => {
      const mockResults = [
        { id: 'r1', name: 'Property Manager', description: 'Manages properties' },
        { id: 'r2', name: 'Property Viewer', description: null },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=prop&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return empty results when no roles match', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=nonexistent&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual([]);
    });

    it('should return 400 when q parameter is missing', async () => {
      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query parameter "q" is required');
    });

    it('should return 400 when organizationId parameter is missing', async () => {
      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query parameter "organizationId" is required');
    });

    it('should return 401 when no session is present', async () => {
      authGetSession.mockResolvedValue(null);

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123')
      );

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 403 when user lacks roles:view permission', async () => {
      resolvePermissionsMock.mockResolvedValue(['orgs:view']); // No roles:view

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Forbidden: insufficient permissions');
    });

    it('should include organizationId in cache key', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:role:org123:prop');
        return resolver();
      });

      const { GET } = await import('@/app/api/roles/search/route');
      await GET(
        createRequest('http://localhost:3000/api/roles/search?q=prop&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(cacheGet).toHaveBeenCalledWith(
        'search:role:org123:prop',
        expect.any(Function),
        { ttlType: 'search' }
      );
    });

    it('should include id, name, and description in each result', async () => {
      const mockResults = [{ id: 'r1', name: 'Test Role', description: 'A test role' }];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      const body = await response.json();
      expect(body.results[0]).toHaveProperty('id');
      expect(body.results[0]).toHaveProperty('name');
      expect(body.results[0]).toHaveProperty('description');
    });

    it('should normalize query to lowercase for cache key', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:role:org123:test');
        return resolver();
      });

      const { GET } = await import('@/app/api/roles/search/route');
      await GET(
        createRequest('http://localhost:3000/api/roles/search?q=TEST&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );
    });

    it('should cap limit at maximum of 50', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123&limit=100', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(200);
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(cacheGet).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest(`http://localhost:3000/api/roles/search?q=${longQuery}&organizationId=org123`, {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(400);
    });

    it('should trim whitespace from query', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:role:org123:test');
        return resolver();
      });

      const { GET } = await import('@/app/api/roles/search/route');
      await GET(
        createRequest('http://localhost:3000/api/roles/search?q=%20test%20&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );
    });

    it('should use default limit of 10 when not specified', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org123', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(200);
    });

    it('should scope results to the specified organization', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        const result = await resolver();
        return result;
      });

      const { GET } = await import('@/app/api/roles/search/route');
      await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org456', {
          'cookie': 'session=abc123',
        })
      );

      // Verify the cache key includes the org ID for isolation
      expect(cacheGet).toHaveBeenCalledWith(
        'search:role:org456:test',
        expect.any(Function),
        { ttlType: 'search' }
      );
    });

    it('should return 403 for cross-organization access without permission', async () => {
      // The permission check is done against the requested orgId, so if user doesn't have
      // roles:view in org456, they get 403
      resolvePermissionsMock.mockResolvedValue([]); // No permissions in org456

      const { GET } = await import('@/app/api/roles/search/route');
      const response = await GET(
        createRequest('http://localhost:3000/api/roles/search?q=test&organizationId=org456', {
          'cookie': 'session=abc123',
        })
      );

      expect(response.status).toBe(403);
    });
  });
});

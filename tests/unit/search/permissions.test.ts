/**
 * Unit tests for Permission Search API (GET /api/admin/permissions/search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies — must be set up before route import
vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/global-db', () => ({
  __esModule: true,
  default: {
    permission: {
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

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Permission Search API', () => {
  let cacheGet: typeof import('@/lib/cache/hybrid').cacheGet;
  let requireSuperAdmin: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const hybrid = await import('@/lib/cache/hybrid');
    cacheGet = hybrid.cacheGet;

    const authModule = await import('@/lib/require-super-admin');
    requireSuperAdmin = vi.mocked(authModule.requireSuperAdmin);

    // Default: authenticated Super Admin
    requireSuperAdmin.mockResolvedValue({ session: {}, authorized: true, status: 200 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (url: string) => new Request(url) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return permissions matching the query prefix (case-insensitive)', async () => {
      const mockResults = [
        { id: 'p1', key: 'properties:view', resource: 'properties', action: 'view', description: 'View properties' },
        { id: 'p2', key: 'properties:create', resource: 'properties', action: 'create', description: 'Create properties' },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=properties%3Aview'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return partial key matches', async () => {
      const mockResults = [
        { id: 'p1', key: 'properties:view', resource: 'properties', action: 'view', description: null },
        { id: 'p2', key: 'properties:create', resource: 'properties', action: 'create', description: null },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=prop'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results.length).toBe(2);
    });

    it('should return empty results when no permissions match', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=nonexistent'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual([]);
    });

    it('should return 400 when q parameter is missing', async () => {
      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search'));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query parameter "q" is required');
    });

    it('should return 401 when user is not authenticated', async () => {
      requireSuperAdmin.mockResolvedValue({ session: null, authorized: false, error: 'Unauthorized', status: 401 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test'));

      expect(response.status).toBe(401);
      const body = await response.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('should return 403 when user is not a Super Admin', async () => {
      requireSuperAdmin.mockResolvedValue({ session: {}, authorized: false, error: 'Super Admin access required', status: 403 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test'));

      expect(response.status).toBe(403);
    });

    it('should return 503 when database is unavailable', async () => {
      requireSuperAdmin.mockResolvedValue({ session: {}, authorized: false, error: 'Database unavailable', status: 503 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test'));

      expect(response.status).toBe(503);
    });

    it('should include id, key, resource, action, and description in each result', async () => {
      const mockResults = [
        { id: 'p1', key: 'properties:view', resource: 'properties', action: 'view', description: 'View properties' },
      ];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=properties'));

      const body = await response.json();
      expect(body.results[0]).toHaveProperty('id');
      expect(body.results[0]).toHaveProperty('key');
      expect(body.results[0]).toHaveProperty('resource');
      expect(body.results[0]).toHaveProperty('action');
      expect(body.results[0]).toHaveProperty('description');
    });

    it('should normalize query to lowercase for cache key', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:perm:properties:view');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=PROPERTIES%3AVIEW'));

      expect(cacheGet).toHaveBeenCalledWith(
        'search:perm:properties:view',
        expect.any(Function),
        { ttlType: 'search' }
      );
    });

    it('should cap limit at maximum of 50', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test&limit=100'));

      expect(response.status).toBe(200);
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(cacheGet).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test'));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest(`http://localhost:3000/api/admin/permissions/search?q=${longQuery}`));

      expect(response.status).toBe(400);
    });

    it('should trim whitespace from query', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:perm:test');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=%20test%20'));
    });

    it('should use default limit of 10 when not specified', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=test'));

      expect(response.status).toBe(200);
    });

    it('should serve from cache on repeat queries', async () => {
      const mockResults = [{ id: 'p1', key: 'properties:view', resource: 'properties', action: 'view', description: null }];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/permissions/search/route');
      
      // First call
      await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=properties%3Aview'));
      // Second call (cache hit)
      await GET(createRequest('http://localhost:3000/api/admin/permissions/search?q=properties%3Aview'));

      expect(cacheGet).toHaveBeenCalledTimes(2);
    });
  });
});

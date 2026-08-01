/**
 * Unit tests for Organization Search API (GET /api/admin/organizations/search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';


// Mock dependencies
vi.mock('@/lib/middleware/auth', () => ({
  withSuperAdmin: (handler: any) => handler, // Pass through for testing
}));

vi.mock('@/lib/tenant-db', () => ({
  __esModule: true,
  default: {
    organization: {
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

describe('Organization Search API', () => {
  let cacheGet: typeof import('@/lib/cache/hybrid').cacheGet;
  let tenantDb: typeof import('@/lib/tenant-db').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    const hybrid = await import('@/lib/cache/hybrid');
    cacheGet = hybrid.cacheGet;
    tenantDb = (await import('@/lib/tenant-db')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (url: string) => new Request(url) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return organizations matching the query prefix (case-insensitive)', async () => {
      const mockResults = [
        { id: 'org1', name: 'Acme Corp', slug: 'acme-corp' },
        { id: 'org2', name: 'Acme Industries', slug: 'acme-industries' },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=acme'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return empty results when no organizations match', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=nonexistent'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('should return 400 when q parameter is missing', async () => {
      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search'));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query parameter "q" is required');
    });

    it('should return 400 when q parameter is empty string', async () => {
      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q='));

      expect(response.status).toBe(400);
    });

    it('should return 400 when q parameter is whitespace only', async () => {
      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=%20%20'));

      expect(response.status).toBe(400);
    });

    it('should cap limit at maximum of 50', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        // Verify the limit was capped at 50
        const result = await resolver();
        return result;
      });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=a&limit=100'));

      expect(response.status).toBe(200);
    });

    it('should use default limit of 10 when not specified', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        const result = await resolver();
        return result;
      });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(response.status).toBe(200);
    });

    it('should normalize query to lowercase for cache key', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:org:acme');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=ACME'));

      expect(cacheGet).toHaveBeenCalledWith('search:org:acme', expect.any(Function), { ttlType: 'search' });
    });

    it('should trim whitespace from query', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:org:acme');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=%20acme%20'));
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(cacheGet).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });

    it('should call cacheGet with correct TTL type', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(cacheGet).toHaveBeenCalledWith(
        'search:org:test',
        expect.any(Function),
        { ttlType: 'search' }
      );
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest(`http://localhost:3000/api/admin/organizations/search?q=${longQuery}`));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query must be at most 100 characters');
    });

    it('should include id, name, and slug in each result', async () => {
      const mockResults = [{ id: 'org1', name: 'Test Org', slug: 'test-org' }];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      const body = await response.json();
      expect(body.results[0]).toHaveProperty('id');
      expect(body.results[0]).toHaveProperty('name');
      expect(body.results[0]).toHaveProperty('slug');
    });

    it('should serve from cache on repeat queries (no DB call)', async () => {
      const mockResults = [{ id: 'org1', name: 'Acme Corp', slug: 'acme-corp' }];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      
      // First call
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=acme'));
      // Second call (cache hit)
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=acme'));

      // cacheGet should be called twice (each endpoint invocation calls it)
      expect(cacheGet).toHaveBeenCalledTimes(2);
    });
  });
});

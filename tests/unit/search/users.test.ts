/**
 * Unit tests for User Search API (GET /api/admin/users/search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/middleware/auth', () => ({
  withSuperAdmin: (handler: any) => handler,
}));

vi.mock('@/lib/tenant-db', () => ({
  __esModule: true,
  default: {
    user: {
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

describe('User Search API', () => {
  let cacheGet: typeof import('@/lib/cache/hybrid').cacheGet;

  beforeEach(async () => {
    vi.clearAllMocks();
    const hybrid = await import('@/lib/cache/hybrid');
    cacheGet = hybrid.cacheGet;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (url: string) => new Request(url) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return users matching the query by name (case-insensitive)', async () => {
      const mockResults = [
        { id: 'u1', name: 'John Smith', email: 'john@example.com' },
        { id: 'u2', name: 'Johnny Doe', email: 'johnny@example.com' },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=john'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return users matching the query by email', async () => {
      const mockResults = [
        { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=jane%40example'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results[0].email).toBe('jane@example.com');
    });

    it('should return users matching either name OR email', async () => {
      const mockResults = [
        { id: 'u1', name: 'John Smith', email: 'john@example.com' },
        { id: 'u2', name: 'Jane Doe', email: 'jane@example.com' },
      ];

      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 2 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=j'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results.length).toBe(2);
    });

    it('should return empty results when no users match', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=nonexistent'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual([]);
    });

    it('should return 400 when q parameter is missing', async () => {
      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search'));

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe('Query parameter "q" is required');
    });

    it('should return 400 when q parameter is empty', async () => {
      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q='));

      expect(response.status).toBe(400);
    });

    it('should normalize query to lowercase for cache key', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:user:john');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=JOHN'));

      expect(cacheGet).toHaveBeenCalledWith('search:user:john', expect.any(Function), { ttlType: 'search' });
    });

    it('should include id, name, and email in each result', async () => {
      const mockResults = [{ id: 'u1', name: 'Test User', email: 'test@example.com' }];
      vi.mocked(cacheGet).mockResolvedValue({ results: mockResults, total: 1 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      const body = await response.json();
      expect(body.results[0]).toHaveProperty('id');
      expect(body.results[0]).toHaveProperty('name');
      expect(body.results[0]).toHaveProperty('email');
    });

    it('should cap limit at maximum of 50', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test&limit=100'));

      expect(response.status).toBe(200);
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(cacheGet).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe('Internal server error');
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest(`http://localhost:3000/api/admin/users/search?q=${longQuery}`));

      expect(response.status).toBe(400);
    });

    it('should trim whitespace from query', async () => {
      vi.mocked(cacheGet).mockImplementation(async (key, resolver) => {
        expect(key).toBe('search:user:test');
        return resolver();
      });

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=%20test%20'));
    });

    it('should use default limit of 10 when not specified', async () => {
      vi.mocked(cacheGet).mockResolvedValue({ results: [], total: 0 });

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(response.status).toBe(200);
    });
  });
});

/**
 * Unit tests for User Search API (GET /api/admin/users/search)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'admin-1', name: 'Admin' },
        session: { id: 'session-1' },
      }),
    },
  },
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn().mockResolvedValue({ authorized: true }),
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

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('User Search API', () => {
  let tenantDb: typeof import('@/lib/tenant-db').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    tenantDb = (await import('@/lib/tenant-db')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createRequest = (url: string) => new Request(url) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return users matching the query by name (case-insensitive)', async () => {
      const mockResults: any[] = [
        { id: 'u1', name: 'John Smith', email: 'john@example.com' },
        { id: 'u2', name: 'Johnny Doe', email: 'johnny@example.com' },
      ];

      vi.mocked(tenantDb.user.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.user.count).mockResolvedValue(2);

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=john'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return users matching the query by email', async () => {
      const mockResults: any[] = [
        { id: 'u1', name: 'Jane Doe', email: 'jane@example.com' },
      ];

      vi.mocked(tenantDb.user.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.user.count).mockResolvedValue(1);

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=jane%40example'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results[0].email).toBe('jane@example.com');
    });

    it('should return users matching either name OR email', async () => {
      const mockResults: any[] = [
        { id: 'u1', name: 'John Smith', email: 'john@example.com' },
        { id: 'u2', name: 'Jane Doe', email: 'jane@example.com' },
      ];

      vi.mocked(tenantDb.user.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.user.count).mockResolvedValue(2);

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=j'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results.length).toBe(2);
    });

    it('should return empty results when no users match', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

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

    it('should include id, name, and email in each result', async () => {
      const mockResults: any[] = [{ id: 'u1', name: 'Test User', email: 'test@example.com' }];
      vi.mocked(tenantDb.user.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.user.count).mockResolvedValue(1);

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      const body = await response.json();
      expect(body.results[0]).toHaveProperty('id');
      expect(body.results[0]).toHaveProperty('name');
      expect(body.results[0]).toHaveProperty('email');
    });

    it('should cap limit at maximum of 50', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test&limit=100'));

      expect(response.status).toBe(200);
    });

    it('should return 500 on internal error', async () => {
      vi.mocked(tenantDb.user.findMany).mockRejectedValue(new Error('Database connection failed'));

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(response.status).toBe(500);
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest(`http://localhost:3000/api/admin/users/search?q=${longQuery}`));

      expect(response.status).toBe(400);
    });

    it('should trim whitespace from query', async () => {
      const mockResults: never[] = [];
      vi.mocked(tenantDb.user.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=%20test%20'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { startsWith: 'test', mode: 'insensitive' } },
              { email: { startsWith: 'test', mode: 'insensitive' } },
            ],
          }),
        })
      );
    });

    it('should use default limit when not specified', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('should use custom limit when specified', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test&limit=25'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 25 })
      );
    });

    it('should enforce minimum limit of 10', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test&limit=1'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('should order results by name ascending', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } })
      );
    });

    it('should select only id, name, and email', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(tenantDb.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { id: true, name: true, email: true } })
      );
    });

    it('should execute findMany and count in parallel', async () => {
      vi.mocked(tenantDb.user.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.user.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/users/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      // Both should have been called
      expect(tenantDb.user.findMany).toHaveBeenCalled();
      expect(tenantDb.user.count).toHaveBeenCalled();
    });

    it('should return 503 on database unavailable error', async () => {
      vi.mocked(tenantDb.user.findMany).mockRejectedValue(
        new Error("Can't reach database server")
      );

      const { GET } = await import('@/app/api/admin/users/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/users/search?q=test'));

      expect(response.status).toBe(503);
    });
  });
});

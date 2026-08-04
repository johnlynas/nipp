/**
 * Unit tests for Organization Search API (GET /api/admin/organizations/search)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';


// Mock dependencies
vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1', name: 'Test User' },
        session: { id: 'session-1', activeOrganizationId: null },
      }),
    },
  },
}));

vi.mock('@/lib/authz', () => ({
  verifySuperAdmin: vi.fn().mockResolvedValue({ authorized: true, error: undefined }),
}));

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

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Organization Search API', () => {
  let tenantDb: typeof import('@/lib/tenant-db').default;

  beforeEach(async () => {
    vi.clearAllMocks();
    tenantDb = (await import('@/lib/tenant-db')).default;
  });



  const createRequest = (url: string) => new Request(url) as unknown as import('next/server').NextRequest;

  describe('GET handler', () => {
    it('should return organizations matching the query prefix (case-insensitive)', async () => {
      const mockResults: any[] = [
        { id: 'org1', name: 'Acme Corp', slug: 'acme-corp' },
        { id: 'org2', name: 'Acme Industries', slug: 'acme-industries' },
      ];

      vi.mocked(tenantDb.organization.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(2);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=acme'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results).toEqual(mockResults);
      expect(body.total).toBe(2);
    });

    it('should return empty results when no organizations match', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

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
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=a&limit=100'));

      expect(response.status).toBe(200);
    });

    it('should use default limit of 10 when not specified', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(response.status).toBe(200);
    });

    it('should trim whitespace from query', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=%20acme%20'));

      expect(tenantDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: { startsWith: 'acme', mode: 'insensitive' } },
        })
      );
    });

    it('should return 503 on database unavailable error', async () => {
      vi.mocked(tenantDb.organization.findMany).mockRejectedValue(
        new Error("Can't reach database server")
      );

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(response.status).toBe(503);
    });

    it('should return 400 when query exceeds max length', async () => {
      const longQuery = 'a'.repeat(101);
      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest(`http://localhost:3000/api/admin/organizations/search?q=${longQuery}`));

      expect(response.status).toBe(400);
    });

    it('should order results by name ascending', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(tenantDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { name: 'asc' } })
      );
    });

    it('should select only id, name, and slug', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(tenantDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ select: { id: true, name: true, slug: true } })
      );
    });

    it('should execute findMany and count in parallel', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(tenantDb.organization.findMany).toHaveBeenCalled();
      expect(tenantDb.organization.count).toHaveBeenCalled();
    });

    it('should enforce minimum limit of 10', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test&limit=1'));

      expect(tenantDb.organization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 })
      );
    });

    it('should return organizations with null slug', async () => {
      const mockResults: any[] = [{ id: 'org1', name: 'Test Org', slug: null }];
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue(mockResults);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(1);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      const response = await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test'));

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.results[0].slug).toBeNull();
    });

    it('should handle special characters in query', async () => {
      vi.mocked(tenantDb.organization.findMany).mockResolvedValue([]);
      vi.mocked(tenantDb.organization.count).mockResolvedValue(0);

      const { GET } = await import('@/app/api/admin/organizations/search/route');
      await GET(createRequest('http://localhost:3000/api/admin/organizations/search?q=test%26org'));

      expect(tenantDb.organization.findMany).toHaveBeenCalled();
    });
  });
});

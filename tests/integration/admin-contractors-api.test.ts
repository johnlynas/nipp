/**
 * Integration tests: admin Contractors API routes (GET/POST /contractors,
 * GET/PATCH/DELETE /contractors/[id]).
 *
 * Route handlers are exercised directly with mocked requireSuperAdmin + RLS
 * context boundary (lib/platform-db) — the same pattern admin-units-api uses.
 * ContractorService runs for real; only tenantDb (the model it hits) is
 * mocked, so service validation and mapping run under test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/lib/require-super-admin', () => ({
  requireSuperAdmin: vi.fn(),
}));

vi.mock('@/lib/rate-limiter', () => ({
  checkAdminRateLimit: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/platform-db', () => ({
  withPlatformContext: vi.fn((_userId: string, op: () => unknown) => Promise.resolve(op())),
  withTenantAdminContext: vi.fn((_userId: string, _orgId: string, op: () => unknown) => Promise.resolve(op())),
}));

vi.mock('@/lib/tenant-db', () => ({
  default: {
    contractors: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { requireSuperAdmin } from '@/lib/require-super-admin';
import { checkAdminRateLimit } from '@/lib/rate-limiter';
import { withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';

// Untyped view of the mocked model.
const dbContractors = tenantDb.contractors as unknown as Record<string, ReturnType<typeof vi.fn>>;

/** GET helper. */
function makeGet(url: string): NextRequest {
  return new NextRequest(`http://localhost${url}`, { method: 'GET' });
}

/** POST/PATCH helper — carries the JSON body (route handlers re-read it via request.json()). */
function jsonRequest(url: string, method: 'POST' | 'PATCH', payload: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function authed(authorized = true): void {
  vi.mocked(requireSuperAdmin).mockResolvedValue(
    authorized
      ? ({ authorized: true, session: { user: { id: 'admin-1' } } }) as never
      : ({ authorized: false, status: 401, error: 'Unauthorized' }) as never,
  );
}

const contractorRow = (overrides: Record<string, unknown> = {}) => ({
  contractorId: 'c-1',
  companyName: 'Byrne Electrical Ltd',
  name: 'Pat Byrne',
  email: 'pat@byrne-electrical.example',
  phone: '+44 28 9123 4501',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  type: 'ELECTRICIAN',
  description: null,
  createdAt: new Date('2026-01-05T10:00:00Z'),
  updatedAt: new Date('2026-01-05T10:00:00Z'),
  ...overrides,
});

const validBody = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  companyName: 'Byrne Electrical Ltd',
  name: 'Pat Byrne',
  email: 'pat@byrne-electrical.example',
  phone: '+44 28 9123 4501',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  type: 'ELECTRICIAN',
  ...overrides,
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Admin Contractors API (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed();
    // clearAllMocks resets implementations — restore the pass-through default.
    vi.mocked(checkAdminRateLimit).mockReturnValue(true);
    // Reset per-test model defaults so tests set exactly what they assert on.
    dbContractors.findUnique.mockResolvedValue(null);
    dbContractors.findMany.mockResolvedValue([]);
    dbContractors.count.mockResolvedValue(0);
    dbContractors.groupBy.mockResolvedValue([]);
  });

  describe('GET /api/dashboard/admin/contractors', () => {
    it('lists contractors with pagination and whole-table per-type counts', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.findMany.mockResolvedValue([contractorRow(), contractorRow({ contractorId: 'c-2', address: '12 High Street' })]);
      // Two count calls: the service's filtered pagination count (where: {}) and
      // the route's full-table total (no arg). Per-type tiles come from groupBy.
      dbContractors.count.mockImplementation(async (arg?: { where?: Record<string, unknown> }) => {
        return arg === undefined ? 3 : 3; // full-table total tile / service pagination count
      });
      dbContractors.groupBy.mockResolvedValue([
        { type: 'ELECTRICIAN', _count: { _all: 1 } },
        { type: 'PLUMBER', _count: { _all: 2 } },
      ]);

      const response = await GET(makeGet('/api/dashboard/admin/contractors')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.items).toHaveLength(2);
      // Count queries: service list (1) + full-table total (1) = 2 count calls.
      expect(dbContractors.count).toHaveBeenCalledTimes(2);
      expect(dbContractors.groupBy).toHaveBeenCalledOnce();
      expect(data.counts.totalCount).toBe(3);
      // Whole-table per-type counts: present types as reported, absent types seeded to 0.
      expect(data.counts.types.ELECTRICIAN).toBe(1);
      expect(data.counts.types.PLUMBER).toBe(2);
      expect(data.counts.types.PAINTER).toBe(0);
      expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
    });

    it('passes search and type filters through to the query and counts', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.findMany.mockImplementation(async (arg: { where?: Record<string, unknown> }) => {
        const w = arg.where as { OR?: Array<Record<string, unknown>>; type?: string };
        expect(w.OR).toHaveLength(6);
        expect(w.type).toBe('PLUMBER');
        return [contractorRow({ type: 'PLUMBER' })];
      });
      dbContractors.count.mockResolvedValue(1);

      const response = await GET(makeGet('/api/dashboard/admin/contractors?search=antrim&type=PLUMBER')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items[0].type).toBe('PLUMBER');

      // Count calls: service list + total (no args) + 4 tiles. The total is
      // unconditional (no where); every filtered call carries the search OR.
      const countCalls = dbContractors.count.mock.calls.map((c) => c[0] as { where?: Record<string, unknown> } | undefined);
      expect(countCalls.filter((a) => a === undefined)).toHaveLength(1);
      const filteredWheres = countCalls.filter((a) => a?.where).map((a) => (a as { where: Record<string, unknown> }).where);
      expect(filteredWheres.every((w) => ((w.OR as unknown[])?.length ?? 0) > 0)).toBe(true);
    });

    it('ignores an unknown type param (no 400, no filter applied)', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.findMany.mockImplementation(async (arg: { where?: Record<string, unknown> }) => {
        expect((arg.where as { type?: string }).type).toBeUndefined();
        return [];
      });

      const response = await GET(makeGet('/api/dashboard/admin/contractors?type=CASTLE')) as Response;
      expect(response.status).toBe(200);
    });

    it('rejects with 401 when not a super admin', async () => {
      authed(false);
      const { GET } = await import('@/app/api/dashboard/admin/contractors/route');
      const response = await GET(makeGet('/api/dashboard/admin/contractors')) as Response;
      expect(response.status).toBe(401);
    });

    it('maps a service failure to 500', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.findMany.mockRejectedValue(new Error('db down'));
      const response = await GET(makeGet('/api/dashboard/admin/contractors')) as Response;
      expect(response.status).toBe(500);
    });
  });

  describe('POST /api/dashboard/admin/contractors', () => {
    it('creates a contractor (201) with the routed fields', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.create.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
        contractorId: 'c-new',
        ...arg.data,
        description: arg.data.description ?? null,
        createdAt: new Date('2026-01-05T10:00:00Z'),
        updatedAt: new Date('2026-01-05T10:00:00Z'),
      }));

      const response = await POST(
        jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', validBody()),
      ) as Response;
      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.contractorId).toBe('c-new');
      expect(data.companyName).toBe('Byrne Electrical Ltd');
      // Trimmed payload reached the DB layer.
      expect(dbContractors.create).toHaveBeenCalledTimes(1);
    });

    it('accepts a create without description (omitted from the data)', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      dbContractors.create.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
        contractorId: 'c-new', ...arg.data, description: null,
        createdAt: new Date(), updatedAt: new Date(),
      }));

      const body = validBody();
      delete body.description;
      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', body)) as Response;
      expect(response.status).toBe(201);
      const createArgs = dbContractors.create.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(createArgs.data.description).toBeUndefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      const noPhone = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', {
        companyName: 'X Co', name: 'X', email: 'x@example.com', address: 'A', postCode: 'P',
      })) as Response;
      expect(noPhone.status).toBe(400);

      const noCompany = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', {
        name: 'X', email: 'x@example.com', phone: '+1 234', address: 'A', postCode: 'P',
      })) as Response;
      expect(noCompany.status).toBe(400);

      const onlyName = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', { name: 'X' })) as Response;
      expect(onlyName.status).toBe(400);
    });

    it('returns 400 for an invalid type', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', {
        ...validBody(),
        type: 'CASTLE',
      })) as Response;
      expect(response.status).toBe(400);
    });

    it('returns 400 for malformed JSON', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      const request = new NextRequest('http://localhost/api/dashboard/admin/contractors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json}',
      });
      const response = await POST(request) as Response;
      expect(response.status).toBe(400);
    });

    it('maps a service ValidationError to 400 with the message', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', {
        ...validBody(),
        email: 'not-an-email',
      })) as Response;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Email must be a valid email address');
    });

    it('rejects with 429 when rate-limited', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      vi.mocked(checkAdminRateLimit).mockReturnValue(false);

      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', validBody())) as Response;
      expect(response.status).toBe(429);
    });

    it('rejects with 401 when not a super admin', async () => {
      authed(false);
      const { POST } = await import('@/app/api/dashboard/admin/contractors/route');
      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/contractors', 'POST', validBody())) as Response;
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/dashboard/admin/contractors/[id]', () => {
    it('returns a contractor', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());

      const response = await GET(makeGet('/api/dashboard/admin/contractors/c-1'), params('c-1')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.contractorId).toBe('c-1');
    });

    it('returns 404 for a missing contractor', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(null);

      const response = await GET(makeGet('/api/dashboard/admin/contractors/missing'), params('missing')) as Response;
      expect(response.status).toBe(404);
    });

    it('runs under the verified platform context', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());

      await GET(makeGet('/api/dashboard/admin/contractors/c-1'), params('c-1'));
      expect(withPlatformContext as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);
    });
  });

  describe('PATCH /api/dashboard/admin/contractors/[id]', () => {
    it('updates a contractor with the routed fields', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());
      dbContractors.update.mockImplementation(async (arg: { where: { contractorId: string }; data: Record<string, unknown> }) => ({
        ...contractorRow({ name: (arg.data.name as string) ?? 'Pat Byrne' }),
        type: (arg.data.type as string) ?? 'ELECTRICIAN',
      }));

      const response = await PATCH(
        jsonRequest('http://localhost/api/dashboard/admin/contractors/c-1', 'PATCH', { name: 'Pat J. Byrne' }),
        params('c-1'),
      ) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.name).toBe('Pat J. Byrne');
    });

    it('clears the description when an empty string is sent', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow({ description: 'Old text' }));
      dbContractors.update.mockImplementation(async (arg: { data: Record<string, unknown> }) => ({
        ...contractorRow({ description: arg.data.description as string | null }),
      }));

      const response = await PATCH(
        jsonRequest('http://localhost/api/dashboard/admin/contractors/c-1', 'PATCH', { description: '' }),
        params('c-1'),
      ) as Response;
      expect(response.status).toBe(200);
      const updateArgs = dbContractors.update.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(updateArgs.data.description).toBeNull();
    });

    it('returns 400 when no fields are provided', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/contractors/c-1', 'PATCH', {}), params('c-1')) as Response;
      expect(response.status).toBe(400);
    });

    it('returns 400 for an invalid type', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/contractors/c-1', 'PATCH', { type: 'CASTLE' }), params('c-1')) as Response;
      expect(response.status).toBe(400);
    });

    it('maps a service ValidationError to 400 with the message', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/contractors/c-1', 'PATCH', { email: 'bad' }), params('c-1')) as Response;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Email must be a valid email address');
    });

    it('returns 404 when the contractor does not exist', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(null);
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/contractors/gone', 'PATCH', { name: 'X' }), params('gone')) as Response;
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/dashboard/admin/contractors/[id]', () => {
    it('deletes a contractor and reports success', async () => {
      const { DELETE } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());
      dbContractors.delete.mockResolvedValue({ contractorId: 'c-1' });

      const response = await DELETE(makeGet('/api/dashboard/admin/contractors/c-1'), params('c-1')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(dbContractors.delete).toHaveBeenCalledTimes(1);
    });

    it('returns 404 when the contractor does not exist', async () => {
      const { DELETE } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(null);
      const response = await DELETE(makeGet('/api/dashboard/admin/contractors/gone'), params('gone')) as Response;
      expect(response.status).toBe(404);
    });

    it('does not gate deletes behind the admin write rate limiter (parity with the users [id] route)', async () => {
      const { DELETE } = await import('@/app/api/dashboard/admin/contractors/[id]/route');
      dbContractors.findUnique.mockResolvedValue(contractorRow());
      vi.mocked(checkAdminRateLimit).mockReturnValue(false);

      const response = await DELETE(makeGet('/api/dashboard/admin/contractors/c-1'), params('c-1')) as Response;
      expect(response.status).toBe(200);
    });
  });
});

/**
 * Integration tests: admin Units API routes (GET/POST /units, GET/PATCH/DELETE /units/[id]).
 *
 * Route handlers are exercised directly with mocked requireSuperAdmin + RLS
 * context boundary (lib/platform-db) — the same pattern super-admin-integration
 * uses for /api/admin/* routes. tenantDb is mocked; service validation and
 * mapping run for real.
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

vi.mock('@/services/unit-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/services/unit-service')>();
  return {
    ...original,
    UNIT_TYPES: original.UNIT_TYPES,
    UnitService: {
      getUnitsByOrg: vi.fn(),
      createUnit: vi.fn(),
      getUnitById: vi.fn(),
      updateUnit: vi.fn(),
      deleteUnit: vi.fn(),
    },
  };
});

vi.mock('@/lib/tenant-db', () => ({
  default: {
    units: { count: vi.fn().mockResolvedValue(0), findUnique: vi.fn().mockResolvedValue(null) },
    organization: { findMany: vi.fn().mockResolvedValue([{ id: 'org-1' }]) },
  },
}));

import { requireSuperAdmin } from '@/lib/require-super-admin';
import { withPlatformContext } from '@/lib/platform-db';
import tenantDb from '@/lib/tenant-db';
import { UnitService } from '@/services/unit-service';
import { NotFoundError, ValidationError } from '@/lib/services/types';

// Untyped views of the mocked collaborators (vi.fn() signatures don't match
// Prisma-client generated callback types).
const svc = UnitService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const dbUnits = tenantDb.units as unknown as Record<string, ReturnType<typeof vi.fn>>;

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

const unitRow = (overrides: Record<string, unknown> = {}) => ({
  unitId: 'u-1',
  organizationId: 'org-1',
  owner: 'Janet Owens',
  email: 'janet.owens@example.com',
  phone: '+44 28 9123 4501',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  rented: false,
  type: 'APARTMENT',
  createdAt: new Date('2026-01-05T10:00:00Z'),
  updatedAt: new Date('2026-01-05T10:00:00Z'),
  organization: { id: 'org-1', name: 'Acme Property Co' },
  ...overrides,
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Admin Units API (Integration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authed();
  });

  describe('GET /api/dashboard/admin/units', () => {
    it('lists units with pagination and counts for all orgs', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/units/route');
      svc.getUnitsByOrg.mockResolvedValue({
        items: [unitRow(), unitRow({ unitId: 'u-2', address: '12 High Street' })],
        pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 },
      });
      dbUnits.count.mockResolvedValue(3);

      const response = await GET(makeGet('/api/dashboard/admin/units')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.items).toHaveLength(2);
      // Count queries run over the full dataset: total, rented, owner-occupied.
      expect(dbUnits.count).toHaveBeenCalledTimes(3);
      expect(data.counts.totalCount).toBe(3);
      expect(data.pagination).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    });

    it('passes search/rented/type filters through to the service and count queries', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/units/route');
      svc.getUnitsByOrg.mockImplementation((_org: string, _ctx: unknown, _p: number, _ps: number, _search?: string, _rented?: boolean, type?: string) =>
        Promise.resolve({
          items: [unitRow({ type })],
          pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
        }),
      );

      const response = await GET(makeGet('/api/dashboard/admin/units?search=antrim&rented=true&type=HOUSE')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items[0].type).toBe('HOUSE');

      // Count where should carry search + rented + type.
      const countCalls = dbUnits.count.mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
      expect(countCalls.some((w) => w.rented === true)).toBe(true);
      expect(countCalls.every((w) => ((w.OR as unknown[] | undefined)?.length ?? 0) > 0)).toBe(true);
    });

    it('lists a single org via organizationId when provided', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/units/route');
      svc.getUnitsByOrg.mockResolvedValue({
        items: [unitRow()],
        pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });

      const response = await GET(makeGet('/api/dashboard/admin/units?organizationId=org-1')) as Response;
      expect(response.status).toBe(200);
      expect((withPlatformContext as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
      const data = await response.json();
      expect(data.items[0].unitId).toBe('u-1');
    });

    it('rejects with 401 when not a super admin', async () => {
      authed(false);
      const { GET } = await import('@/app/api/dashboard/admin/units/route');
      const response = await GET(makeGet('/api/dashboard/admin/units')) as Response;
      expect(response.status).toBe(401);
    });
  });

  describe('POST /api/dashboard/admin/units', () => {
    it('creates a unit under a tenant-admin context bound to the target org', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/units/route');
      svc.createUnit.mockResolvedValue(unitRow() as never);

      const request = jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', {
        owner: 'Sadie Carson', address: '7 Shore Road', postCode: 'BT78 5ZZ', email: 'sadie.carson@example.com', phone: '+44 28 965 4321', organizationId: 'org-1',
      });
      const response = await POST(request) as Response;
      expect(response.status).toBe(201);

      // RLS binding must carry the TARGET org (INSERT WITH CHECK).
      expect(svc.createUnit).toHaveBeenCalledWith(expect.objectContaining({ owner: 'Sadie Carson' }), 'org-1', expect.objectContaining({ userId: 'admin-1' }));
    });

    it('passes email and phone through to the service on create', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/units/route');
      svc.createUnit.mockResolvedValue(unitRow() as never);

      const request = jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', {
        owner: 'O', address: 'A', postCode: 'P', email: 'o@a.example', phone: '+1 234', organizationId: 'org-1',
      });
      const response = await POST(request) as Response;
      expect(response.status).toBe(201);
      expect(svc.createUnit).toHaveBeenCalledWith(expect.objectContaining({ email: 'o@a.example', phone: '+1 234' }), 'org-1', expect.anything());
    });

    it('returns 400 when required fields are missing', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/units/route');
      // email + phone are now required alongside owner/address/postCode.
      const noPhone = await POST(jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', { owner: 'X', address: 'A', postCode: 'P', organizationId: 'org-1' })) as Response;
      expect(noPhone.status).toBe(400);

      const noEmail = await POST(jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', { owner: 'X', address: 'A', postCode: 'P', phone: '+1 234', organizationId: 'org-1' })) as Response;
      expect(noEmail.status).toBe(400);

      const onlyOwner = await POST(jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', { owner: 'X' })) as Response;
      expect(onlyOwner.status).toBe(400);
    });

    it('returns 400 for an invalid type', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/units/route');
      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', { owner: 'X', address: 'A', postCode: 'P', email: 'x@y.example', phone: '+1 555', type: 'CASTLE', organizationId: 'org-1' })) as Response;
      expect(response.status).toBe(400);
    });

    it('maps a service ValidationError to 400 with the message', async () => {
      const { POST } = await import('@/app/api/dashboard/admin/units/route');
      svc.createUnit.mockRejectedValue(new ValidationError('Invalid email format'));

      const response = await POST(jsonRequest('http://localhost/api/dashboard/admin/units', 'POST', { owner: 'X', address: 'A', postCode: 'P', email: 'not-an-email', phone: '+1 555', organizationId: 'org-1' })) as Response;
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Invalid email format');
    });
  });

  describe('GET /api/dashboard/admin/units/[id]', () => {
    it('returns a unit with its organization', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/units/[id]/route');
      svc.getUnitById.mockResolvedValue(unitRow() as never);

      const response = await GET(makeGet('/api/dashboard/admin/units/u-1'), params('u-1')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.organization?.name).toBe('Acme Property Co');
    });

    it('returns 404 for a missing unit', async () => {
      const { GET } = await import('@/app/api/dashboard/admin/units/[id]/route');
      svc.getUnitById.mockRejectedValue(new NotFoundError('Unit not found'));

      const response = await GET(makeGet('/api/dashboard/admin/units/missing'), params('missing')) as Response;
      expect(response.status).toBe(404);
    });
  });

  describe('PATCH /api/dashboard/admin/units/[id]', () => {
    it('updates a unit under the unit org context (verified via service args)', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/units/[id]/route');
      dbUnits.findUnique.mockResolvedValue({ address: '4 Antrim Road', organizationId: 'org-1' });
      svc.updateUnit.mockResolvedValue(unitRow() as never);

      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/units/u-1', 'PATCH', { rented: true }), params('u-1')) as Response;
      expect(response.status).toBe(200);
      // The service was invoked with the unit id + the routed fields.
      expect(svc.updateUnit).toHaveBeenCalledWith('u-1', expect.objectContaining({ rented: true }), expect.objectContaining({ userId: 'admin-1' }));
    });

    it('returns 400 when no fields are provided', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/units/[id]/route');
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/units/u-1', 'PATCH', {}), params('u-1')) as Response;
      expect(response.status).toBe(400);
    });

    it('returns 400 for an invalid type', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/units/[id]/route');
      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/units/u-1', 'PATCH', { type: 'CASTLE' }), params('u-1')) as Response;
      expect(response.status).toBe(400);
    });

    it('returns 404 when the pre-update lookup finds no unit', async () => {
      const { PATCH } = await import('@/app/api/dashboard/admin/units/[id]/route');
      dbUnits.findUnique.mockResolvedValue(null);

      const response = await PATCH(jsonRequest('http://localhost/api/dashboard/admin/units/u-1', 'PATCH', { rented: true }), params('u-1')) as Response;
      expect(response.status).toBe(404);
    });
  });

  describe('DELETE /api/dashboard/admin/units/[id]', () => {
    it('deletes a unit (service invoked with the id)', async () => {
      const { DELETE } = await import('@/app/api/dashboard/admin/units/[id]/route');
      dbUnits.findUnique.mockResolvedValue({ address: '4 Antrim Road', organizationId: 'org-1' });
      svc.deleteUnit.mockResolvedValue({ success: true } as never);

      const response = await DELETE(makeGet('/api/dashboard/admin/units/u-1'), params('u-1')) as Response;
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(svc.deleteUnit).toHaveBeenCalledWith('u-1', expect.objectContaining({ userId: 'admin-1' }));
    });

    it('returns 404 when the pre-delete lookup finds no org context', async () => {
      const { DELETE } = await import('@/app/api/dashboard/admin/units/[id]/route');
      dbUnits.findUnique.mockResolvedValue(null);

      const response = await DELETE(makeGet('/api/dashboard/admin/units/gone'), params('gone')) as Response;
      expect(response.status).toBe(404);
    });
  });
});

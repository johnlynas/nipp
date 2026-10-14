/**
 * Unit tests for UnitService — org-scoped Units CRUD, validation, and role authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { UnitService, UNIT_TYPES, type CreateUnitInput, type UpdateUnitInput } from '@/services/unit-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// Mock dependencies (mirrors tests/unit/team-service.test.ts mock structure)
vi.mock('@/lib/tenant-db', () => ({
  default: {
    units: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn().mockResolvedValue({ unitId: 'unit-created', organizationId: 'org-1' }),
      update: vi.fn().mockResolvedValue({ unitId: 'unit-updated', organizationId: 'org-1' }),
      delete: vi.fn().mockResolvedValue({ unitId: 'unit-deleted', organizationId: 'org-1' }),
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: { PLATFORM_ORGANIZATION_ID: 'platform-org-123' },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/audit-log', () => ({
  recordAuditLog: vi.fn(),
}));

// Untyped view of the mocked model — Prisma's generated callback types reject
// ad-hoc mockImplementation signatures; assertions on args go through this handle.
const units = globalDb.units as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const mockCtx = (role: 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MEMBER', orgId?: string): ServiceContext => ({
  userId: 'user-1',
  role,
  organizationId: orgId,
});

const mockUnit = (overrides: Record<string, unknown> = {}) => ({
  unitId: 'unit-1',
  organizationId: 'org-1',
  owner: 'Janet Owens',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  rented: false,
  type: 'APARTMENT',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as Record<string, unknown>;

describe('UnitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the full UnitType set', () => {
    expect([...UNIT_TYPES]).toEqual(['HOUSE', 'APARTMENT', 'OTHER']);
  });

  describe('createUnit', () => {
    it('creates a unit for PLATFORM_ADMIN in any org with defaults applied', async () => {
      units.create.mockImplementation(async (args: Record<string, unknown>) => {
        const data = args.data as Record<string, unknown>;
        // Defaults come from the Prisma schema; verify explicit data shape.
        expect(data.organizationId).toBe('org-2');
        expect(data.owner).toBe('Michael Byrne');
        return mockUnit({ unitId: 'new-unit', organizationId: 'org-2' }) as unknown;
      });

      const result = await UnitService.createUnit(
        { owner: 'Michael Byrne', address: '12 High Street', postCode: 'BT49 3AB' },
        'org-2',
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.unitId).toBe('new-unit');
      expect(units.create).toHaveBeenCalledTimes(1);
    });

    it('creates a unit for TENANT_ADMIN in their own org with rented + type set', async () => {
      units.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.rented).toBe(true);
        expect(args.data.type).toBe('HOUSE');
        return mockUnit({ unitId: 'new-unit', organizationId: 'org-1' }) as never;
      });

      const result = await UnitService.createUnit(
        { owner: 'Sadie Carson', address: '7 Shore Road', postCode: 'BT78 5ZZ', rented: true, type: 'HOUSE' },
        'org-1',
        mockCtx('TENANT_ADMIN', 'org-1'),
      );

      expect(result.unitId).toBe('new-unit');
    });

    it('throws ForbiddenError for TENANT_ADMIN creating in a different org', async () => {
      await expect(
        UnitService.createUnit(
          { owner: 'X', address: 'A', postCode: 'P' },
          'org-2',
          mockCtx('TENANT_ADMIN', 'org-1'),
        ),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(
        UnitService.createUnit({ owner: 'X', address: 'A', postCode: 'P' }, 'org-1', mockCtx('MEMBER')),
      ).rejects.toThrow(ForbiddenError);
    });

    it('throws ValidationError when organizationId is missing', async () => {
      await expect(
        UnitService.createUnit({ owner: 'X', address: 'A', postCode: 'P' }, '', mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it.each([
      ['empty owner', (o: Record<string, unknown>) => ({ ...o, owner: '' })],
      ['whitespace owner', (o: Record<string, unknown>) => ({ ...o, owner: '   ' })],
      ['owner over 100 chars', (o: Record<string, unknown>) => ({ ...o, owner: 'a'.repeat(101) })],
      ['empty address', (o: Record<string, unknown>) => ({ ...o, address: '' })],
      ['address over 255 chars', (o: Record<string, unknown>) => ({ ...o, address: 'a'.repeat(256) })],
      ['empty post code', (o: Record<string, unknown>) => ({ ...o, postCode: '' })],
      ['post code over 32 chars', (o: Record<string, unknown>) => ({ ...o, postCode: 'a'.repeat(33) })],
    ])('throws ValidationError for %s', async (_label, mutate) => {
      const input = mutate({ owner: 'X', address: 'A', postCode: 'P' }) as CreateUnitInput;
      await expect(
        UnitService.createUnit(input, 'org-1', mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an invalid type value', async () => {
      await expect(
        UnitService.createUnit(
          { owner: 'X', address: 'A', postCode: 'P', type: 'CASTLE' as never },
          'org-1',
          mockCtx('PLATFORM_ADMIN'),
        ),
      ).rejects.toThrow(ValidationError);
    });

    it('trims string fields before persisting', async () => {
      units.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.owner).toBe('Trimmed Owner');
        expect(args.data.address).toBe('1 Trim Street');
        expect(args.data.postCode).toBe('BT0 1AA');
        return mockUnit() as never;
      });

      await UnitService.createUnit(
        { owner: '  Trimmed Owner  ', address: '  1 Trim Street  ', postCode: '  BT0 1AA  ' },
        'org-1',
        mockCtx('PLATFORM_ADMIN'),
      );
    });
  });

  describe('getUnitById', () => {
    it('returns a unit with its organization for PLATFORM_ADMIN', async () => {
      units.findUnique.mockResolvedValue(
        { ...mockUnit(), organization: { id: 'org-1', name: 'Acme' } } as never,
      );

      const result = await UnitService.getUnitById('unit-1', mockCtx('PLATFORM_ADMIN'));
      expect(result.organization?.name).toBe('Acme');
    });

    it('throws NotFoundError for a missing unit', async () => {
      units.findUnique.mockResolvedValue(null);
      await expect(UnitService.getUnitById('missing', mockCtx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when TENANT_ADMIN reads a unit outside their org (defense in depth)', async () => {
      units.findUnique.mockResolvedValue({ ...mockUnit(), organizationId: 'org-2' } as never);
      await expect(UnitService.getUnitById('unit-1', mockCtx('TENANT_ADMIN', 'org-1'))).rejects.toThrow(ForbiddenError);
    });

    it('allows TENANT_ADMIN to read a unit in their own org', async () => {
      units.findUnique.mockResolvedValue({ ...mockUnit(), organization: { id: 'org-1', name: 'Acme' } } as never);
      const result = await UnitService.getUnitById('unit-1', mockCtx('TENANT_ADMIN', 'org-1'));
      expect(result.unitId).toBe('unit-1');
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(UnitService.getUnitById('unit-1', mockCtx('MEMBER'))).rejects.toThrow(ForbiddenError);
    });
  });

  describe('getUnitsByOrg', () => {
    it('returns a paginated list scoped to the org with organization includes', async () => {
      units.findMany.mockImplementation(async (args: any) => {
        expect(args.where.organizationId).toBe('org-1');
        expect(args.include.organization.select.name).toBe(true);
        return [mockUnit()];
      });
      units.count.mockResolvedValue(2);

      const result = await UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 1, 20);
      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(2);
    });

    it('applies search across owner, address and postCode', async () => {
      units.findMany.mockImplementation(async (args: any) => {
        const or = args.where.OR as Array<Record<string, { contains: string }>>;
        expect(or[0].owner.contains).toBe('antrim');
        expect(or[1].address.contains).toBe('antrim');
        expect(or[2].postCode.contains).toBe('antrim');
        return [mockUnit()];
      });

      await UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 1, 20, 'antrim');
    });

    it('applies rented and type filters to the where clause', async () => {
      units.findMany.mockImplementation(async (args: any) => {
        expect(args.where.rented).toBe(true);
        expect(args.where.type).toBe('HOUSE');
        return [mockUnit()];
      });

      await UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 1, 20, undefined, true, 'HOUSE');
    });

    it('throws ValidationError for an invalid type filter', async () => {
      await expect(
        UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 1, 20, undefined, undefined, 'CASTLE' as never),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError for TENANT_ADMIN listing a different org', async () => {
      await expect(
        UnitService.getUnitsByOrg('org-2', mockCtx('TENANT_ADMIN', 'org-1')),
      ).rejects.toThrow(ForbiddenError);
    });

    it('computes pagination totalPages', async () => {
      units.findMany.mockResolvedValue([mockUnit()] as never);
      units.count.mockResolvedValue(45);
      const result = await UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 3, 20);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.page).toBe(3);
    });

    it('passes skip/take through to the query', async () => {
      units.findMany.mockImplementation(async (args: any) => {
        expect(args.skip).toBe(20);
        expect(args.take).toBe(20);
        return [];
      });

      await UnitService.getUnitsByOrg('org-1', mockCtx('PLATFORM_ADMIN'), 2, 20);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(UnitService.getUnitsByOrg('org-1', mockCtx('MEMBER'))).rejects.toThrow(ForbiddenError);
    });
  });

  describe('updateUnit', () => {
    it('updates only the provided fields (partial update)', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      units.update.mockImplementation(async (args: any) => {
        expect(args.data.owner).toBe('New Owner');
        // Untouched fields are not in the update data.
        expect(args.data.address).toBeUndefined();
        expect(args.data.postCode).toBeUndefined();
        return mockUnit({ owner: 'New Owner' });
      });

      const result = (await UnitService.updateUnit('unit-1', { owner: 'New Owner' }, mockCtx('PLATFORM_ADMIN'))) as Record<string, unknown>;
      expect(result.owner).toBe('New Owner');
    });

    it('updates rented and type', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      units.update.mockImplementation(async (args: any) => {
        expect(args.data.rented).toBe(true);
        expect(args.data.type).toBe('OTHER');
        return mockUnit({ rented: true, type: 'OTHER' });
      });

      await UnitService.updateUnit('unit-1', { rented: true, type: 'OTHER' }, mockCtx('PLATFORM_ADMIN'));
    });

    it('throws NotFoundError when the unit does not exist', async () => {
      units.findUnique.mockResolvedValue(null);
      await expect(UnitService.updateUnit('missing', { owner: 'X' }, mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when TENANT_ADMIN updates a unit outside their org', async () => {
      units.findUnique.mockResolvedValue({ ...mockUnit(), organizationId: 'org-2' } as never);
      await expect(UnitService.updateUnit('unit-1', { owner: 'X' }, mockCtx('TENANT_ADMIN', 'org-1')))
        .rejects.toThrow(ForbiddenError);
    });

    it.each([
      ['empty owner', () => ({ owner: '' })],
      ['address over 255 chars', () => ({ address: 'a'.repeat(256) })],
      ['post code over 32 chars', () => ({ postCode: 'p'.repeat(33) })],
    ])('throws ValidationError for %s on update', async (_label, fields) => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      await expect(UnitService.updateUnit('unit-1', fields() as UpdateUnitInput, mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an invalid type on update', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      await expect(
        UnitService.updateUnit('unit-1', { type: 'CASTLE' as never }, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      await expect(UnitService.updateUnit('unit-1', { owner: 'X' }, mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('deleteUnit', () => {
    it('deletes a unit (PLATFORM_ADMIN any org)', async () => {
      units.findUnique.mockResolvedValue({ ...mockUnit(), organizationId: 'org-9' } as never);
      const result = await UnitService.deleteUnit('unit-1', mockCtx('PLATFORM_ADMIN'));
      expect(result.success).toBe(true);
      expect(units.delete).toHaveBeenCalledTimes(1);
    });

    it('deletes a unit in own org for TENANT_ADMIN', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      const result = await UnitService.deleteUnit('unit-1', mockCtx('TENANT_ADMIN', 'org-1'));
      expect(result.success).toBe(true);
    });

    it('throws NotFoundError when the unit does not exist', async () => {
      units.findUnique.mockResolvedValue(null);
      await expect(UnitService.deleteUnit('missing', mockCtx('PLATFORM_ADMIN'))).rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError when TENANT_ADMIN deletes a unit outside their org', async () => {
      units.findUnique.mockResolvedValue({ ...mockUnit(), organizationId: 'org-2' } as never);
      await expect(UnitService.deleteUnit('unit-1', mockCtx('TENANT_ADMIN', 'org-1')))
        .rejects.toThrow(ForbiddenError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      units.findUnique.mockResolvedValue(mockUnit() as never);
      await expect(UnitService.deleteUnit('unit-1', mockCtx('MEMBER'))).rejects.toThrow(ForbiddenError);
    });
  });
});

/**
 * Unit tests for ContractorService — global (RLS-exempt) Contractors CRUD,
 * validation, and role authorization.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import globalDb from '@/lib/tenant-db';
import { ContractorService, CONTRACTOR_TYPES, type CreateContractorInput, type UpdateContractorInput } from '@/services/contractor-service';
import { ServiceContext, ForbiddenError, NotFoundError, ValidationError } from '@/lib/services/types';

// Mock dependencies (mirrors tests/unit/unit-service.test.ts mock structure —
// no org context mocks: contractors is a global table with no tenant wrapper).
vi.mock('@/lib/tenant-db', () => ({
  default: {
    contractors: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn().mockResolvedValue({ contractorId: 'contractor-created' }),
      update: vi.fn().mockResolvedValue({ contractorId: 'contractor-updated' }),
      delete: vi.fn().mockResolvedValue({ contractorId: 'contractor-deleted' }),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Untyped view of the mocked model — Prisma's generated callback types reject
// ad-hoc mockImplementation signatures; assertions on args go through this handle.
const contractors = globalDb.contractors as unknown as {
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

const mockContractor = (overrides: Record<string, unknown> = {}) => ({
  contractorId: 'contractor-1',
  companyName: 'Byrne Electrical Ltd',
  name: 'Pat Byrne',
  email: 'pat@byrne-electrical.example',
  phone: '+44 28 9123 4501',
  address: '4 Antrim Road',
  postCode: 'BT48 6XX',
  type: 'ELECTRICIAN',
  description: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
}) as Record<string, unknown>;

const validCreate = (extra: Partial<CreateContractorInput> = {}): CreateContractorInput => ({
  companyName: 'Doherty Plumbing',
  name: 'James Doherty',
  email: 'james@doherty-plumb.example',
  phone: '+44 28 998 7654',
  address: '9 Queen Street',
  postCode: 'BT1 2AA',
  ...extra,
});

describe('ContractorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exposes the full ContractorType set', () => {
    expect([...CONTRACTOR_TYPES]).toEqual([
      'PAINTER', 'ELECTRICIAN', 'PLUMBER', 'GAS_ENGINEER', 'LIFT_MAINTENANCE',
      'GARDENER', 'ACCOUNTANT', 'FIRE_ALARMS', 'SOLICITOR', 'ROOFER', 'WINDOW_CLEANER', 'OTHER',
    ]);
  });

  describe('create', () => {
    it('creates a contractor with all fields and type set', async () => {
      contractors.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.companyName).toBe('Doherty Plumbing');
        expect(args.data.name).toBe('James Doherty');
        expect(args.data.type).toBe('PLUMBER');
        // Non-empty description is persisted (trimmed) at create time.
        expect(args.data.description).toBe('18th reg.');
        return mockContractor({ contractorId: 'new-contractor' }) as never;
      });

      const result = await ContractorService.create(
        validCreate({ type: 'PLUMBER', description: '18th reg.' }),
        mockCtx('PLATFORM_ADMIN'),
      );

      expect(result.contractorId).toBe('new-contractor');
      expect(contractors.create).toHaveBeenCalledTimes(1);
    });

    it('omits description from the create data when empty/whitespace', async () => {
      contractors.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.description).toBeUndefined();
        // Type omitted → Prisma @default(OTHER) applies; not in the data.
        expect(args.data.type).toBeUndefined();
        return mockContractor({ contractorId: 'new-contractor' }) as never;
      });

      await ContractorService.create(validCreate({ description: '   ' }), mockCtx('PLATFORM_ADMIN'));
    });

    it('works for TENANT_ADMIN (global directory — no org restriction)', async () => {
      contractors.create.mockResolvedValue(mockContractor({ contractorId: 'new-contractor' }) as never);
      const result = await ContractorService.create(validCreate(), mockCtx('TENANT_ADMIN', 'org-1'));
      expect(result.contractorId).toBe('new-contractor');
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(ContractorService.create(validCreate(), mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });

    it.each([
      ['empty company name', (o: Partial<CreateContractorInput>) => ({ ...o, companyName: '' })],
      ['whitespace company name', (o: Partial<CreateContractorInput>) => ({ ...o, companyName: '   ' })],
      ['company name over 100 chars', (o: Partial<CreateContractorInput>) => ({ ...o, companyName: 'a'.repeat(101) })],
      ['empty name', (o: Partial<CreateContractorInput>) => ({ ...o, name: '' })],
      ['name over 100 chars', (o: Partial<CreateContractorInput>) => ({ ...o, name: 'a'.repeat(101) })],
      ['empty email', (o: Partial<CreateContractorInput>) => ({ ...o, email: '' })],
      ['whitespace email', (o: Partial<CreateContractorInput>) => ({ ...o, email: '   ' })],
      ['email over 100 chars', (o: Partial<CreateContractorInput>) => ({ ...o, email: `${'a'.repeat(96)}@example.com` })],
      ['empty phone', (o: Partial<CreateContractorInput>) => ({ ...o, phone: '' })],
      ['whitespace phone', (o: Partial<CreateContractorInput>) => ({ ...o, phone: '   ' })],
      ['phone over 32 chars', (o: Partial<CreateContractorInput>) => ({ ...o, phone: 'p'.repeat(33) })],
      ['empty address', (o: Partial<CreateContractorInput>) => ({ ...o, address: '' })],
      ['address over 255 chars', (o: Partial<CreateContractorInput>) => ({ ...o, address: 'a'.repeat(256) })],
      ['empty post code', (o: Partial<CreateContractorInput>) => ({ ...o, postCode: '' })],
      ['post code over 32 chars', (o: Partial<CreateContractorInput>) => ({ ...o, postCode: 'a'.repeat(33) })],
    ])('throws ValidationError for %s', async (_label, mutate) => {
      const input = mutate(validCreate()) as CreateContractorInput;
      await expect(ContractorService.create(input, mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(ValidationError);
    });

    it.each([
      ['missing @ sign', (o: Partial<CreateContractorInput>) => ({ ...o, email: 'not-an-email' })],
      ['missing domain', (o: Partial<CreateContractorInput>) => ({ ...o, email: 'user@' })],
      ['space in local part', (o: Partial<CreateContractorInput>) => ({ ...o, email: 'us er@example.com' })],
    ])('throws ValidationError for %s on create', async (_label, mutate) => {
      const input = mutate(validCreate()) as CreateContractorInput;
      await expect(ContractorService.create(input, mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an invalid type value', async () => {
      await expect(
        ContractorService.create(validCreate({ type: 'CASTLE' as never }), mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it('trims string fields before persisting', async () => {
      contractors.create.mockImplementation(async (args: { data: Record<string, unknown> }) => {
        expect(args.data.companyName).toBe('Trimmed Ltd');
        expect(args.data.name).toBe('T. Person');
        expect(args.data.email).toBe('trim@example.com');
        expect(args.data.phone).toBe('+44 28 999');
        expect(args.data.address).toBe('1 Trim Street');
        expect(args.data.postCode).toBe('BT0 1AA');
        return mockContractor() as never;
      });

      await ContractorService.create(
        validCreate({
          companyName: '  Trimmed Ltd  ',
          name: '  T. Person  ',
          email: '  trim@example.com  ',
          phone: '  +44 28 999  ',
          address: '  1 Trim Street  ',
          postCode: '  BT0 1AA  ',
        }),
        mockCtx('PLATFORM_ADMIN'),
      );
    });
  });

  describe('getById', () => {
    it('returns a contractor when found', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      const result = await ContractorService.getById('contractor-1', mockCtx('PLATFORM_ADMIN'));
      expect(result.contractorId).toBe('contractor-1');
    });

    it('throws NotFoundError for a missing contractor', async () => {
      contractors.findUnique.mockResolvedValue(null);
      await expect(ContractorService.getById('missing', mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      await expect(ContractorService.getById('contractor-1', mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('list', () => {
    it('returns a paginated list without filters', async () => {
      contractors.findMany.mockImplementation(async (args: any) => {
        // No search, no type → where has no OR and no type key.
        expect(args.where.OR).toBeUndefined();
        expect(args.where.type).toBeUndefined();
        return [mockContractor()];
      });
      contractors.count.mockResolvedValue(2);

      const result = await ContractorService.list({}, { page: 1, pageSize: 8 }, mockCtx('PLATFORM_ADMIN'));
      expect(result.items).toHaveLength(1);
      expect(result.pagination.total).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('applies search across company, name, email, phone, address and post code', async () => {
      contractors.findMany.mockImplementation(async (args: any) => {
        const or = args.where.OR as Array<Record<string, { contains: string; mode: string }>>;
        expect(or).toHaveLength(6);
        expect(or[0].companyName.contains).toBe('antrim');
        expect(or[1].name.contains).toBe('antrim');
        expect(or[2].email.contains).toBe('antrim');
        expect(or[3].phone.contains).toBe('antrim');
        expect(or[4].address.contains).toBe('antrim');
        expect(or[5].postCode.contains).toBe('antrim');
        // Case-insensitive matching.
        expect(or[0].companyName.mode).toBe('insensitive');
        return [mockContractor()];
      });

      await ContractorService.list({ search: '  antrim  ' }, { page: 1, pageSize: 8 }, mockCtx('PLATFORM_ADMIN'));
    });

    it('applies the type filter to the where clause', async () => {
      contractors.findMany.mockImplementation(async (args: any) => {
        expect(args.where.type).toBe('PLUMBER');
        return [mockContractor({ type: 'PLUMBER' })];
      });
      contractors.count.mockResolvedValue(1);

      await ContractorService.list({ type: 'PLUMBER' }, { page: 1, pageSize: 8 }, mockCtx('PLATFORM_ADMIN'));
    });

    it('passes skip/take through to the query and computes totalPages', async () => {
      contractors.findMany.mockImplementation(async (args: any) => {
        expect(args.skip).toBe(16);
        expect(args.take).toBe(8);
        return [mockContractor()];
      });
      contractors.count.mockResolvedValue(45);

      const result = await ContractorService.list({}, { page: 3, pageSize: 8 }, mockCtx('PLATFORM_ADMIN'));
      expect(result.pagination.totalPages).toBe(6);
      expect(result.pagination.page).toBe(3);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      await expect(ContractorService.list({}, {}, mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('update', () => {
    it('updates only the provided fields (partial update)', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      contractors.update.mockImplementation(async (args: any) => {
        expect(args.data.name).toBe('New Name');
        // Untouched fields are not in the update data.
        expect(args.data.address).toBeUndefined();
        expect(args.data.postCode).toBeUndefined();
        return mockContractor({ name: 'New Name' });
      });

      const result = (await ContractorService.update('contractor-1', { name: 'New Name' }, mockCtx('PLATFORM_ADMIN'))) as Record<string, unknown>;
      expect(result.name).toBe('New Name');
    });

    it('updates type and description', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      contractors.update.mockImplementation(async (args: any) => {
        expect(args.data.type).toBe('OTHER');
        expect(args.data.description).toBe('Handyman services');
        return mockContractor({ type: 'OTHER', description: 'Handyman services' });
      });

      await ContractorService.update('contractor-1', { type: 'OTHER', description: 'Handyman services' }, mockCtx('PLATFORM_ADMIN'));
    });

    it('clears the description (→ null) when an empty string is sent', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor({ description: 'Old text' }) as never);
      contractors.update.mockImplementation(async (args: any) => {
        expect(args.data.description).toBeNull();
        return mockContractor({ description: null });
      });

      await ContractorService.update('contractor-1', { description: '   ' }, mockCtx('PLATFORM_ADMIN'));
    });

    it('trims fields on update', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      contractors.update.mockImplementation(async (args: any) => {
        expect(args.data.email).toBe('clean@example.com');
        expect(args.data.phone).toBe('+44 28 555');
        return mockContractor({ email: 'clean@example.com', phone: '+44 28 555' });
      });

      await ContractorService.update('contractor-1', { email: '  clean@example.com  ', phone: ' +44 28 555 ' }, mockCtx('PLATFORM_ADMIN'));
    });

    it('throws NotFoundError when the contractor does not exist', async () => {
      contractors.findUnique.mockResolvedValue(null);
      await expect(ContractorService.update('missing', { name: 'X' }, mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(NotFoundError);
    });

    it.each([
      ['empty company name', () => ({ companyName: '' })],
      ['company name over 100 chars', () => ({ companyName: 'a'.repeat(101) })],
      ['empty name', () => ({ name: '' })],
      ['name over 100 chars', () => ({ name: 'a'.repeat(101) })],
      ['address over 255 chars', () => ({ address: 'a'.repeat(256) })],
      ['post code over 32 chars', () => ({ postCode: 'p'.repeat(33) })],
      ['empty email', () => ({ email: '' })],
      ['invalid email format', () => ({ email: 'not-an-email' })],
      ['email over 100 chars', () => ({ email: `${'a'.repeat(96)}@example.com` })],
      ['empty phone', () => ({ phone: '' })],
      ['phone over 32 chars', () => ({ phone: 'p'.repeat(33) })],
    ])('throws ValidationError for %s on update', async (_label, fields) => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      await expect(
        ContractorService.update('contractor-1', fields() as UpdateContractorInput, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ValidationError for an invalid type on update', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      await expect(
        ContractorService.update('contractor-1', { type: 'CASTLE' as never }, mockCtx('PLATFORM_ADMIN')),
      ).rejects.toThrow(ValidationError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      await expect(ContractorService.update('contractor-1', { name: 'X' }, mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('delete', () => {
    it('deletes a contractor and reports success', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      const result = await ContractorService.delete('contractor-1', mockCtx('PLATFORM_ADMIN'));
      expect(result.success).toBe(true);
      expect(contractors.delete).toHaveBeenCalledTimes(1);
    });

    it('works for TENANT_ADMIN (global directory — no org restriction)', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      const result = await ContractorService.delete('contractor-1', mockCtx('TENANT_ADMIN', 'org-1'));
      expect(result.success).toBe(true);
    });

    it('throws NotFoundError when the contractor does not exist', async () => {
      contractors.findUnique.mockResolvedValue(null);
      await expect(ContractorService.delete('missing', mockCtx('PLATFORM_ADMIN')))
        .rejects.toThrow(NotFoundError);
    });

    it('throws ForbiddenError for MEMBER', async () => {
      contractors.findUnique.mockResolvedValue(mockContractor() as never);
      await expect(ContractorService.delete('contractor-1', mockCtx('MEMBER')))
        .rejects.toThrow(ForbiddenError);
    });
  });
});

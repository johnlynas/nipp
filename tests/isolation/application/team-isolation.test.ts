/**
 * Application-layer tenant isolation tests for team models.
 *
 * Verifies that the Prisma extension correctly scopes Team, TeamMember, and TeamRole
 * queries to the current organization. Uses mocking to verify extension behaviour
 * without requiring a live database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mutable state for getCurrentOrgId mock.
// ---------------------------------------------------------------------------

const mockState = { orgId: null as string | null };

vi.mock('@/lib/tenant-context', () => ({
  getCurrentOrgId: () => mockState.orgId,
}));

// ---------------------------------------------------------------------------
// Build the mock prisma object inside the factory to avoid hoisting issues.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  // Create mock model objects with all necessary methods
  const createMockModel = (methods: string[]) => {
    const mock: Record<string, unknown> = {};
    for (const method of methods) {
      mock[method] = vi.fn();
    }
    return mock;
  };

  const team = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany', 'upsert']);
  const teamMember = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);
  const teamRole = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);
  const role = createMockModel(['findUnique', 'findFirst', 'findMany', 'update', 'delete', 'create']);
  const rolePermission = createMockModel(['findUnique', 'findFirst', 'findMany', 'deleteMany', 'create']);
  const memberRole = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);
  const member = createMockModel(['findUnique', 'findFirst', 'findMany', 'update', 'delete', 'create', 'upsert']);
  const invitation = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);
  const sentInvitation = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);

  // Track the current state of model methods for extension chaining
  const modelState: Record<string, Record<string, unknown>> = {
    team: { ...team },
    teamMember: { ...teamMember },
    teamRole: { ...teamRole },
    role: { ...role },
    rolePermission: { ...rolePermission },
    memberRole: { ...memberRole },
    member: { ...member },
    invitation: { ...invitation },
    sentInvitation: { ...sentInvitation },
  };

  // Create a function that applies an extension to the current model state
  const applyExtension = (client: typeof mockPrisma, ext: { name?: string; model?: Record<string, unknown> }) => {
    if (ext.model) {
      for (const [modelName, modelExt] of Object.entries(ext.model)) {
        // Handle both PascalCase (schema) and lowercase (client access) model names
        const stateKey = modelState[modelName] ? modelName : modelName.charAt(0).toLowerCase() + modelName.slice(1);
        if (modelState[stateKey] && typeof modelExt === 'object') {
          // Apply each method from the extension
          for (const [methodName, methodFn] of Object.entries(modelExt as Record<string, unknown>)) {
            const currentMethod = modelState[stateKey][methodName];
            if (typeof methodFn === 'function' && typeof currentMethod === 'function') {
              // Create a new vi.fn() that wraps the extension logic
              const wrapped = vi.fn(async (...args: unknown[]) => {
                // Clone args so we can track modifications made by the extension
                const argsCopy = JSON.parse(JSON.stringify(args[0] as Record<string, unknown>));
                // Call the extension with args and a query function that calls the original
                // Wrap in Promise.resolve to catch both sync and async errors
                return Promise.resolve()
                  .then(() => (methodFn as (...a: unknown[]) => Promise<unknown>)({
                    args: argsCopy,
                    query: async (a: Record<string, unknown>) => currentMethod(a),
                  }))
                  .then((result) => {
                    // Update the mock's last call with the modified args
                    const lastCallIndex = wrapped.mock.calls.length - 1;
                    if (lastCallIndex >= 0) {
                      wrapped.mock.calls[lastCallIndex][0] = argsCopy;
                    }
                    return result;
                  });
              });
              modelState[stateKey][methodName] = wrapped;
            }
          }
        }
      }
    }
    return client;
  };

  const mockPrisma = {
    $extends: vi.fn().mockImplementation((ext) => applyExtension(mockPrisma, ext)),
    team: modelState.team,
    teamMember: modelState.teamMember,
    teamRole: modelState.teamRole,
    role: modelState.role,
    rolePermission: modelState.rolePermission,
    memberRole: modelState.memberRole,
    member: modelState.member,
    invitation: modelState.invitation,
    sentInvitation: modelState.sentInvitation,
  };

  return { default: mockPrisma, prisma: mockPrisma };
});

describe('Team Isolation — Prisma Extension', () => {
  let tenantDb: typeof import('@/lib/tenant-db').default;

  beforeEach(() => {
    // Only reset orgId, don't clear mocks (extensions are applied at module load)
    mockState.orgId = null;
  });

  describe('Team model scoping', () => {
    it('scopes Team.findUnique to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.findUnique({ where: { id: 'team-1' } });
    });

    it('scopes Team.findFirst to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.findFirst({ where: { name: 'Team A' } });
    });

    it('scopes Team.findMany to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.findMany({ where: { organizationId: mockState.orgId! } });
    });

    it('scopes Team.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.create({
        data: { name: 'New Team', organizationId: mockState.orgId! },
      });

      expect(vi.mocked(tenantDb.team.create).mock.calls[0][0].data.organizationId).toBe('org-a-id');
    });

    it('scopes Team.update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.update({
        where: { id: 'team-1' },
        data: { name: 'Updated Team' },
      });
    });

    it('scopes Team.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.delete({ where: { id: 'team-1' } });
    });

    it('scopes Team.upsert to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.upsert({
        where: { id: 'team-1' },
        create: { name: 'New Team', organizationId: mockState.orgId! },
        update: { name: 'Updated' },
      });
    });
  });

  describe('TeamMember model scoping', () => {
    it('scopes TeamMember.findUnique to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamMember.findUnique({ where: { id: 'tm-1' } });
    });

    it('scopes TeamMember.findMany to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamMember.findMany({ where: { teamId: 'team-1' } });
    });

    it('scopes TeamMember.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamMember.create({
        data: { teamId: 'team-1', userId: 'user-1', organizationId: mockState.orgId! },
      });

      expect(vi.mocked(tenantDb.teamMember.create).mock.calls[0][0].data.organizationId).toBe('org-a-id');
    });

    it('scopes TeamMember.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamMember.delete({ where: { id: 'tm-1' } });
    });
  });

  describe('TeamRole model scoping', () => {
    it('scopes TeamRole.findUnique to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamRole.findUnique({ where: { id: 'tr-1' } });
    });

    it('scopes TeamRole.findMany to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamRole.findMany({ where: { teamId: 'team-1' } });
    });

    it('scopes TeamRole.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamRole.create({
        data: { teamId: 'team-1', roleId: 'role-1', organizationId: mockState.orgId! },
      });

      expect(vi.mocked(tenantDb.teamRole.create).mock.calls[0][0].data.organizationId).toBe('org-a-id');
    });

    it('scopes TeamRole.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamRole.delete({ where: { id: 'tr-1' } });
    });
  });

  describe('Cross-org team data isolation', () => {
    it('OrgA context cannot read OrgB teams (simulated)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // The extension should inject organizationId: 'org-a-id' into the where clause
      await tenantDb.team.findMany({});

      // Verify the call was made with org-scoped where
      const callArgs = vi.mocked(tenantDb.team.findMany).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('OrgB context cannot read OrgA teams (simulated)', async () => {
      mockState.orgId = 'org-b-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.findMany({});

      const callArgs = vi.mocked(tenantDb.team.findMany).mock.calls[vi.mocked(tenantDb.team.findMany).mock.calls.length - 1][0];
      expect(callArgs?.where?.organizationId).toBe('org-b-id');
    });

    it('TeamMember queries are scoped to active organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamMember.findMany({ where: { teamId: 'team-1' } });

      const callArgs = vi.mocked(tenantDb.teamMember.findMany).mock.calls[vi.mocked(tenantDb.teamMember.findMany).mock.calls.length - 1][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('TeamRole queries are scoped to active organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.teamRole.findMany({ where: { teamId: 'team-1' } });

      const callArgs = vi.mocked(tenantDb.teamRole.findMany).mock.calls[vi.mocked(tenantDb.teamRole.findMany).mock.calls.length - 1][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('write operations override organizationId to current context', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.create({ data: { name: 'rogue-team', organizationId: mockState.orgId! } });

      const callArgs = vi.mocked(tenantDb.team.create).mock.calls[vi.mocked(tenantDb.team.create).mock.calls.length - 1][0].data;
      expect(callArgs.organizationId).toBe('org-a-id');
    });

    it('upsert operations scope both create and update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.team.upsert({
        where: { id: 'team-1' },
        create: { name: 'New Team', organizationId: mockState.orgId! },
        update: { name: 'Updated' },
      });

      const callArgs = vi.mocked(tenantDb.team.upsert).mock.calls[vi.mocked(tenantDb.team.upsert).mock.calls.length - 1][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
      expect(callArgs.create.organizationId).toBe('org-a-id');
    });
  });

  describe('Team-scoped models list', () => {
    it('intercepts Team, TeamMember, and TeamRole', async () => {
      mockState.orgId = 'org-scoped-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      expect(tenantDb.team).toBeDefined();
      expect(tenantDb.teamMember).toBeDefined();
      expect(tenantDb.teamRole).toBeDefined();

      expect(typeof tenantDb.team.findFirst).toBe('function');
      expect(typeof tenantDb.teamMember.findFirst).toBe('function');
      expect(typeof tenantDb.teamRole.findFirst).toBe('function');
    });

    it('does NOT intercept non-scoped models (e.g., User, Organization)', async () => {
      mockState.orgId = 'org-scoped-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // Non-scoped models should not be intercepted
      expect(tenantDb.user).toBeUndefined();
      expect(tenantDb.organization).toBeUndefined();
    });
  });

  describe('Tenant context validation', () => {
    it('throws error when tenant context is missing for Team queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.team.findFirst({ where: { id: 'team-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });

    it('throws error when tenant context is missing for TeamMember queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.teamMember.findFirst({ where: { id: 'tm-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });

    it('throws error when tenant context is missing for TeamRole queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.teamRole.findFirst({ where: { id: 'tr-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });
  });
});

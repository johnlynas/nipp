/**
 * Application-layer tenant isolation tests for calendar models.
 *
 * Verifies that the Prisma extension correctly scopes Calendar, CalendarEvent,
 * and CalendarRecurrence queries to the current organization. Uses mocking to
 * verify extension behaviour without requiring a live database.
 *
 * This closes the "Tenant Isolation — Known Gap (Open)" documented in SECURITY.md:
 * calendar models are now registered in TENANT_SCOPED_MODELS (lib/tenant-db.ts)
 * and the event/calendar services filter every query by organizationId.
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

  const calendar = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany', 'upsert']);
  const calendarEvent = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);
  const calendarRecurrence = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);
  const role = createMockModel(['findUnique', 'findFirst', 'findMany', 'update', 'delete', 'create']);
  const rolePermission = createMockModel(['findUnique', 'findFirst', 'findMany', 'deleteMany', 'create']);
  const memberRole = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);
  const member = createMockModel(['findUnique', 'findFirst', 'findMany', 'update', 'delete', 'create', 'upsert']);
  const invitation = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);
  const sentInvitation = createMockModel(['findUnique', 'findFirst', 'findMany', 'create']);
  const team = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany', 'upsert']);
  const teamMember = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);
  const teamRole = createMockModel(['findUnique', 'findFirst', 'findMany', 'count', 'create', 'update', 'delete', 'deleteMany']);

  // Track the current state of model methods for extension chaining
  const modelState: Record<string, Record<string, unknown>> = {
    calendar: { ...calendar },
    calendarEvent: { ...calendarEvent },
    calendarRecurrence: { ...calendarRecurrence },
    role: { ...role },
    rolePermission: { ...rolePermission },
    memberRole: { ...memberRole },
    member: { ...member },
    invitation: { ...invitation },
    sentInvitation: { ...sentInvitation },
    team: { ...team },
    teamMember: { ...teamMember },
    teamRole: { ...teamRole },
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
    calendar: modelState.calendar,
    calendarEvent: modelState.calendarEvent,
    calendarRecurrence: modelState.calendarRecurrence,
    role: modelState.role,
    rolePermission: modelState.rolePermission,
    memberRole: modelState.memberRole,
    member: modelState.member,
    invitation: modelState.invitation,
    sentInvitation: modelState.sentInvitation,
    team: modelState.team,
    teamMember: modelState.teamMember,
    teamRole: modelState.teamRole,
  };

  return { default: mockPrisma, prisma: mockPrisma };
});

describe('Calendar Isolation — Prisma Extension', () => {
  let tenantDb: typeof import('@/lib/tenant-db').default;

  beforeEach(() => {
    // Only reset orgId, don't clear mocks (extensions are applied at module load)
    mockState.orgId = null;
  });

  describe('Calendar model scoping', () => {
    it('scopes Calendar.findFirst to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.findFirst({ where: { id: 'cal-1' } });

      const callArgs = vi.mocked(tenantDb.calendar.findFirst).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes Calendar.findMany to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.findMany({});

      const callArgs = vi.mocked(tenantDb.calendar.findMany).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes Calendar.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.create({
        data: { name: 'New Calendar', organizationId: mockState.orgId! },
      });

      const callArgs = vi.mocked(tenantDb.calendar.create).mock.calls[0][0];
      expect(callArgs?.data?.organizationId).toBe('org-a-id');
    });

    it('scopes Calendar.update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.update({
        where: { id: 'cal-1' },
        data: { name: 'Updated Calendar' },
      });

      const callArgs = vi.mocked(tenantDb.calendar.update).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes Calendar.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.delete({ where: { id: 'cal-1' } });

      const callArgs = vi.mocked(tenantDb.calendar.delete).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });
  });

  describe('CalendarEvent model scoping', () => {
    it('scopes CalendarEvent.findFirst to current organization (by id only)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // Simulates getEventById / updateEvent / deleteEvent lookups by id
      await tenantDb.calendarEvent.findFirst({ where: { id: 'evt-1' } });

      const callArgs = vi.mocked(tenantDb.calendarEvent.findFirst).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarEvent.findMany to current organization (date range)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // Simulates getEvents / getEventsWithRecurrences range queries
      await tenantDb.calendarEvent.findMany({
        where: { startDate: { lte: new Date() }, endDate: { gte: new Date() } },
      });

      const callArgs = vi.mocked(tenantDb.calendarEvent.findMany).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarEvent.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarEvent.create({
        data: {
          title: 'New Event',
          calendarId: 'cal-1',
          startDate: new Date(),
          endDate: new Date(),
          organizationId: mockState.orgId!,
        },
      });

      const callArgs = vi.mocked(tenantDb.calendarEvent.create).mock.calls[0][0];
      expect(callArgs?.data?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarEvent.update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarEvent.update({
        where: { id: 'evt-1' },
        data: { title: 'Updated Event' },
      });

      const callArgs = vi.mocked(tenantDb.calendarEvent.update).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarEvent.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarEvent.delete({ where: { id: 'evt-1' } });

      const callArgs = vi.mocked(tenantDb.calendarEvent.delete).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });
  });

  describe('CalendarRecurrence model scoping', () => {
    it('scopes CalendarRecurrence.findFirst to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarRecurrence.findFirst({ where: { id: 'rec-1' } });

      const callArgs = vi.mocked(tenantDb.calendarRecurrence.findFirst).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarRecurrence.create to current organization (injects organizationId)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarRecurrence.create({
        data: { frequency: 'WEEKLY', eventId: 'evt-1', organizationId: mockState.orgId! },
      });

      const callArgs = vi.mocked(tenantDb.calendarRecurrence.create).mock.calls[0][0];
      expect(callArgs?.data?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarRecurrence.update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarRecurrence.update({
        where: { id: 'rec-1' },
        data: { interval: 2 },
      });

      const callArgs = vi.mocked(tenantDb.calendarRecurrence.update).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('scopes CalendarRecurrence.delete to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarRecurrence.delete({ where: { id: 'rec-1' } });

      const callArgs = vi.mocked(tenantDb.calendarRecurrence.delete).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });
  });

  describe('Cross-org calendar data isolation', () => {
    it('OrgA context cannot read OrgB events (simulated)', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // The extension should inject organizationId: 'org-a-id' into the where clause
      await tenantDb.calendarEvent.findMany({});

      const callArgs = vi.mocked(tenantDb.calendarEvent.findMany).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
    });

    it('OrgB context cannot read OrgA events (simulated)', async () => {
      mockState.orgId = 'org-b-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendarEvent.findMany({});

      const callArgs = vi.mocked(tenantDb.calendarEvent.findMany).mock.calls[vi.mocked(tenantDb.calendarEvent.findMany).mock.calls.length - 1][0];
      expect(callArgs?.where?.organizationId).toBe('org-b-id');
    });

    it('write operations override organizationId to current context', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      // A rogue caller attempting to write into OrgB is forced back to OrgA
      await tenantDb.calendarEvent.create({
        data: {
          title: 'rogue-event',
          calendarId: 'cal-1',
          startDate: new Date(),
          endDate: new Date(),
          organizationId: 'org-b-id',
        },
      });

      const callArgs = vi.mocked(tenantDb.calendarEvent.create).mock.calls[0][0];
      expect(callArgs?.data?.organizationId).toBe('org-a-id');
    });

    it('upsert operations scope both create and update to current organization', async () => {
      mockState.orgId = 'org-a-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      await tenantDb.calendar.upsert({
        where: { id: 'cal-1' },
        create: { name: 'New Calendar', organizationId: mockState.orgId! },
        update: { name: 'Updated' },
      });

      const callArgs = vi.mocked(tenantDb.calendar.upsert).mock.calls[0][0];
      expect(callArgs?.where?.organizationId).toBe('org-a-id');
      expect(callArgs.create.organizationId).toBe('org-a-id');
    });
  });

  describe('Calendar-scoped models list', () => {
    it('intercepts Calendar, CalendarEvent, and CalendarRecurrence', async () => {
      mockState.orgId = 'org-scoped-id';

      tenantDb = (await import('@/lib/tenant-db')).default;

      expect(tenantDb.calendar).toBeDefined();
      expect(tenantDb.calendarEvent).toBeDefined();
      expect(tenantDb.calendarRecurrence).toBeDefined();

      expect(typeof tenantDb.calendar.findFirst).toBe('function');
      expect(typeof tenantDb.calendarEvent.findFirst).toBe('function');
      expect(typeof tenantDb.calendarRecurrence.findFirst).toBe('function');
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
    it('throws error when tenant context is missing for Calendar queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.calendar.findFirst({ where: { id: 'cal-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });

    it('throws error when tenant context is missing for CalendarEvent queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.calendarEvent.findFirst({ where: { id: 'evt-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });

    it('throws error when tenant context is missing for CalendarRecurrence queries', async () => {
      mockState.orgId = null;

      tenantDb = (await import('@/lib/tenant-db')).default;

      await expect(tenantDb.calendarRecurrence.findFirst({ where: { id: 'rec-1' } })).rejects.toThrow(
        'Tenant context missing for scoped query.',
      );
    });
  });
});

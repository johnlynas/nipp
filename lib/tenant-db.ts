import prisma from './db';
import { getCurrentOrgId } from './tenant-context';

const TENANT_SCOPED_MODELS = ['Role', 'RolePermission', 'MemberRole', 'Member', 'Invitation', 'SentInvitation'] as const;

/**
 * Create a tenant isolation extension for a specific model.
 * Only these models are intercepted - non-scoped models have zero overhead.
 */
function createTenantExtensionForModel(model: string) {
  const orgField = model === 'Member' ? 'orgId' : 'organizationId';

  return {
    name: `tenant-isolation-${model.toLowerCase()}`,
    model: {
      [model]: {
        async findUnique({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async findFirst({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async findMany({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async update({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async updateMany({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async delete({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async deleteMany({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          return query(args);
        },
        async create({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.data = { ...args.data, [orgField]: orgId };
          return query(args);
        },
        async upsert({ args, query }) {
          const orgId = getCurrentOrgId();
          if (!orgId) throw new Error('Tenant context missing for scoped query.');
          args.where = { ...args.where, [orgField]: orgId };
          if (args.create) args.create = { ...args.create, [orgField]: orgId };
          if (args.update) args.update = { ...args.update, [orgField]: orgId };
          return query(args);
        },
      },
    },
  };
}

// Create extensions only for tenant-scoped models (zero overhead for others)
const tenantExtensions = TENANT_SCOPED_MODELS.map(createTenantExtensionForModel);

// Compose all extensions into a single tenant-aware Prisma client
// Defensive check for test environments where $extends might not be mocked
let tenantDb = prisma; // Default fallback to raw client if $extends is unavailable

if (typeof prisma.$extends === 'function') {
  tenantDb = prisma.$extends(...tenantExtensions);
}

export { tenantDb };
export default tenantDb;

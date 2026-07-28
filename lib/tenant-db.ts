import prisma from './db';
import { getCurrentOrgId } from './tenant-context';

const TENANT_SCOPED_MODELS = ['Role', 'RolePermission', 'MemberRole', 'Member', 'Invitation', 'SentInvitation'] as const;

/** Structural type for Prisma extension query callbacks. */
type QueryArgs = Record<string, unknown>;

interface ExtensionCallback {
  args: QueryArgs;
  query: (args: QueryArgs) => Promise<unknown>;
}

/** Minimal interface for chaining $extends calls in reduce. */
interface Extendable {
  $extends(extension: unknown): Extendable;
}

/**
 * Create a tenant isolation extension for a specific model.
 * Only these models are intercepted — non-scoped models have zero overhead.
 */
function createTenantExtensionForModel(model: string) {
  const orgField = model === 'Member' ? 'orgId' : 'organizationId';

  function assertTenantContext(): string {
    const orgId = getCurrentOrgId();
    if (!orgId) throw new Error('Tenant context missing for scoped query.');
    return orgId;
  }

  /** Shared handler for all where-based operations (find, update, delete). */
  async function scopeWhere({ args, query }: ExtensionCallback): Promise<unknown> {
    args.where = { ...(args.where as QueryArgs), [orgField]: assertTenantContext() };
    return query(args);
  }

  // Plain object — no Prisma.defineExtension (its DynamicModelExtensionArgs
  // can't resolve computed property keys like [model] at the type level).
  return {
    name: `tenant-isolation-${model.toLowerCase()}`,
    model: {
      [model]: {
        findUnique: scopeWhere,
        findFirst: scopeWhere,
        findMany: scopeWhere,
        update: scopeWhere,
        updateMany: scopeWhere,
        delete: scopeWhere,
        deleteMany: scopeWhere,

        async create({ args, query }: ExtensionCallback): Promise<unknown> {
          args.data = { ...(args.data as QueryArgs), [orgField]: assertTenantContext() };
          return query(args);
        },

        async upsert({ args, query }: ExtensionCallback): Promise<unknown> {
          const orgId = assertTenantContext();
          args.where = { ...(args.where as QueryArgs), [orgField]: orgId };
          if (args.create) args.create = { ...(args.create as QueryArgs), [orgField]: orgId };
          if (args.update) args.update = { ...(args.update as QueryArgs), [orgField]: orgId };
          return query(args);
        },
      },
    },
  };
}

// Create extensions only for tenant-scoped models (zero overhead for others)
const tenantExtensions = TENANT_SCOPED_MODELS.map(createTenantExtensionForModel);

// Compose all extensions by chaining $extends (it accepts ONE argument per call).
// Cast through Extendable to bypass Prisma's strict per-model type validation —
// the extension shape is correct at runtime.
const tenantDb = tenantExtensions.reduce(
  (client, ext) => client.$extends(ext),
  prisma as unknown as Extendable,
) as unknown as typeof prisma;

export { tenantDb };
export default tenantDb;
import prisma from './db';
import { getCurrentOrgId } from './tenant-context';

/**
 * Models exempt from tenant scoping (global models).
 * These are managed by BetterAuth and not organization-specific.
 */
const EXEMPT_MODELS = new Set([
  'User',
  'Session',
  'Account',
  'Organization',
  'Member',
  'Invitation',
  'SentInvitation',
]);

/**
 * Tenant-scoped Prisma client wrapper.
 *
 * Automatically injects `organizationId` into the `where` clause of all queries
 * on organization-scoped models. Reads the current org ID from AsyncLocalStorage
 * via `lib/tenant-context.ts`.
 *
 * Usage: import tenantDb from '@/lib/tenant-db';
 *        const properties = await tenantDb.findMany('Property', {});
 */

/**
 * Get the current organization ID from tenant context.
 * Throws if no active organization context exists for non-exempt models.
 */
function requireOrgId(model: string): string {
  if (EXEMPT_MODELS.has(model)) return '';

  const orgId = getCurrentOrgId();
  if (!orgId) {
    throw new Error(
      `No active organization context for model "${model}". ` +
        'Ensure tenant context is established via middleware before executing queries.'
    );
  }
  return orgId;
}

/**
 * Execute a Prisma query with automatic tenant scoping.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function query<ModelName extends string>(
  model: ModelName,
  operation: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args?: any
): Promise<any> {
  const orgId = requireOrgId(model);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modifiedArgs: Record<string, unknown> = args ? { ...args } : {};

  if (orgId && operation !== '$executeRaw' && operation !== '$queryRaw') {
    if (modifiedArgs.where && typeof modifiedArgs.where === 'object') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      modifiedArgs.where = { ...(modifiedArgs.where as any), organizationId: orgId };
    } else if (['findFirst', 'findUnique'].includes(operation)) {
      modifiedArgs.where = { organizationId: orgId };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modelClient = (prisma as any)[model];
  if (!modelClient || typeof modelClient[operation] !== 'function') {
    throw new Error(`Unknown Prisma operation: ${model}.${operation}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return modelClient[operation](modifiedArgs);
}

/**
 * Tenant-scoped Prisma client with automatic organizationId injection.
 *
 * For each model, wraps the standard Prisma methods to inject tenant scoping.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTenantModel<ModelName extends string>(modelName: ModelName): any {
  return new Proxy(
    {},
    {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get(_target, operation: string) {
        return async (...args: any[]) => query(modelName, operation, args[0]);
      },
    }
  );
}

// Create tenant-scoped wrappers for all models
const tenantDb: Record<string, unknown> = {
  query,
};

for (const model of ['User', 'Session', 'Account', 'Organization', 'Member', 'Invitation', 'SentInvitation']) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (tenantDb as any)[model] = createTenantModel(model);
}

export default tenantDb;

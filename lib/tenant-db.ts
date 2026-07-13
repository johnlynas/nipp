import { Prisma } from '@prisma/client';
import prisma from './db';
import { getCurrentOrgId } from './tenant-context';

const TENANT_SCOPED_MODELS = ['Role', 'RolePermission', 'MemberRole'] as const;

const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      async findUnique({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async findFirst({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async findMany({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async update({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async updateMany({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async delete({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async deleteMany({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where']);
        return query(args);
      },
      async create({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['data']);
        return query(args);
      },
      async upsert({ args, query, model }) {
        if (TENANT_SCOPED_MODELS.includes(model as any)) args = injectTenantContext(args, ['where', 'create', 'update']);
        return query(args);
      },
    },
  },
});

function injectTenantContext(args: any, paths: string[]): any {
  const orgId = getCurrentOrgId();
  if (!orgId) throw new Error('Tenant context missing for scoped query.');
  for (const path of paths) {
    if (path === 'where') { args.where = args.where || {}; args.where.organizationId = orgId; }
    else if (path === 'data') { args.data = args.data || {}; args.data.organizationId = orgId; }
    else if (path === 'create') { args.create = args.create || {}; args.create.organizationId = orgId; }
    else if (path === 'update') { args.update = args.update || {}; args.update.organizationId = orgId; }
  }
  return args;
}

export const tenantDb = prisma.$extends(tenantExtension);
export default tenantDb;
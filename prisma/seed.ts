/**
 * Prisma seed script.
 *
 * Creates:
 * - The Platform Organization (for Super Admins)
 * - The master permission catalog (all resource:action pairs)
 * - The initial Super Admin user assigned to the Platform Organization
 *
 * Default roles for tenant organizations are NO LONGER seeded here.
 * They are automatically created via BetterAuth's organization lifecycle hooks
 * (see lib/auth.ts plugins configuration).
 *
 * Run with: `npm run db:seed` (or `npx prisma db seed`).
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLE_NAMES } from '@/lib/constants';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Permission catalog — all resource:action pairs used across the application
// ---------------------------------------------------------------------------

const PERMISSION_CATALOG = [
  // Properties
  { key: 'properties:view', resource: 'properties', action: 'view', description: 'View properties' },
  { key: 'properties:create', resource: 'properties', action: 'create', description: 'Create properties' },
  { key: 'properties:update', resource: 'properties', action: 'update', description: 'Update properties' },
  { key: 'properties:delete', resource: 'properties', action: 'delete', description: 'Delete properties' },
  { key: 'properties:manage', resource: 'properties', action: 'manage', description: 'Full property management' },

  // Tenants
  { key: 'tenants:view', resource: 'tenants', action: 'view', description: 'View tenants' },
  { key: 'tenants:create', resource: 'tenants', action: 'create', description: 'Create tenants' },
  { key: 'tenants:update', resource: 'tenants', action: 'update', description: 'Update tenants' },
  { key: 'tenants:delete', resource: 'tenants', action: 'delete', description: 'Delete tenants' },
  { key: 'tenants:manage', resource: 'tenants', action: 'manage', description: 'Full tenant management' },

  // Financials
  { key: 'financials:view', resource: 'financials', action: 'view', description: 'View financial data' },
  { key: 'financials:create', resource: 'financials', action: 'create', description: 'Create financial records' },
  { key: 'financials:update', resource: 'financials', action: 'update', description: 'Update financial records' },
  { key: 'financials:delete', resource: 'financials', action: 'delete', description: 'Delete financial records' },
  { key: 'financials:export', resource: 'financials', action: 'export', description: 'Export financial reports' },
  { key: 'financials:report', resource: 'financials', action: 'report', description: 'Generate financial reports' },
  { key: 'financials:manage', resource: 'financials', action: 'manage', description: 'Full financial management' },

  // Maintenance
  { key: 'maintenance:view', resource: 'maintenance', action: 'view', description: 'View maintenance requests' },
  { key: 'maintenance:create', resource: 'maintenance', action: 'create', description: 'Create maintenance requests' },
  { key: 'maintenance:update', resource: 'maintenance', action: 'update', description: 'Update maintenance requests' },
  { key: 'maintenance:delete', resource: 'maintenance', action: 'delete', description: 'Delete maintenance requests' },
  { key: 'maintenance:manage', resource: 'maintenance', action: 'manage', description: 'Full maintenance management' },

  // Contractors
  { key: 'contractors:view', resource: 'contractors', action: 'view', description: 'View contractors' },
  { key: 'contractors:create', resource: 'contractors', action: 'create', description: 'Create contractors' },
  { key: 'contractors:update', resource: 'contractors', action: 'update', description: 'Update contractors' },
  { key: 'contractors:delete', resource: 'contractors', action: 'delete', description: 'Delete contractors' },
  { key: 'contractors:manage', resource: 'contractors', action: 'manage', description: 'Full contractor management' },

  // Roles (RBAC management)
  { key: 'roles:view', resource: 'roles', action: 'view', description: 'View roles' },
  { key: 'roles:create', resource: 'roles', action: 'create', description: 'Create roles' },
  { key: 'roles:update', resource: 'roles', action: 'update', description: 'Update roles' },
  { key: 'roles:delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  { key: 'roles:manage', resource: 'roles', action: 'manage', description: 'Full role management' },

  // Members
  { key: 'members:view', resource: 'members', action: 'view', description: 'View members' },
  { key: 'members:invite', resource: 'members', action: 'invite', description: 'Invite members' },
  { key: 'members:update', resource: 'members', action: 'update', description: 'Update member roles' },
  { key: 'members:delete', resource: 'members', action: 'delete', description: 'Remove members' },
  { key: 'members:manage', resource: 'members', action: 'manage', description: 'Full member management' },

  // Viewings
  { key: 'viewings:manage', resource: 'viewings', action: 'manage', description: 'Manage viewings' },

  // Applications
  { key: 'applications:review', resource: 'applications', action: 'review', description: 'Review applications' },
] as const;

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nipp.gov.uk';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

  // -----------------------------------------------------------------------
  // Step 1: Create or retrieve the Platform Organization
  // -----------------------------------------------------------------------
  let platformOrg = await prisma.organization.findFirst({
    where: { name: 'Platform' },
  });

  if (!platformOrg) {
    platformOrg = await prisma.organization.create({
      data: {
        name: 'Platform',
        slug: 'platform',
        metadata: { type: 'platform' as const },
      },
    });
    console.log(`Created Platform Organization: ${platformOrg.id}`);

    // Persist the ID so it can be used at runtime
    const fs = await import('fs');
    const path = await import('path');
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    try {
      envContent = fs.readFileSync(envPath, 'utf-8');
    } catch {
      // .env may not exist yet; that's OK — the value is in process.env if set
    }

    const marker = 'PLATFORM_ORGANIZATION_ID=';
    const existingLine = envContent.split('\n').find((line) => line.startsWith(marker));
    if (existingLine) {
      envContent = envContent.replace(existingLine, `${marker}${platformOrg.id}`);
    } else {
      envContent += `\n${marker}${platformOrg.id}\n`;
    }
    fs.writeFileSync(envPath, envContent);
    console.log(`PLATFORM_ORGANIZATION_ID=${platformOrg.id} written to .env`);
  } else {
    console.log(`Platform Organization already exists: ${platformOrg.id}`);
  }

  // -----------------------------------------------------------------------
  // Step 2: Bootstrap the master permission catalog (upsert each permission)
  // -----------------------------------------------------------------------
  let permissionsCreated = 0;
  for (const perm of PERMISSION_CATALOG) {
    const result = await prisma.permission.upsert({
      where: { key: perm.key },
      update: { description: perm.description },
      create: {
        key: perm.key,
        resource: perm.resource,
        action: perm.action,
        description: perm.description,
      },
    });
    if (result.id) {
      // First upsert creates; subsequent ones are no-ops
    }
  }
  console.log(`Permission catalog ensured: ${PERMISSION_CATALOG.length} permissions`);

  // -----------------------------------------------------------------------
  // Step 3: Create or update the Super Admin user
  // -----------------------------------------------------------------------
  let superAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (superAdmin) {
    // Update existing user
    await prisma.user.update({
      where: { id: superAdmin.id },
      data: {
        name: 'System Administrator',
        emailVerified: true,
        role: 'super_admin',
      },
    });

    // Ensure credential account exists
    const existingAccount = await prisma.account.findFirst({
      where: { userId: superAdmin.id, providerId: 'credential' },
    });

    if (!existingAccount) {
      const passwordHash = await hashPassword(adminPassword);
      await prisma.account.create({
        data: {
          id: superAdmin.id,
          accountId: superAdmin.id,
          providerId: 'credential',
          password: passwordHash,
          userId: superAdmin.id,
        },
      });
    } else {
      // Update password hash if it doesn't match (e.g., password changed)
      const passwordHash = await hashPassword(adminPassword);
      if (existingAccount.password !== passwordHash) {
        await prisma.account.update({
          where: { id: existingAccount.id },
          data: { password: passwordHash },
        });
      }
    }

    // Ensure Super Admin is a member of the Platform Organization
    const existingMember = await prisma.member.findFirst({
      where: { userId: superAdmin.id, orgId: platformOrg.id },
    });

    if (!existingMember) {
      await prisma.member.create({
        data: {
          userId: superAdmin.id,
          orgId: platformOrg.id,
          role: 'super_admin',
        },
      });
    }

    console.log(`Super Admin user ensured: ${adminEmail}`);
  } else {
    // Create new Super Admin user and account
    const passwordHash = await hashPassword(adminPassword);

    superAdmin = await prisma.user.create({
      data: {
        name: 'System Administrator',
        email: adminEmail,
        passwordHash,
        emailVerified: true,
        role: 'super_admin',
      },
    });

    await prisma.account.create({
      data: {
        id: superAdmin.id,
        accountId: superAdmin.id,
        providerId: 'credential',
        password: passwordHash,
        userId: superAdmin.id,
      },
    });

    await prisma.member.create({
      data: {
        userId: superAdmin.id,
        orgId: platformOrg.id,
        role: 'super_admin',
      },
    });

    console.log(`Super Admin user created: ${adminEmail}`);
  }

  // -----------------------------------------------------------------------
  // Step 4: Verify no tenant default roles were seeded here.
  // Default roles are created via BetterAuth onCreateOrganization hook.
  // -----------------------------------------------------------------------
  console.log('Tenant default roles are NOT seeded here — handled by lifecycle hooks.');

  console.log('\n✅ Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

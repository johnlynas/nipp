import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

// Full 43-permission catalog (4 platform + 39 tenant)
const PERMISSION_CATALOG = [
  // Platform permissions (4)
  { key: 'platform:manage_organizations', resource: 'platform', action: 'manage_organizations', description: 'Manage tenant organizations' },
  { key: 'platform:manage_roles', resource: 'platform', action: 'manage_roles', description: 'Manage global roles' },
  { key: 'platform:manage_permissions', resource: 'platform', action: 'manage_permissions', description: 'Manage global permission catalog' },
  { key: 'platform:view_audit_logs', resource: 'platform', action: 'view_audit_logs', description: 'View audit logs across all organizations' },
  
  // Tenant permissions (39)
  { key: 'organizations:read', resource: 'organizations', action: 'read', description: 'View organization details' },
  { key: 'organizations:create', resource: 'organizations', action: 'create', description: 'Create new organizations' },
  { key: 'organizations:update', resource: 'organizations', action: 'update', description: 'Update organization details' },
  { key: 'organizations:delete', resource: 'organizations', action: 'delete', description: 'Delete organizations' },
  
  { key: 'members:read', resource: 'members', action: 'read', description: 'View organization members' },
  { key: 'members:create', resource: 'members', action: 'create', description: 'Invite new members' },
  { key: 'members:update', resource: 'members', action: 'update', description: 'Update member roles' },
  { key: 'members:delete', resource: 'members', action: 'delete', description: 'Remove members' },
  
  { key: 'roles:read', resource: 'roles', action: 'read', description: 'View organization roles' },
  { key: 'roles:create', resource: 'roles', action: 'create', description: 'Create new roles' },
  { key: 'roles:update', resource: 'roles', action: 'update', description: 'Update role permissions' },
  { key: 'roles:delete', resource: 'roles', action: 'delete', description: 'Delete roles' },
  
  { key: 'properties:read', resource: 'properties', action: 'read', description: 'View property details' },
  { key: 'properties:create', resource: 'properties', action: 'create', description: 'Create new properties' },
  { key: 'properties:update', resource: 'properties', action: 'update', description: 'Update property details' },
  { key: 'properties:delete', resource: 'properties', action: 'delete', description: 'Delete properties' },
  
  { key: 'tenants:read', resource: 'tenants', action: 'read', description: 'View tenant details' },
  { key: 'tenants:create', resource: 'tenants', action: 'create', description: 'Create new tenants' },
  { key: 'tenants:update', resource: 'tenants', action: 'update', description: 'Update tenant details' },
  { key: 'tenants:delete', resource: 'tenants', action: 'delete', description: 'Delete tenants' },
  
  { key: 'leases:read', resource: 'leases', action: 'read', description: 'View lease details' },
  { key: 'leases:create', resource: 'leases', action: 'create', description: 'Create new leases' },
  { key: 'leases:update', resource: 'leases', action: 'update', description: 'Update lease details' },
  { key: 'leases:delete', resource: 'leases', action: 'delete', description: 'Delete leases' },
  
  { key: 'documents:read', resource: 'documents', action: 'read', description: 'View document details' },
  { key: 'documents:create', resource: 'documents', action: 'create', description: 'Upload new documents' },
  { key: 'documents:update', resource: 'documents', action: 'update', description: 'Update document details' },
  { key: 'documents:delete', resource: 'documents', action: 'delete', description: 'Delete documents' },
  
  { key: 'payments:read', resource: 'payments', action: 'read', description: 'View payment details' },
  { key: 'payments:create', resource: 'payments', action: 'create', description: 'Process new payments' },
  { key: 'payments:update', resource: 'payments', action: 'update', description: 'Update payment details' },
  { key: 'payments:delete', resource: 'payments', action: 'delete', description: 'Delete payments' },
  
  { key: 'reports:read', resource: 'reports', action: 'read', description: 'View reports' },
  { key: 'reports:generate', resource: 'reports', action: 'generate', description: 'Generate reports' },
  
  { key: 'settings:read', resource: 'settings', action: 'read', description: 'View organization settings' },
  { key: 'settings:update', resource: 'settings', action: 'update', description: 'Update organization settings' },
  
  { key: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs' },
  
  { key: 'viewings:read', resource: 'viewings', action: 'read', description: 'View property viewings' },
  { key: 'viewings:create', resource: 'viewings', action: 'create', description: 'Schedule property viewings' },
];

async function main() {
  // =========================================================================
  // 1. STRICT ENVIRONMENT VARIABLE VALIDATION
  // =========================================================================
  const adminEmail = process.env.ADMIN_EMAIL?.trim();
  if (!adminEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
    console.error('\n❌ ERROR: ADMIN_EMAIL is required and must be a valid email format.');
    console.error('Please add a valid email to your .env file:');
    console.error('ADMIN_EMAIL=admin@nipp.gov.uk\n');
    process.exit(1);
  }

  const adminPassword = process.env.ADMIN_PASSWORD?.trim();
  if (!adminPassword || adminPassword.length <= 8) {
    console.error('\n❌ ERROR: ADMIN_PASSWORD is required and must be greater than 8 characters.');
    console.error(`Current length: ${adminPassword?.length || 0}. Please update your .env file.\n`);
    process.exit(1);
  }

  const envPlatformOrgId = process.env.PLATFORM_ORG_ID?.trim();
  if (!envPlatformOrgId) {
    console.warn('\n⚠️ WARNING: PLATFORM_ORG_ID environment variable is not set.');
    console.warn('The script will attempt to find or create the Platform Organization automatically.\n');
  }

  // =========================================================================
  // 2. PLATFORM ORGANIZATION RESOLUTION & UPDATE
  // =========================================================================
  let platformOrgId = envPlatformOrgId;
  let platformOrg = null;

  if (platformOrgId) {
    platformOrg = await prisma.organization.findUnique({ where: { id: platformOrgId } });
  }

  if (!platformOrg) {
    platformOrg = await prisma.organization.findFirst({
      where: { OR: [{ slug: 'platform' }, { name: 'Platform' }] },
    });
  }

  if (platformOrg) {
    // OVERWRITE: Update existing Platform Org to ensure it matches script definitions
    platformOrg = await prisma.organization.update({
      where: { id: platformOrg.id },
      data: {
        name: 'Platform',
        slug: 'platform',
        status: 'ACTIVE',
        metadata: { type: 'platform' },
      },
    });
    console.log(`✅ Updated existing Platform Organization: ${platformOrg.id}`);
  } else {
    platformOrg = await prisma.organization.create({
      data: {
        name: 'Platform',
        slug: 'platform',
        status: 'ACTIVE',
        metadata: { type: 'platform' },
      },
    });
    console.log(`✅ Created new Platform Organization: ${platformOrg.id}`);
  }
  platformOrgId = platformOrg.id;

  // =========================================================================
  // 3. PERMISSION CATALOG (FORCE UPSERT)
  // =========================================================================
  const permissionIds: string[] = [];
  for (const perm of PERMISSION_CATALOG) {
    // OVERWRITE: 'update: perm' ensures descriptions/actions are updated if changed in script
    const created = await prisma.permission.upsert({
      where: { key: perm.key },
      update: perm, 
      create: perm,
    });
    permissionIds.push(created.id);
  }
  console.log(`✅ Permission catalog overwritten/ensured: ${PERMISSION_CATALOG.length} permissions`);

  // =========================================================================
  // 4. SUPER ADMIN ROLE & PERMISSIONS (FORCE RESET)
  // =========================================================================
  let superAdminRole = await prisma.role.findFirst({
    where: { name: 'Super Admin', organizationId: platformOrgId },
  });

  if (superAdminRole) {
    // OVERWRITE: Update role details
    await prisma.role.update({
      where: { id: superAdminRole.id },
      data: {
        description: 'Full platform administration access',
        isDefault: true,
      },
    });
    
    // OVERWRITE: Delete existing permissions for this role and recreate them 
    // to ensure exact match with the script (removes any stale permissions)
    await prisma.rolePermission.deleteMany({ where: { roleId: superAdminRole.id } });
    
    for (const permId of permissionIds) {
      await prisma.rolePermission.create({
        data: {
          role: { connect: { id: superAdminRole.id } },
          permission: { connect: { id: permId } },
          organization: { connect: { id: platformOrgId } }, // ✅ FIX: Required by schema
        },
      });
    }
    console.log(`✅ Overwritten Super Admin role permissions: ${superAdminRole.id}`);
  } else {
    superAdminRole = await prisma.role.create({
      data: {
        name: 'Super Admin',
        description: 'Full platform administration access',
        organizationId: platformOrgId,
        isDefault: true,
      },
    });

    for (const permId of permissionIds) {
      await prisma.rolePermission.create({
        data: {
          role: { connect: { id: superAdminRole.id } },
          permission: { connect: { id: permId } },
          organization: { connect: { id: platformOrgId } }, // ✅ FIX: Required by schema
        },
      });
    }
    console.log(`✅ Created Super Admin role: ${superAdminRole.id}`);
  }

  // =========================================================================
  // 5. SUPER ADMIN USER (FORCE UPDATE)
  // =========================================================================
  const passwordHash = await hashPassword(adminPassword);
  
  // OVERWRITE: Upsert ensures user is created if missing, or updated if exists
  // This forces the password and activeOrganizationId to update if .env changes
  const superAdmin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: 'System Administrator',
      emailVerified: true,
      role: 'super_admin',
      activeOrganizationId: platformOrgId,
      passwordHash: passwordHash,
    },
    create: {
      name: 'System Administrator',
      email: adminEmail,
      passwordHash: passwordHash,
      emailVerified: true,
      role: 'super_admin',
      activeOrganizationId: platformOrgId,
    },
  });
  console.log(`✅ Overwritten/Created Super Admin user: ${adminEmail}`);

  // =========================================================================
  // 6. CREDENTIAL ACCOUNT (FORCE UPDATE)
  // =========================================================================
  const existingAccount = await prisma.account.findFirst({
    where: { userId: superAdmin.id, providerId: 'credential' },
  });

  if (existingAccount) {
    // OVERWRITE: Update password hash to match the new user password
    await prisma.account.update({
      where: { id: existingAccount.id },
      data: { password: passwordHash },
    });
    console.log(`✅ Updated credential account password`);
  } else {
    await prisma.account.create({
      data: {
        id: superAdmin.id,
        accountId: superAdmin.id,
        providerId: 'credential',
        password: passwordHash,
        userId: superAdmin.id,
      },
    });
    console.log(`✅ Created credential account for Super Admin`);
  }

  // =========================================================================
  // 7. MEMBER RECORD & ROLE ASSIGNMENT
  // =========================================================================
  let member = await prisma.member.findFirst({
    where: { userId: superAdmin.id, orgId: platformOrgId },
  });

  if (!member) {
    member = await prisma.member.create({
      data: {
        userId: superAdmin.id,
        orgId: platformOrgId,
        role: 'admin',
      },
    });
    console.log(`✅ Created Member record: ${member.id}`);
  }

  const existingMemberRole = await prisma.memberRole.findFirst({
    where: { memberId: member.id, roleId: superAdminRole.id },
  });

  if (!existingMemberRole) {
    await prisma.memberRole.create({
      data: {
        member: { connect: { id: member.id } },
        role: { connect: { id: superAdminRole.id } },
        organization: { connect: { id: platformOrgId } },
      },
    });
    console.log(`✅ Assigned Super Admin role to member`);
  }

  // =========================================================================
  // 8. TENANT ORGANIZATIONS (OrgA & OrgB)
  // =========================================================================
  // Always create two tenant organizations for super admin tenant management
  // testing. In test mode (TEST_ADMIN_EMAIL set), also create dedicated
  // tenant users with configurable credentials. In dev mode, use defaults.
  const testMode = !!process.env.TEST_ADMIN_EMAIL?.trim();

  // Tenant credentials — use env vars in test mode, defaults in dev mode
  const tenantAEmail = process.env.TEST_TENANT_A_EMAIL || 'orga-tenant@example.com';
  const tenantAPassword = process.env.TEST_TENANT_A_PASSWORD || 'TenantA123!';
  const tenantBEmail = process.env.TEST_TENANT_B_EMAIL || 'orgb-tenant@example.com';
  const tenantBPassword = process.env.TEST_TENANT_B_PASSWORD || 'TenantB123!';

  const modeLabel = testMode ? 'TEST' : 'DEV';
  console.log(`\n📦 Seeding tenant organizations (${modeLabel} mode)...`);

  // --- OrgA: Acme Properties Ltd ---
  let orgA = await prisma.organization.findFirst({ where: { slug: 'acme-properties-ltd' } });
  if (!orgA) {
    orgA = await prisma.organization.create({
      data: { name: 'Acme Properties Ltd', slug: 'acme-properties-ltd', status: 'ACTIVE' },
    });
    console.log(`✅ Created OrgA: ${orgA.id}`);
  } else {
    await prisma.organization.update({ where: { id: orgA.id }, data: { name: 'Acme Properties Ltd', slug: 'acme-properties-ltd', status: 'ACTIVE' } });
    console.log(`✅ Updated OrgA: ${orgA.id}`);
  }

  // Create or update OrgA tenant user
  const orgATenantPasswordHash = await hashPassword(tenantAPassword);
  const orgATenantUser = await prisma.user.upsert({
    where: { email: tenantAEmail },
    update: { passwordHash: orgATenantPasswordHash, emailVerified: true, activeOrganizationId: orgA.id },
    create: {
      name: 'OrgA Tenant',
      email: tenantAEmail,
      passwordHash: orgATenantPasswordHash,
      emailVerified: true,
      activeOrganizationId: orgA.id,
    },
  });

  // Create credential account for OrgA tenant user
  const orgATenantAccount = await prisma.account.findFirst({ where: { userId: orgATenantUser.id, providerId: 'credential' } });
  if (!orgATenantAccount) {
    await prisma.account.create({ data: { id: orgATenantUser.id, accountId: orgATenantUser.id, providerId: 'credential', password: orgATenantPasswordHash, userId: orgATenantUser.id } });
  }

  // Add OrgA tenant user as member of OrgA with default roles
  let orgAMemberId: string;
  const existingOrgAMember = await prisma.member.findFirst({ where: { userId: orgATenantUser.id, orgId: orgA.id } });
  if (existingOrgAMember) {
    orgAMemberId = existingOrgAMember.id;
  } else {
    const newOrgAMember = await prisma.member.create({ data: { userId: orgATenantUser.id, orgId: orgA.id, role: 'member' } });
    orgAMemberId = newOrgAMember.id;
    console.log(`✅ Added OrgA tenant user as member of OrgA`);
  }

  // Assign default roles to OrgA tenant user (member, property-manager, viewer)
  const orgARoles = await prisma.role.findMany({ where: { organizationId: orgA.id, isDefault: true } });
  for (const role of orgARoles) {
    const roleId = role.id;
    const existingMemberRole = await prisma.memberRole.findFirst({ where: { memberId: orgAMemberId, roleId } });
    if (!existingMemberRole) {
      await prisma.memberRole.create({
        data: {
          member: { connect: { id: orgAMemberId } },
          role: { connect: { id: roleId } },
          organization: { connect: { id: orgA.id } },
        },
      });
    }
  }

  // --- OrgB: Belfast Rentals ---
  let orgB = await prisma.organization.findFirst({ where: { slug: 'belfast-rentals' } });
  if (!orgB) {
    orgB = await prisma.organization.create({ data: { name: 'Belfast Rentals', slug: 'belfast-rentals', status: 'ACTIVE' } });
    console.log(`✅ Created OrgB: ${orgB.id}`);
  } else {
    await prisma.organization.update({ where: { id: orgB.id }, data: { name: 'Belfast Rentals', slug: 'belfast-rentals', status: 'ACTIVE' } });
    console.log(`✅ Updated OrgB: ${orgB.id}`);
  }

  // Create or update OrgB tenant user
  const orgBTenantPasswordHash = await hashPassword(tenantBPassword);
  const orgBTenantUser = await prisma.user.upsert({
    where: { email: tenantBEmail },
    update: { passwordHash: orgBTenantPasswordHash, emailVerified: true, activeOrganizationId: orgB.id },
    create: {
      name: 'OrgB Tenant',
      email: tenantBEmail,
      passwordHash: orgBTenantPasswordHash,
      emailVerified: true,
      activeOrganizationId: orgB.id,
    },
  });

  // Create credential account for OrgB tenant user
  const orgBTenantAccount = await prisma.account.findFirst({ where: { userId: orgBTenantUser.id, providerId: 'credential' } });
  if (!orgBTenantAccount) {
    await prisma.account.create({ data: { id: orgBTenantUser.id, accountId: orgBTenantUser.id, providerId: 'credential', password: orgBTenantPasswordHash, userId: orgBTenantUser.id } });
  }

  // Add OrgB tenant user as member of OrgB with default roles
  let orgBMemberId: string;
  const existingOrgBMember = await prisma.member.findFirst({ where: { userId: orgBTenantUser.id, orgId: orgB.id } });
  if (existingOrgBMember) {
    orgBMemberId = existingOrgBMember.id;
  } else {
    const newOrgBMember = await prisma.member.create({ data: { userId: orgBTenantUser.id, orgId: orgB.id, role: 'member' } });
    orgBMemberId = newOrgBMember.id;
    console.log(`✅ Added OrgB tenant user as member of OrgB`);
  }

  // Assign default roles to OrgB tenant user (member, property-manager, viewer)
  const orgBRoles = await prisma.role.findMany({ where: { organizationId: orgB.id, isDefault: true } });
  for (const role of orgBRoles) {
    const roleId = role.id;
    const existingMemberRole = await prisma.memberRole.findFirst({ where: { memberId: orgBMemberId, roleId } });
    if (!existingMemberRole) {
      await prisma.memberRole.create({
        data: {
          member: { connect: { id: orgBMemberId } },
          role: { connect: { id: roleId } },
          organization: { connect: { id: orgB.id } },
        },
      });
    }
  }

  console.log(`✅ Tenant organizations seeded: OrgA (${tenantAEmail}), OrgB (${tenantBEmail})`);

  // =========================================================================
  // 9. FINAL OUTPUT & INSTRUCTIONS
  // =========================================================================
  console.log('\n✅ Seed completed successfully! Database overwritten with latest script values.');
  console.log('\n📝 NEXT STEPS:');
  console.log('1. (Optional) Add the following to your .env for stability:');
  console.log(`   PLATFORM_ORG_ID=${platformOrgId}`);
  console.log('\n2. Restart your dev server: npm run dev');
  console.log('3. Log out completely and log back in using the credentials from your .env file.');
  console.log('4. You should now see the Super Admin dashboard!\n');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
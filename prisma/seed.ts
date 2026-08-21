import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

// Full 43-permission catalog (4 platform + 39 tenant)
const PERMISSION_CATALOG = [
  // Platform permissions (4)
  { key: 'platform:manage_organizations', resource: 'platform', action: 'manage_organizations', description: 'Manage tenant organizations', isDefault: true },
  { key: 'platform:manage_roles', resource: 'platform', action: 'manage_roles', description: 'Manage global roles', isDefault: true },
  { key: 'platform:manage_permissions', resource: 'platform', action: 'manage_permissions', description: 'Manage global permission catalog', isDefault: true },
  { key: 'platform:view_audit_logs', resource: 'platform', action: 'view_audit_logs', description: 'View audit logs across all organizations', isDefault: true },
  
  // Tenant permissions (39)
  { key: 'organizations:read', resource: 'organizations', action: 'read', description: 'View organization details', isDefault: true },
  { key: 'organizations:create', resource: 'organizations', action: 'create', description: 'Create new organizations', isDefault: true },
  { key: 'organizations:update', resource: 'organizations', action: 'update', description: 'Update organization details', isDefault: true },
  { key: 'organizations:delete', resource: 'organizations', action: 'delete', description: 'Delete organizations', isDefault: true },
  
  { key: 'members:read', resource: 'members', action: 'read', description: 'View organization members', isDefault: true },
  { key: 'members:create', resource: 'members', action: 'create', description: 'Invite new members', isDefault: true },
  { key: 'members:update', resource: 'members', action: 'update', description: 'Update member roles', isDefault: true },
  { key: 'members:delete', resource: 'members', action: 'delete', description: 'Remove members', isDefault: true },
  
  { key: 'roles:read', resource: 'roles', action: 'read', description: 'View organization roles', isDefault: true },
  { key: 'roles:create', resource: 'roles', action: 'create', description: 'Create new roles', isDefault: true },
  { key: 'roles:update', resource: 'roles', action: 'update', description: 'Update role permissions', isDefault: true },
  { key: 'roles:delete', resource: 'roles', action: 'delete', description: 'Delete roles', isDefault: true },
  
  { key: 'properties:read', resource: 'properties', action: 'read', description: 'View property details', isDefault: true },
  { key: 'properties:create', resource: 'properties', action: 'create', description: 'Create new properties', isDefault: true },
  { key: 'properties:update', resource: 'properties', action: 'update', description: 'Update property details', isDefault: true },
  { key: 'properties:delete', resource: 'properties', action: 'delete', description: 'Delete properties', isDefault: true },
  
  { key: 'tenants:read', resource: 'tenants', action: 'read', description: 'View tenant details', isDefault: true },
  { key: 'tenants:create', resource: 'tenants', action: 'create', description: 'Create new tenants', isDefault: true },
  { key: 'tenants:update', resource: 'tenants', action: 'update', description: 'Update tenant details', isDefault: true },
  { key: 'tenants:delete', resource: 'tenants', action: 'delete', description: 'Delete tenants', isDefault: true },
  
  { key: 'leases:read', resource: 'leases', action: 'read', description: 'View lease details', isDefault: true },
  { key: 'leases:create', resource: 'leases', action: 'create', description: 'Create new leases', isDefault: true },
  { key: 'leases:update', resource: 'leases', action: 'update', description: 'Update lease details', isDefault: true },
  { key: 'leases:delete', resource: 'leases', action: 'delete', description: 'Delete leases', isDefault: true },
  
  { key: 'documents:read', resource: 'documents', action: 'read', description: 'View document details', isDefault: true },
  { key: 'documents:create', resource: 'documents', action: 'create', description: 'Upload new documents', isDefault: true },
  { key: 'documents:update', resource: 'documents', action: 'update', description: 'Update document details', isDefault: true },
  { key: 'documents:delete', resource: 'documents', action: 'delete', description: 'Delete documents', isDefault: true },
  
  { key: 'payments:read', resource: 'payments', action: 'read', description: 'View payment details', isDefault: true },
  { key: 'payments:create', resource: 'payments', action: 'create', description: 'Process new payments', isDefault: true },
  { key: 'payments:update', resource: 'payments', action: 'update', description: 'Update payment details', isDefault: true },
  { key: 'payments:delete', resource: 'payments', action: 'delete', description: 'Delete payments', isDefault: true },
  
  { key: 'reports:read', resource: 'reports', action: 'read', description: 'View reports', isDefault: true },
  { key: 'reports:generate', resource: 'reports', action: 'generate', description: 'Generate reports', isDefault: true },
  
  { key: 'settings:read', resource: 'settings', action: 'read', description: 'View organization settings', isDefault: true },
  { key: 'settings:update', resource: 'settings', action: 'update', description: 'Update organization settings', isDefault: true },
  
  { key: 'audit:read', resource: 'audit', action: 'read', description: 'View audit logs', isDefault: true },
  
  { key: 'viewings:read', resource: 'viewings', action: 'read', description: 'View property viewings', isDefault: true },
  { key: 'viewings:create', resource: 'viewings', action: 'create', description: 'Schedule property viewings', isDefault: true },
  
  // Calendar permissions (4)
  { key: 'calendar:read', resource: 'calendars', action: 'read', description: 'View calendar events', isDefault: true },
  { key: 'calendar:create', resource: 'calendars', action: 'create', description: 'Create calendar events', isDefault: true },
  { key: 'calendar:update', resource: 'calendars', action: 'update', description: 'Update calendar events', isDefault: true },
  { key: 'calendar:delete', resource: 'calendars', action: 'delete', description: 'Delete calendar events', isDefault: true },
];

// =========================================================================
// HELPER: Default "Members" team bootstrapping
// Every organization gets a default "Members" team.
// =========================================================================
async function ensureDefaultTeam(orgId: string, orgName: string): Promise<void> {
  const existing = await prisma.team.findFirst({
    where: { organizationId: orgId, slug: 'members' },
  });

  if (!existing) {
    await prisma.team.create({
      data: { name: 'Members', slug: 'members', organizationId: orgId },
    });
    console.log(`   ✅ Created default "Members" team for ${orgName}`);
  }
}

// =========================================================================
// HELPER: Create or update a tenant user with credential account
// =========================================================================
async function ensureTenantUser(
  email: string,
  password: string,
  orgId: string,
  userName: string,
): Promise<{ userId: string; memberId: string }> {
  const passwordHash = await hashPassword(password);

  // Upsert user
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, emailVerified: true, activeOrganizationId: orgId },
    create: {
      name: userName,
      email,
      passwordHash,
      emailVerified: true,
      activeOrganizationId: orgId,
    },
  });

  // Ensure credential account exists
  const existingAccount = await prisma.account.findFirst({
    where: { userId: user.id, providerId: 'credential' },
  });
  if (!existingAccount) {
    await prisma.account.create({
      data: { id: user.id, accountId: user.id, providerId: 'credential', password: passwordHash, userId: user.id },
    });
  }

  // Ensure member record exists
  let memberId: string;
  const existingMember = await prisma.member.findFirst({
    where: { userId: user.id, orgId },
  });
  if (existingMember) {
    memberId = existingMember.id;
  } else {
    const newMember = await prisma.member.create({
      data: { userId: user.id, orgId, role: 'member' },
    });
    memberId = newMember.id;
  }

  return { userId: user.id, memberId };
}

// =========================================================================
// HELPER: Assign default roles to a member
// =========================================================================
async function assignDefaultRoles(memberId: string, orgId: string): Promise<void> {
  const roles = await prisma.role.findMany({ where: { organizationId: orgId, isDefault: true } });
  for (const role of roles) {
    const existing = await prisma.memberRole.findFirst({
      where: { memberId, roleId: role.id },
    });
    if (!existing) {
      await prisma.memberRole.create({
        data: { member: { connect: { id: memberId } }, role: { connect: { id: role.id } }, organization: { connect: { id: orgId } } },
      });
    }
  }
}

// =========================================================================
// HELPER: Add user to a team and assign team roles
// =========================================================================
async function addUserToTeam(userId: string, teamId: string, orgId: string): Promise<void> {
  // Check if already a team member
  const existing = await prisma.teamMember.findFirst({
    where: { userId, teamId },
  });
  if (existing) return; // Already a member

  const member = await prisma.member.findFirst({
    where: { userId, orgId },
  });

  await prisma.teamMember.create({
    data: { userId, teamId, organizationId: orgId },
  });

  // Assign all team roles (role inheritance)
  if (member) {
    const teamRoles = await prisma.teamRole.findMany({
      where: { teamId, organizationId: orgId },
      select: { roleId: true },
    });

    for (const tr of teamRoles) {
      const existingMemberRole = await prisma.memberRole.findFirst({
        where: { memberId: member.id, roleId: tr.roleId },
      });
      if (!existingMemberRole) {
        await prisma.memberRole.create({
          data: { member: { connect: { id: member.id } }, role: { connect: { id: tr.roleId } }, organization: { connect: { id: orgId } } },
        });
      }
    }
  }
}

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
        description: 'Platform-level organization for global administration and tenant management.',
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
        description: 'Platform-level organization for global administration and tenant management.',
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
  // 8. MODE DETECTION
  // =========================================================================
  const testMode = !!process.env.TEST_ADMIN_EMAIL?.trim();

  // =========================================================================
  // 9. DEFAULT "MEMBERS" TEAM FOR PLATFORM ORGANIZATION
  // =========================================================================
  await ensureDefaultTeam(platformOrgId, 'Platform');

  // Add platform user to the Members team (all modes)
  const membersTeam = await prisma.team.findFirst({
    where: { organizationId: platformOrgId, slug: 'members' },
  });

  if (membersTeam) {
    await addUserToTeam(superAdmin.id, membersTeam.id, platformOrgId);
    console.log(`   ✅ Added platform user to "Members" team`);
  }

  // Add platform user to Platform Ops team (dev mode only)
  if (!testMode) {
    const platformOpsTeam = await prisma.team.findFirst({
      where: { organizationId: platformOrgId, slug: 'platform-ops' },
    });

    if (!platformOpsTeam) {
      await prisma.team.create({
        data: { name: 'Platform Ops', slug: 'platform-ops', organizationId: platformOrgId },
      });
      console.log(`   ✅ Created "Platform Ops" team for Platform organization`);
    }

    // Add platform user to the Platform Ops team
    const platOpsTeam = await prisma.team.findFirst({
      where: { organizationId: platformOrgId, slug: 'platform-ops' },
    });

    if (platOpsTeam) {
      await addUserToTeam(superAdmin.id, platOpsTeam.id, platformOrgId);
      console.log(`   ✅ Added platform user to "Platform Ops" team`);
    }
  }

  // =========================================================================
  // 10. TENANT ORGANIZATIONS & DEVELOPER/TESTING PROFILES
  // =========================================================================

  let devTenantOrg: { id: string } | null = null;
  let testTenantOrg: { id: string } | null = null;

  if (testMode) {
    // =========================================================================
    // TESTING PROFILE: Test Tenant Ltd with QA Operations and Members teams
    // =========================================================================
    const testTenantAEmail = process.env.TEST_TENANT_A_EMAIL || 'test-tenant-a@example.com';
    const testTenantAPassword = process.env.TEST_TENANT_A_PASSWORD || 'TestTenantA123!';
    const testTenantBEmail = process.env.TEST_TENANT_B_EMAIL || 'test-tenant-b@example.com';
    const testTenantBPassword = process.env.TEST_TENANT_B_PASSWORD || 'TestTenantB123!';

    console.log(`\n📦 Seeding testing profile...`);

    // --- Test Tenant: Test Tenant Ltd ---
    testTenantOrg = await prisma.organization.findFirst({ where: { slug: 'test-tenant-ltd' } });
    if (!testTenantOrg) {
      testTenantOrg = await prisma.organization.create({
        data: { name: 'Test Tenant Ltd', slug: 'test-tenant-ltd', description: 'Testing tenant organization for QA and integration testing.', status: 'ACTIVE' },
      });
      console.log(`✅ Created Test Tenant Org: ${testTenantOrg.id}`);
    } else {
      await prisma.organization.update({
        where: { id: testTenantOrg.id },
        data: { name: 'Test Tenant Ltd', slug: 'test-tenant-ltd', description: 'Testing tenant organization for QA and integration testing.', status: 'ACTIVE' },
      });
      console.log(`✅ Updated Test Tenant Org: ${testTenantOrg.id}`);
    }

    // Ensure default "Members" team for test tenant org
    await ensureDefaultTeam(testTenantOrg.id, 'Test Tenant Ltd');

    // Create "QA Operations" team for test tenant org
    let qaTeam = await prisma.team.findFirst({
      where: { organizationId: testTenantOrg.id, slug: 'qa-operations' },
    });
    if (!qaTeam) {
      qaTeam = await prisma.team.create({
        data: { name: 'QA Operations', slug: 'qa-operations', organizationId: testTenantOrg.id },
      });
      console.log(`   ✅ Created "QA Operations" team for Test Tenant Ltd`);
    }

    // Get the default "Members" team for test tenant org
    const membersTeam = await prisma.team.findFirst({
      where: { organizationId: testTenantOrg.id, slug: 'members' },
    });

    // Create test tenant users and add them to both QA Operations and Members teams
    const { userId: testUserAId, memberId: testMemberAId } = await ensureTenantUser(
      testTenantAEmail,
      testTenantAPassword,
      testTenantOrg.id,
      'Test Tenant A',
    );
    await assignDefaultRoles(testMemberAId, testTenantOrg.id);
    if (qaTeam) {
      await addUserToTeam(testUserAId, qaTeam.id, testTenantOrg.id);
    }
    if (membersTeam) {
      await addUserToTeam(testUserAId, membersTeam.id, testTenantOrg.id);
    }
    console.log(`   ✅ Created and added Test Tenant User A to QA Operations and Members teams`);

    const { userId: testUserBId, memberId: testMemberBId } = await ensureTenantUser(
      testTenantBEmail,
      testTenantBPassword,
      testTenantOrg.id,
      'Test Tenant B',
    );
    await assignDefaultRoles(testMemberBId, testTenantOrg.id);
    if (qaTeam) {
      await addUserToTeam(testUserBId, qaTeam.id, testTenantOrg.id);
    }
    if (membersTeam) {
      await addUserToTeam(testUserBId, membersTeam.id, testTenantOrg.id);
    }
    console.log(`   ✅ Created and added Test Tenant User B to QA Operations and Members teams`);

    console.log(`✅ Testing profile seeded: Test Tenant Org (${testTenantAEmail}, ${testTenantBEmail})`);
  } else {
    // =========================================================================
    // DEVELOPER PROFILE: Dev Tenant Ltd with Operations and Members teams
    // =========================================================================
    const devTenantAEmail = process.env.DEV_TENANT_A_EMAIL || 'dev-tenant-a@example.com';
    const devTenantAPassword = process.env.DEV_TENANT_A_PASSWORD || 'DevTenantA123!';
    const devTenantBEmail = process.env.DEV_TENANT_B_EMAIL || 'dev-tenant-b@example.com';
    const devTenantBPassword = process.env.DEV_TENANT_B_PASSWORD || 'DevTenantB123!';

    console.log(`\n📦 Seeding developer profile...`);

    // --- Dev Tenant: Dev Tenant Ltd ---
    devTenantOrg = await prisma.organization.findFirst({ where: { slug: 'dev-tenant-ltd' } });
    if (!devTenantOrg) {
      devTenantOrg = await prisma.organization.create({
        data: { name: 'Dev Tenant Ltd', slug: 'dev-tenant-ltd', description: 'Developer tenant organization for development and staging.', status: 'ACTIVE' },
      });
      console.log(`✅ Created Dev Tenant Org: ${devTenantOrg.id}`);
    } else {
      await prisma.organization.update({
        where: { id: devTenantOrg.id },
        data: { name: 'Dev Tenant Ltd', slug: 'dev-tenant-ltd', description: 'Developer tenant organization for development and staging.', status: 'ACTIVE' },
      });
      console.log(`✅ Updated Dev Tenant Org: ${devTenantOrg.id}`);
    }

    // Ensure default "Members" team for dev tenant org
    await ensureDefaultTeam(devTenantOrg.id, 'Dev Tenant Ltd');

    // Create "Operations" team for dev tenant org
    let opsTeam = await prisma.team.findFirst({
      where: { organizationId: devTenantOrg.id, slug: 'operations' },
    });
    if (!opsTeam) {
      opsTeam = await prisma.team.create({
        data: { name: 'Operations', slug: 'operations', organizationId: devTenantOrg.id },
      });
      console.log(`   ✅ Created "Operations" team for Dev Tenant Ltd`);
    }

    // Get the default "Members" team for dev tenant org
    const membersTeam = await prisma.team.findFirst({
      where: { organizationId: devTenantOrg.id, slug: 'members' },
    });

    // Create dev tenant users and add them to both Operations and Members teams
    const { userId: devUserAId, memberId: devMemberAId } = await ensureTenantUser(
      devTenantAEmail,
      devTenantAPassword,
      devTenantOrg.id,
      'Dev Tenant A',
    );
    await assignDefaultRoles(devMemberAId, devTenantOrg.id);
    if (opsTeam) {
      await addUserToTeam(devUserAId, opsTeam.id, devTenantOrg.id);
    }
    if (membersTeam) {
      await addUserToTeam(devUserAId, membersTeam.id, devTenantOrg.id);
    }
    console.log(`   ✅ Created and added Dev Tenant User A to Operations and Members teams`);

    const { userId: devUserBId, memberId: devMemberBId } = await ensureTenantUser(
      devTenantBEmail,
      devTenantBPassword,
      devTenantOrg.id,
      'Dev Tenant B',
    );
    await assignDefaultRoles(devMemberBId, devTenantOrg.id);
    if (opsTeam) {
      await addUserToTeam(devUserBId, opsTeam.id, devTenantOrg.id);
    }
    if (membersTeam) {
      await addUserToTeam(devUserBId, membersTeam.id, devTenantOrg.id);
    }
    console.log(`   ✅ Created and added Dev Tenant User B to Operations and Members teams`);

    console.log(`✅ Developer profile seeded: Dev Tenant Org (${devTenantAEmail}, ${devTenantBEmail})`);
  }

  // =========================================================================
  // 9.5. CALENDAR TEST DATA (DEV & TEST PROFILES)
  // =========================================================================

  /** Helper to create a calendar for an org */
  async function ensureCalendar(orgId: string, name: string, isDefault: boolean = false): Promise<{ id: string }> {
    const existing = await prisma.calendar.findFirst({
      where: { organizationId: orgId, name },
    });
    if (existing) return { id: existing.id };

    const calendar = await prisma.calendar.create({
      data: {
        name,
        description: isDefault ? 'Default calendar' : undefined,
        color: isDefault ? '#1B2A4A' : '#2A9D8F',
        isDefault,
        organization: { connect: { id: orgId } },
      },
    });
    return { id: calendar.id };
  }

  /** Helper to create an event for a calendar */
  async function ensureEvent(
    orgId: string,
    calendarId: string,
    title: string,
    startDate: Date,
    endDate: Date,
    eventType?: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER',
  ): Promise<void> {
    const existing = await prisma.calendarEvent.findFirst({
      where: { organizationId: orgId, title },
    });
    if (existing) return;

    await prisma.calendarEvent.create({
      data: {
        title,
        startDate,
        endDate,
        eventType: eventType || 'OTHER',
        calendarId,
        organizationId: orgId,
      },
    });
  }

  /** Helper to create a recurring event with rrule JSON. */
  async function ensureRecurringEvent(
    orgId: string,
    calendarId: string,
    title: string,
    startDate: Date,
    endDate: Date,
    frequency: 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY',
    interval: number = 1,
  ): Promise<void> {
    const existing = await prisma.calendarEvent.findFirst({
      where: { organizationId: orgId, title },
    });
    if (existing) return;

    // Map frequency to rrule format (QUARTERLY/SEMI_ANNUALLY → MONTHLY with interval×3/×6)
    let rruleFreq = frequency;
    let rruleInterval = interval;
    if (frequency === 'QUARTERLY') {
      rruleFreq = 'MONTHLY';
      rruleInterval = interval * 3;
    } else if (frequency === 'SEMI_ANNUALLY') {
      rruleFreq = 'MONTHLY';
      rruleInterval = interval * 6;
    }

    const rruleJson = JSON.stringify({
      freq: rruleFreq,
      interval: rruleInterval,
      dtstart: startDate.toISOString(),
      until: null, // No end date — infinite recurrence
      count: null,
    });

    await prisma.calendarEvent.create({
      data: {
        title,
        startDate,
        endDate,
        calendarId,
        organizationId: orgId,
        rrule: rruleJson,
      },
    });
  }

  // Seed calendar test data for both dev and test profiles
  console.log('\n📅 Seeding calendar test data...');

  // Platform org calendar (no events, just the default calendar)
  await ensureCalendar(platformOrgId, 'Main Calendar', true);
  console.log('   ✅ Created default calendar for Platform organization');

  // Dev tenant org calendars and events
  if (devTenantOrg) {
    const devCalendar = await ensureCalendar(devTenantOrg.id, 'Main Calendar', true);

    // Create some test events for the dev tenant
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Event happening today
    await ensureEvent(
      devTenantOrg.id,
      devCalendar.id,
      'Team Standup',
      new Date(today.getTime() + 2 * 60 * 60 * 1000), // 2:00 PM today
      new Date(today.getTime() + 2.5 * 60 * 60 * 1000), // 2:30 PM today
      'INSPECTION',
    );

    // Event happening tomorrow
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    await ensureEvent(
      devTenantOrg.id,
      devCalendar.id,
      'Property Viewing - 123 High St',
      new Date(tomorrow.getTime() + 10 * 60 * 60 * 1000), // 10:00 AM tomorrow
      new Date(tomorrow.getTime() + 11 * 60 * 60 * 1000), // 11:00 AM tomorrow
      'VIEWING',
    );

    // Recurring weekly event
    await ensureRecurringEvent(
      devTenantOrg.id,
      devCalendar.id,
      'Weekly Maintenance Check',
      today,
      new Date(today.getTime() + 60 * 60 * 1000), // 1 hour duration
      'WEEKLY',
      1,
    );

    // Recurring monthly event
    await ensureRecurringEvent(
      devTenantOrg.id,
      devCalendar.id,
      'Monthly Lease Review',
      new Date(today.getFullYear(), today.getMonth(), 15), // 15th of this month
      new Date(today.getFullYear(), today.getMonth(), 15, 14, 0), // 2:00 PM
      'MONTHLY',
      1,
    );

    // Multi-day event
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const nextWeekEnd = new Date(nextWeek);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 2);
    await ensureEvent(
      devTenantOrg.id,
      devCalendar.id,
      'Building Maintenance Window',
      nextWeek,
      new Date(nextWeekEnd.getTime() + 24 * 60 * 60 * 1000), // 3 days
      'MAINTENANCE',
    );

    console.log('   ✅ Calendar test data seeded for dev tenant');
  }

  // Test tenant org calendars and events
  if (testTenantOrg) {
    const testCalendar = await ensureCalendar(testTenantOrg.id, 'Main Calendar', true);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    await ensureEvent(
      testTenantOrg.id,
      testCalendar.id,
      'QA Testing Session',
      new Date(today.getTime() + 3 * 60 * 60 * 1000), // 3:00 PM today
      new Date(today.getTime() + 4 * 60 * 60 * 1000), // 4:00 PM today
      'INSPECTION',
    );

    await ensureRecurringEvent(
      testTenantOrg.id,
      testCalendar.id,
      'Weekly QA Review',
      today,
      new Date(today.getTime() + 60 * 60 * 1000),
      'WEEKLY',
      1,
    );

    console.log('   ✅ Calendar test data seeded for test tenant');
  }

  // =========================================================================
  // 10. RESOURCE CATALOG (FORCE UPSERT)
  // =========================================================================
  const RESOURCES = [
    {
      name: 'platform',
      description:
        'Platform-level administration resources for managing the multi-tenant infrastructure, including global settings, system health monitoring, and cross-organization oversight.',
    },
    {
      name: 'organizations',
      description:
        'Tenant organization management resources for creating, configuring, and maintaining tenant organizations including their lifecycle states (pending, active, suspended, archived) and metadata.',
    },
    {
      name: 'members',
      description:
        'Organization member management resources for inviting, onboarding, and managing user memberships within organizations including role assignments and team affiliations.',
    },
    {
      name: 'roles',
      description:
        'Role-based access control (RBAC) resources for defining organization-scoped roles, assigning permissions to roles, and managing role hierarchies within each tenant.',
    },
    {
      name: 'properties',
      description:
        'Property portfolio management resources for creating, updating, and managing rental properties including details such as address, type, status, and associated tenant information.',
    },
    {
      name: 'tenants',
      description:
        'Tenant resident management resources for tracking individuals and households occupying rental properties, including contact details, move-in/move-out dates, and lease associations.',
    },
    {
      name: 'leases',
      description:
        'Lease agreement management resources for creating, executing, and tracking rental lease agreements including terms, rent amounts, start/end dates, and renewal history.',
    },
    {
      name: 'documents',
      description:
        'Document management resources for uploading, organizing, and storing property-related documents such as leases, inspections reports, certificates, and correspondence.',
    },
    {
      name: 'payments',
      description:
        'Financial payment processing resources for managing rent collections, tracking payment history, handling late fees, and generating financial reports across properties.',
    },
    {
      name: 'reports',
      description:
        'Reporting and analytics resources for generating insights into portfolio performance, occupancy rates, financial summaries, maintenance trends, and compliance status.',
    },
    {
      name: 'settings',
      description:
        'Organization settings and configuration resources for managing tenant-specific preferences, notification templates, payment configurations, and system customizations.',
    },
    {
      name: 'audit',
      description:
        'Audit logging resources for recording and reviewing security-relevant actions, changes to roles and permissions, administrative operations, and compliance trails across the platform.',
    },
    {
      name: 'viewings',
      description:
        'Property viewing scheduling resources for organizing and tracking property viewings including appointment times, attendee details, agent assignments, and viewing outcomes.',
    },
    {
      name: 'calendars',
      description:
        'Calendar and event management resources for creating, viewing, updating, and deleting organization-scoped calendar events including recurring events and drag-and-drop rescheduling.',
    },
  ];

  for (const resource of RESOURCES) {
    await prisma.resource.upsert({
      where: { name: resource.name },
      update: { description: resource.description },
      create: resource,
    });
  }
  console.log(`✅ Resource catalog overwritten/ensured: ${RESOURCES.length} resources`);

  // =========================================================================
  // 11. FINAL OUTPUT & INSTRUCTIONS
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
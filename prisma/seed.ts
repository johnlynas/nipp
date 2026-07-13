import { PrismaClient } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

const PERMISSION_CATALOG = [
  { key: 'platform:manage_organizations', resource: 'platform', action: 'manage_organizations', description: 'Manage tenant organizations' },
  { key: 'platform:manage_roles', resource: 'platform', action: 'manage_roles', description: 'Manage global roles' },
  { key: 'platform:manage_permissions', resource: 'platform', action: 'manage_permissions', description: 'Manage global permission catalog' },
  { key: 'platform:view_audit_logs', resource: 'platform', action: 'view_audit_logs', description: 'View audit logs across all organizations' },
];

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nipp.gov.uk';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

  // Step 1: Create Platform Organization
  let platformOrg = await prisma.organization.findFirst({
    where: { name: 'Platform' },
  });

  if (!platformOrg) {
    platformOrg = await prisma.organization.create({
      data: {
        name: 'Platform',
        slug: 'platform',
        status: 'ACTIVE',
        metadata: { type: 'platform' },
      },
    });
    console.log(`✅ Created Platform Organization: ${platformOrg.id}`);
  } else {
    console.log(`Platform Organization exists: ${platformOrg.id}`);
  }

  // Step 2: Write PLATFORM_ORG_ID to .env
  const fs = await import('fs');
  const path = await import('path');
  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';
  try {
    envContent = fs.readFileSync(envPath, 'utf-8');
  } catch {}

  const marker = 'PLATFORM_ORG_ID=';
  const existingLine = envContent.split('\n').find((line) => line.startsWith(marker));
  if (existingLine) {
    envContent = envContent.replace(existingLine, `${marker}${platformOrg.id}`);
  } else {
    envContent += `\n${marker}${platformOrg.id}\n`;
  }
  fs.writeFileSync(envPath, envContent);
  console.log(`✅ PLATFORM_ORG_ID=${platformOrg.id} written to .env`);

  // Step 3: Create permission catalog and collect IDs
  const permissionIds: string[] = [];
  for (const perm of PERMISSION_CATALOG) {
    const created = await prisma.permission.upsert({
      where: { key: perm.key },
      update: {},
      create: perm,
    });
    permissionIds.push(created.id);
  }
  console.log(`✅ Permission catalog: ${PERMISSION_CATALOG.length} permissions`);

  // Step 4: Create Super Admin Role and assign permissions via junction table
  let superAdminRole = await prisma.role.findFirst({
    where: {
      name: 'Super Admin',
      organization: { id: platformOrg.id },
    },
  });

  if (!superAdminRole) {
    // 1. Create the Role first
    superAdminRole = await prisma.role.create({
      data: {
        name: 'Super Admin',
        description: 'Full platform administration access',
        organization: { connect: { id: platformOrg.id } },
        isDefault: true,
      },
    });
    console.log(`✅ Created Super Admin role: ${superAdminRole.id}`);

    // 2. Create the RolePermission records using relation syntax
    for (const permId of permissionIds) {
      await prisma.rolePermission.create({
        data: {
          role: { connect: { id: superAdminRole.id } },
          permission: { connect: { id: permId } },
          organization: { connect: { id: platformOrg.id  } },
        },
      });
    }
    console.log(`✅ Assigned ${permissionIds.length} permissions to Super Admin role`);
  } else {
    console.log(`Super Admin role exists: ${superAdminRole.id}`);
  }

  // Step 5: Create or update Super Admin user
  let superAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (superAdmin) {
    await prisma.user.update({
      where: { id: superAdmin.id },
      data: {
        name: 'System Administrator',
        emailVerified: true,
        role: 'super_admin',
        activeOrganizationId: platformOrg.id,
      },
    });
    console.log(`✅ Updated Super Admin user: ${adminEmail}`);
  } else {
    const passwordHash = await hashPassword(adminPassword);
    superAdmin = await prisma.user.create({
      data: {
        name: 'System Administrator',
        email: adminEmail,
        passwordHash,
        emailVerified: true,
        role: 'super_admin',
        activeOrganizationId: platformOrg.id,
      },
    });
    console.log(`✅ Created Super Admin user: ${adminEmail}`);
  }

  // Step 6: Ensure credential account exists
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
  }

  // Step 7: Create Member record
  let member = await prisma.member.findFirst({
    where: { userId: superAdmin.id, orgId: platformOrg.id },
  });

  if (!member) {
    member = await prisma.member.create({
      data: {
        userId: superAdmin.id,
        orgId: platformOrg.id,
        role: 'admin',
      },
    });
    console.log(`✅ Created Member record: ${member.id}`);
  }

  // Step 8: Assign Super Admin role to member via MemberRole
  const existingMemberRole = await prisma.memberRole.findFirst({
    where: { memberId: member.id, roleId: superAdminRole.id },
  });

  if (!existingMemberRole) {
    await prisma.memberRole.create({
      data: {
        member: { connect: { id: member.id } },
        role: { connect: { id: superAdminRole.id } },
        organization: { connect: { id: platformOrg.id } }, // Add the organization relation
      },
    });
    console.log(`✅ Assigned Super Admin role to member`);
  }

  console.log('\n✅ Seed completed successfully!');
  console.log(`\n📝 Next steps:`);
  console.log(`1. Restart your dev server: npm run dev`);
  console.log(`2. Log out completely`);
  console.log(`3. Log back in as ${adminEmail}`);
  console.log(`4. You should now see the Super Admin dashboard!`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
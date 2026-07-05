/**
 * Prisma seed script.
 *
 * Creates the default admin user with a securely hashed password and
 * assigns the "admin" role. Uses BetterAuth's internal adapter to create
 * both the User and credential Account records correctly.
 * Run with: `npm run db:seed` (or `npx prisma db seed`).
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword, verifyPassword } from 'better-auth/crypto';

const prisma = new PrismaClient();

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@nipp.gov.uk';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

  // Delete any existing user with this email (both User and linked Account records)
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (existing) {
    await prisma.account.deleteMany({ where: { userId: existing.id } });
    await prisma.user.delete({ where: { id: existing.id } });
    console.log(`Removed existing user ${adminEmail} for re-seed.`);
  }

  // Hash password using BetterAuth's Argon2id hasher
  const passwordHash = await hashPassword(adminPassword);

  // Create the User record
  const user = await prisma.user.create({
    data: {
      name: 'System Administrator',
      email: adminEmail,
      passwordHash,
      emailVerified: true,
      role: 'admin',
    },
  });

  // Create the credential Account record (BetterAuth v1.x stores credentials here)
  await prisma.account.create({
    data: {
      id: user.id, // credential accounts use userId as accountId
      accountId: user.id,
      providerId: 'credential',
      password: passwordHash, // BetterAuth stores the hash in Account.password for credentials
      userId: user.id,
    },
  });

  console.log(`Default admin user created: ${adminEmail} (role: admin)`);
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Migration script: Upgrade existing organizations to the new schema.
 *
 * Sets `status = 'ACTIVE'` and generates unique `slug` values for all
 * existing organizations that don't already have one.
 *
 * Run with: `npx tsx prisma/migration-scripts/upgrade-existing-orgs.ts`
 *
 * This script is idempotent — safe to run multiple times.
 */

import { PrismaClient, OrgStatus } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Generate a URL-friendly slug from an organization name.
 * "Acme Properties Ltd" → "acme-properties-ltd"
 */
function generateSlug(name: string, index?: number): string {
  let slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  if (index !== undefined) {
    slug += `-${index}`;
  }

  return slug;
}

async function main() {
  console.log('[Migration] Starting organization upgrade...');

  // Set status to ACTIVE for all organizations with PENDING or no status
  const pendingCount = await prisma.organization.updateMany({
    where: {
      OR: [{ status: 'PENDING' }, { status: null }],
    },
    data: { status: 'ACTIVE' },
  });
  console.log(`[Migration] Set ${pendingCount.count} organizations to ACTIVE status.`);

  // Generate slugs for organizations that don't have one
  const orgsWithoutSlugs = await prisma.organization.findMany({
    where: { slug: null },
    select: { id: true, name: true },
  });

  console.log(`[Migration] Found ${orgsWithoutSlugs.length} organizations without slugs.`);

  for (const org of orgsWithoutSlugs) {
    let slug = generateSlug(org.name);
    let suffix = 0;
    let unique = false;

    // Ensure slug uniqueness
    while (!unique) {
      const existing = await prisma.organization.findUnique({
        where: { slug },
        select: { id: true },
      });

      if (!existing || existing.id === org.id) {
        unique = true;
      } else {
        suffix++;
        slug = generateSlug(org.name, suffix);
      }
    }

    await prisma.organization.update({
      where: { id: org.id },
      data: { slug, status: 'ACTIVE' },
    });

    console.log(`  - "${org.name}" → slug: ${slug}`);
  }

  console.log('[Migration] Organization upgrade complete.');
}

main()
  .catch((e) => {
    console.error('[Migration] Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Integration test: Organization API / Update Integrity
 * Verifies that organization updates (name, slug) are correctly applied.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('Organization API / Update Integrity', () => {
  let testOrgId: string;

  afterAll(async () => {
    // Cleanup test orgs by slug to ensure no leakage
    await prisma.organization.deleteMany({
      where: { slug: { in: ['test-lifecycle-org', 'test-invalid-transition', `test-api-update-${Date.now()}`, `test-api-slug-${Date.now()}`] } },
    });
  });

  it('should allow updating organization name and slug', async () => {
    // 1. Setup: Create an initial organization with a unique slug
    const uniqueSlug = `test-api-update-${Date.now()}`;
    const org = await prisma.organization.create({
      data: {
        name: 'Original Name',
        slug: uniqueSlug,
        status: 'ACTIVE',
      },
    });
    testOrgId = org.id;

    // 2. Execution: Simulate the PATCH logic
    const updatedName = 'New Improved Name';
    const updatedSlug = `new-improved-slug-${Date.now()}`;

    const updatedOrg = await prisma.organization.update({
      where: { id: testOrgId },
      data: { 
        name: updatedName,
        slug: updatedSlug
      },
    });

    // 3. Verification: Check if the database reflects changes correctly
    expect(updatedOrg.name).toBe(updatedName);
    expect(updatedOrg.slug).toBe(updatedSlug);

    // Double check via a fresh query
    const verifyOrg = await prisma.organization.findUnique({
      where: { id: testOrgId },
    });
    expect(verifyOrg?.name).toBe(updatedName);
    expect(verifyOrg?.slug).toBe(updatedSlug);
  });

  it('should allow partial updates (name only)', async () => {
    // 1. Setup: Create a second org with its own unique slug
    const uniqueSlug = `test-api-partial-${Date.now()}`;
    const org = await prisma.organization.create({
      data: {
        name: 'Partial Update Org',
        slug: uniqueSlug,
        status: 'ACTIVE',
      },
    });

    // 2. Execution: Update ONLY the name
    const newName = 'Only Name Changed';
    const updatedOrg = await prisma.organization.update({
      where: { id: org.id },
      data: { name: newName },
    });

    // 3. Verification: Name changed, but slug remains the same
    expect(updatedOrg.name).toBe(newName);
    expect(updatedOrg.slug).toBe(uniqueSlug);
  });

  it('should fail to update a non-existent organization', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    
    // We expect Prisma to throw an error for non-existent record
    await expect(
      prisma.organization.update({
        where: { id: fakeId },
        data: { name: 'Ghost Name' },
      })
    ).rejects.toThrow();
  });
});

/**
 * Integration test: Organization API / Database Integrity
 * Verifies that organization updates (name, slug) are correctly applied.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';

describe('Organization API / Update Integrity', () => {
  let testOrgId: string;

  afterAll(async () => {
    // Cleanup test orgs by slug
    await prisma.organization.deleteMany({
      where: { slug: { in: ['test-api-update-org', 'test-api-slug-org'] } },
    });
  });

  it('should allow updating organization name and slug', async () => {
    // 1. Setup: Create an initial organization
    const org = await prisma.organization.create({
      data: {
        name: 'Original Name',
        slug: 'test-api-update-org',
        status: 'ACTIVE',
      },
    });
    testOrgId = org.id;

    // 2. Execution: Simulate the PATCH logic
    const updatedName = 'New Improved Name';
    const updatedSlug = 'new-improved-slug';

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
    // 1. Setup: Create a second org
    const org = await prisma.organization.create({
      data: {
        name: 'Partial Update Org',
        slug: 'test-api-slug-org',
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
    expect(updatedOrg.slug).toBe('test-api-slug-org');
  });

  it('should fail to update a non-existent organization', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    
    // We expect Prisma to throw a P2025 error (Record not found)
    await expect(
      prisma.organization.update({
        where: { id: fakeId },
        data: { name: 'Ghost Name' },
      })
    ).rejects.toThrow();
  });
});

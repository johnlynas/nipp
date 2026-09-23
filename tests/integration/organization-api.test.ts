/**
 * Integration test: Organization API / Update Integrity
 * Verifies that organization updates (name, slug) are correctly applied.
 *
 * RLS note: the app role is nipp_app — Organization writes require the
 * platform-admin GUC and bind the context to the TARGET org id, so fixture
 * ops run through rlsFixture (see tests/utils/rls-fixture.ts).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { rlsFixture } from '@/tests/utils/rls-fixture';

describe('Organization API / Update Integrity', () => {
  let testOrgId: string;

  // Platform-scoped fixture handle (org CREATE needs the platform GUC).
  const platform = rlsFixture(null);

  afterAll(async () => {
    // Cleanup ONLY this file's test orgs (by slug prefix) so parallel
    // workers don't delete other suites' data — e.g. org-lifecycle.test.ts
    // uses the `test-lifecycle-org` / `test-invalid-transition` slugs.
    // Org UPDATE/DELETE only match rows the context is bound to, so resolve
    // platform-scoped and delete each under its own target context.
    const orgs = await platform.organization.findMany({
      where: {
        OR: [
          { slug: { startsWith: 'test-api-update-' } },
          { slug: { startsWith: 'test-api-slug-' } },
          { slug: { startsWith: 'test-api-partial-' } },
          { slug: { startsWith: 'new-improved-slug-' } },
        ],
      },
    });
    for (const org of orgs) {
      await rlsFixture(org.id).organization.delete({ where: { id: org.id } });
    }
  });

  it('should allow updating organization name and slug', async () => {
    // 1. Setup: Create an initial organization with a unique slug (platform GUC)
    const uniqueSlug = `test-api-update-${Date.now()}`;
    const org = await platform.organization.create({
      data: {
        name: 'Original Name',
        slug: uniqueSlug,
        status: 'ACTIVE',
      },
    });
    testOrgId = org.id;

    // 2. Execution: Simulate the PATCH logic (bound to the target org — RLS qual)
    const updatedName = 'New Improved Name';
    const updatedSlug = `new-improved-slug-${Date.now()}`;

    const updatedOrg = await rlsFixture(testOrgId).organization.update({
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
    const verifyOrg = await rlsFixture(testOrgId).organization.findUnique({
      where: { id: testOrgId },
    });
    expect(verifyOrg?.name).toBe(updatedName);
    expect(verifyOrg?.slug).toBe(updatedSlug);
  });

  it('should allow partial updates (name only)', async () => {
    // 1. Setup: Create a second org with its own unique slug (platform GUC)
    const uniqueSlug = `test-api-partial-${Date.now()}`;
    const org = await platform.organization.create({
      data: {
        name: 'Partial Update Org',
        slug: uniqueSlug,
        status: 'ACTIVE',
      },
    });

    // 2. Execution: Update ONLY the name (bound to the target org)
    const newName = 'Only Name Changed';
    const updatedOrg = await rlsFixture(org.id).organization.update({
      where: { id: org.id },
      data: { name: newName },
    });

    // 3. Verification: Name changed, but slug remains the same
    expect(updatedOrg.name).toBe(newName);
    expect(updatedOrg.slug).toBe(uniqueSlug);
  });

  it('should fail to update a non-existent organization', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    
    // We expect Prisma to throw an error for non-existent record — RLS denies
    // the row for a context bound to a (nonexistent) other org id, and Prisma
    // reports it as "record to update not found".
    await expect(
      rlsFixture(fakeId).organization.update({
        where: { id: fakeId },
        data: { name: 'Ghost Name' },
      })
    ).rejects.toThrow();
  });
});

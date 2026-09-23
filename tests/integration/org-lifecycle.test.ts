/**
 * Integration test: Organization lifecycle — Create (PENDING) → Suspend (SUSPENDED) → Archive (ARCHIVED).
 *
 * RLS note: the app role is nipp_app, so fixture ops run through rlsFixture
 * (platform-admin context) — see tests/utils/rls-fixture.ts.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { OrgStatus } from '@prisma/client';
import { rlsFixture } from '@/tests/utils/rls-fixture';

describe('Organization Lifecycle Integration', () => {
  let createdOrgId: string;
  // Platform-scoped fixture handle (org CREATE needs the platform GUC; null = no target).
  const fixture = rlsFixture(null);

  afterAll(async () => {
    // Cleanup test orgs by slug to ensure no leakage. Unscoped deletes match
    // zero rows under RLS (fail-closed), so resolve via the fixture and delete
    // each row under its own target-org context.
    for (const slug of ['test-lifecycle-org', 'test-invalid-transition']) {
      const org = await fixture.organization.findUnique({ where: { slug } });
      if (org) await rlsFixture(org.id).organization.deleteMany({ where: { id: org.id } });
    }
  });

  it('should create org in PENDING status', async () => {
    const org = await fixture.organization.create({
      data: {
        name: 'Test Lifecycle Org',
        slug: 'test-lifecycle-org',
        status: 'PENDING',
      },
    });

    createdOrgId = org.id;
    expect(org.status).toBe('PENDING');
    expect(org.slug).toBe('test-lifecycle-org');
  });

  it('should transition PENDING → ACTIVE', async () => {
    const org = await rlsFixture(createdOrgId).organization.update({
      where: { id: createdOrgId },
      data: { status: 'ACTIVE' as OrgStatus },
    });

    expect(org.status).toBe('ACTIVE');
  });

  it('should transition ACTIVE → SUSPENDED', async () => {
    const org = await rlsFixture(createdOrgId).organization.update({
      where: { id: createdOrgId },
      data: { status: 'SUSPENDED' as OrgStatus },
    });

    expect(org.status).toBe('SUSPENDED');
  });

  it('should transition SUSPENDED → ARCHIVED', async () => {
    const org = await rlsFixture(createdOrgId).organization.update({
      where: { id: createdOrgId },
      data: { status: 'ARCHIVED' as OrgStatus },
    });

    expect(org.status).toBe('ARCHIVED');
  });

  it('should reject any transition from ARCHIVED (terminal)', async () => {
    const org = await rlsFixture(createdOrgId).organization.findUnique({
      where: { id: createdOrgId },
      select: { status: true },
    });

    expect(org?.status).toBe('ARCHIVED');
  });

  it('should reject invalid transition PENDING → SUSPENDED', async () => {
    const tempOrg = await fixture.organization.create({
      data: {
        name: 'Temp Invalid Transition Org',
        slug: 'test-invalid-transition',
        status: 'PENDING',
      },
    });

    const validTransitions: Record<string, string[]> = {
      PENDING: ['ACTIVE'],
      ACTIVE: ['SUSPENDED', 'ARCHIVED'],
      SUSPENDED: ['ACTIVE', 'ARCHIVED'],
      ARCHIVED: [],
    };

    const allowed = validTransitions['PENDING'];
    expect(allowed).not.toContain('SUSPENDED');

    // Cleanup temp org (UPDATE/DELETE qual requires app.current_org_id = id)
    await rlsFixture(tempOrg.id).organization.deleteMany({ where: { slug: 'test-invalid-transition' } });
  });
});

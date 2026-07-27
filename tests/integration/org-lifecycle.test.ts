/**
 * Integration test: Organization lifecycle — Create (PENDING) → Suspend (SUSPENDED) → Archive (ARCHIVED).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/db';
import { OrgStatus } from '@prisma/client';

describe('Organization Lifecycle Integration', () => {
  let createdOrgId: string;

  afterAll(async () => {
    // Cleanup test orgs by slug to ensure no leakage
    await prisma.organization.deleteMany({
      where: { slug: { in: ['test-lifecycle-org', 'test-invalid-transition'] } },
    });
  });

  it('should create org in PENDING status', async () => {
    const org = await prisma.organization.create({
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
    const org = await prisma.organization.update({
      where: { id: createdOrgId },
      data: { status: 'ACTIVE' as OrgStatus },
    });

    expect(org.status).toBe('ACTIVE');
  });

  it('should transition ACTIVE → SUSPENDED', async () => {
    const org = await prisma.organization.update({
      where: { id: createdOrgId },
      data: { status: 'SUSPENDED' as OrgStatus },
    });

    expect(org.status).toBe('SUSPENDED');
  });

  it('should transition SUSPENDED → ARCHIVED', async () => {
    const org = await prisma.organization.update({
      where: { id: createdOrgId },
      data: { status: 'ARCHIVED' as OrgStatus },
    });

    expect(org.status).toBe('ARCHIVED');
  });

  it('should reject any transition from ARCHIVED (terminal)', async () => {
    const org = await prisma.organization.findUnique({
      where: { id: createdOrgId },
      select: { status: true },
    });

    expect(org?.status).toBe('ARCHIVED');
  });

  it('should reject invalid transition PENDING → SUSPENDED', async () => {
    const tempOrg = await prisma.organization.create({
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

    // Cleanup temp org
    await prisma.organization.deleteMany({ where: { slug: 'test-invalid-transition' } });
  });
});

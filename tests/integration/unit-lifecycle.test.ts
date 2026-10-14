/**
 * Integration tests: Unit lifecycle — Create, Read, Update, Delete with real database.
 *
 * RLS note: the app role is nipp_app, so fixture ops run through rlsFixture
 * (platform-admin GUCs bound per op) — see tests/utils/rls-fixture.ts.
 * The Units policy (rls_units_isolated) carries a WITH CHECK on INSERT/UPDATE,
 * so service writes run under withTenantAccess(testOrgId, false, ...).
 */

import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { UnitService } from '@/services/unit-service';
import type { ServiceContext } from '@/lib/services/types';
import { rlsFixture, withTenantAccess } from '@/tests/utils/rls-fixture';

describe('Unit Lifecycle Integration', () => {
  let testOrgId: string;

  // Platform-scoped fixture handle (org CREATE needs the platform GUC).
  const platform = rlsFixture(null);
  // Org-scoped fixture handle for everything below.
  const db = () => rlsFixture(testOrgId);

  const adminCtx = (): ServiceContext => ({ userId: 'fixture-admin', role: 'TENANT_ADMIN', organizationId: testOrgId });

  beforeEach(async () => {
    // Create a test organization for unit lifecycle tests (platform GUC —
    // Organization INSERT is platform-only).
    const org = await platform.organization.create({
      data: { name: 'Test Unit Org', slug: `test-unit-org-${Date.now()}-${Math.floor(Math.random() * 1000)}`, status: 'ACTIVE' },
    });
    testOrgId = org.id;
  });

  afterAll(async () => {
    // Cleanup test orgs by slug prefix — org UPDATE/DELETE only match rows the
    // context is bound to, so resolve platform-scoped and delete per-target.
    const orgs = await platform.organization.findMany({ where: { slug: { startsWith: 'test-unit-org-' } } });
    for (const org of orgs) {
      await rlsFixture(org.id).organization.delete({ where: { id: org.id } });
    }
  });

  async function createUnit(extra?: Partial<{ owner: string; address: string; postCode: string; rented: boolean; type: 'HOUSE' | 'APARTMENT' | 'OTHER' }>) {
    const unit = await withTenantAccess(testOrgId, false, () => UnitService.createUnit({
      owner: extra?.owner ?? 'Janet Owens',
      address: extra?.address ?? `${Math.floor(Math.random() * 999)} Test Street`,
      postCode: extra?.postCode ?? 'BT48 6XX',
      ...(extra?.rented !== undefined ? { rented: extra.rented } : {}),
      ...(extra?.type !== undefined ? { type: extra.type } : {}),
    }, testOrgId, adminCtx()));
    return unit as unknown as Record<string, unknown>;
  }

  it('should create a unit with defaults (rented=false, type=APARTMENT)', async () => {
    const unit = await createUnit();

    expect(unit.owner).toBe('Janet Owens');
    expect(unit.rented).toBe(false);
    expect(unit.type).toBe('APARTMENT');
    expect(unit.organizationId).toBe(testOrgId);
  });

  it('should create a rented HOUSE unit', async () => {
    const unit = await createUnit({ owner: 'Michael Byrne', address: '12 High Street', postCode: 'BT49 3AB', rented: true, type: 'HOUSE' });

    expect(unit.rented).toBe(true);
    expect(unit.type).toBe('HOUSE');
  });

  it('should list units in an organization (paginated)', async () => {
    await createUnit({ owner: 'Owner A' });
    const b = await createUnit({ owner: 'Owner B' });

    const result = await withTenantAccess(testOrgId, false, () => UnitService.getUnitsByOrg(testOrgId, adminCtx(), 1, 20));
    expect(result.items.length).toBe(2);
    expect(result.pagination.total).toBe(2);
    // Every listed unit belongs to the org (RLS + app-layer scoping).
    for (const u of result.items) {
      expect(u.organizationId).toBe(testOrgId);
    }
    void b;
  });

  it('should filter units by type and rented state', async () => {
    await createUnit({ owner: 'House Owner', type: 'HOUSE' });
    const apartment = await createUnit({ owner: 'Apartment Owner', rented: true, type: 'APARTMENT' });

    const houses = await withTenantAccess(testOrgId, false, () => UnitService.getUnitsByOrg(testOrgId, adminCtx(), 1, 20, undefined, undefined, 'HOUSE'));
    for (const u of houses.items) {
      expect(u.type).toBe('HOUSE');
    }

    const rented = await withTenantAccess(testOrgId, false, () => UnitService.getUnitsByOrg(testOrgId, adminCtx(), 1, 20, undefined, true));
    for (const u of rented.items) {
      expect(u.rented).toBe(true);
    }

    const none = await withTenantAccess(testOrgId, false, () => UnitService.getUnitsByOrg(testOrgId, adminCtx(), 1, 20, 'no-such-owner-xyz'));
    expect(none.items.length).toBe(0);
    void apartment;
  });

  it('should update a unit owner and address', async () => {
    const unit = await createUnit();
    const id = unit.unitId as string;

    const updated = (await withTenantAccess(testOrgId, false, () => UnitService.updateUnit(id, { owner: 'New Owner', address: '1 New Road' }, adminCtx()))) as unknown as Record<string, unknown>;
    expect(updated.owner).toBe('New Owner');
    expect(updated.address).toBe('1 New Road');
  });

  it('should toggle rented and change type via update', async () => {
    const unit = await createUnit();

    const updated = (await withTenantAccess(testOrgId, false, () => UnitService.updateUnit(unit.unitId as string, { rented: true, type: 'OTHER' }, adminCtx()))) as unknown as Record<string, unknown>;
    expect(updated.rented).toBe(true);
    expect(updated.type).toBe('OTHER');
  });

  it('should delete a unit', async () => {
    const unit = await createUnit();

    await withTenantAccess(testOrgId, false, () => UnitService.deleteUnit(unit.unitId as string, adminCtx()));

    expect(await db().units.findUnique({ where: { unitId: unit.unitId as string } })).toBeNull();
  });

  it('should cascade-delete the units of a deleted organization', async () => {
    const unit = await createUnit();
    const id = unit.unitId as string;

    // Org DELETE under its own target context (RLS qual) — FK cascades Units.
    await rlsFixture(testOrgId).organization.delete({ where: { id: testOrgId } });

    expect(await platform.units.findUnique({ where: { unitId: id } })).toBeNull();
  });
});

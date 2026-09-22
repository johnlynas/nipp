/**
 * DB-layer RLS — platform-admin semantics (design §5.1, catalog §3.3).
 *
 * flag=1 (app.is_platform_admin='1') grants cross-tenant READS per the policy
 * shapes, but does NOT loosen WRITE binding: WITH CHECK still binds every
 * insert/update to app.current_org_id, and table-specific postures apply
 * (Organization rows editable only as platform acting ON the org; AuditLog
 * has no UPDATE/DELETE policy; Notification updates = admin ack path).
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import {
  prepareDatabase, appClient, withGucTxn, visibleIds, probeWrite, countRows,
  CTX, FIXTURE, type PreparedDb,
} from './rls-fixture';

let db: PreparedDb;
let c: Client;

beforeAll(async () => {
  db = await prepareDatabase();
  c = await appClient(db.appUrl);
}, 240_000);

afterAll(async () => {
  await c?.end().catch(() => {});
  await db?.close();
});

describe('platform admin: cross-tenant visibility (SELECT)', () => {
  it('flag=1 sees ALL organizations (incl. orgs not in ctx)', async () => {
    const ids = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, 'Organization', 'id'));
    expect(ids.sort()).toEqual([FIXTURE.orgA, FIXTURE.orgB, FIXTURE.orgPlatform].sort());
  });

  it('flag=1 sees members of BOTH tenants', async () => {
    const ids = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, 'Member'));
    expect(ids).toEqual(['mem-a1', 'mem-b1', 'mem-p1']);
  });

  it('flag=1 sees both tenants’ calendar events; flag=0 does not', async () => {
    const admin = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, 'CalendarEvent'));
    expect(admin).toEqual(['ev-a1', 'ev-a2', 'ev-b1']);

    // The SAME user without the flag (plain membership in B) sees only B.
    const plain = await withGucTxn(
      c, { userId: FIXTURE.userB, orgId: FIXTURE.orgB, isPlatformAdmin: false },
      () => visibleIds(c, 'CalendarEvent'),
    );
    expect(plain).toEqual(['ev-b1']);
  });

  it('flag=0 with org ctx B sees only B (control: no flag → no cross-tenant read)', async () => {
    const ids = await withGucTxn(c, CTX.tenantB, () => visibleIds(c, 'Role'));
    expect(ids).toEqual(['role-b1']);
  });
});

describe('platform admin: writes stay bound to context org (WITH CHECK)', () => {
  it('flag=1 CANNOT insert a Member into a non-ctx org', async () => {
    // ctx = B; row claims org A → WITH CHECK (orgId = current_org) rejects.
    const res = await probeWrite(
      c, CTX.platformAtB,
      `INSERT INTO "Member" (id, role, "orgId", "userId", "updatedAt")
       VALUES ('x-admin-mem', 'admin', '${FIXTURE.orgA}', '${FIXTURE.userSuper}', now())`,
    );
    expect(res.error).toMatch(/row-level security policy|violates row/i);
  });

  // Empirical note (verified on PG16 during suite build): org-scoped tables use the
  // FOR ALL shape with BOTH USING and WITH CHECK. Platform reads pass USING, but any
  // UPDATE touching a foreign-org row fails WITH CHECK → HARD VIOLATION (stricter than
  // the silent-0-row behavior of per-command policies like Organization's). This is the
  // intended write-bound semantics for admin: writes always stay ctx-bound.
  it('flag=1 CANNOT update a foreign-org team (WITH CHECK hard violation)', async () => {
    const res = await probeWrite(c, CTX.platformAtB, `UPDATE "Team" SET name='X' WHERE id='team-a1'`);
    expect(res.error).toMatch(/row-level security policy|violates row/i);
  });

  it('flag=1 CAN insert into its own ctx org', async () => {
    const res = await probeWrite(
      c, CTX.platformAtB,
      `INSERT INTO "Team" (id, name, "organizationId", "updatedAt")
       VALUES ('x-admin-team-b', 'Admin B Team', '${FIXTURE.orgB}', now())`,
    );
    expect(res.error).toBeNull();
    expect(res.rowCount).toBe(1); // txn rolled back — fixture intact
  });

  it('Organization: platform UPDATE only touches the ctx org row (never foreign rows)', async () => {
    // ctx = A → org B row invisible to UPDATE ⇒ 0 rows even as admin.
    const resA = await probeWrite(c, CTX.platformAtA, `UPDATE "Organization" SET name='X' WHERE id='${FIXTURE.orgB}'`);
    expect(resA.rowCount).toBe(0);

    // ctx = B → org B row IS the target ⇒ 1 row.
    const resB = await probeWrite(c, CTX.platformAtB, `UPDATE "Organization" SET name='X' WHERE id='${FIXTURE.orgB}'`);
    expect(resB.rowCount).toBe(1);

    // Tenant (flag=0) UPDATE of its own org row → 0 rows (admin-only posture:
    // prevents self-privilege edits via tenant context).
    const resT = await probeWrite(c, CTX.tenantA, `UPDATE "Organization" SET name='X' WHERE id='${FIXTURE.orgA}'`);
    expect(resT.rowCount).toBe(0);
  });

  it('Organization INSERT is platform-only', async () => {
    const res = await probeWrite(
      c, CTX.tenantA,
      `INSERT INTO "Organization" (id, name, slug) VALUES ('x-org', 'X', 'x')`,
    );
    expect(res.error).toMatch(/row-level security policy|violates row/i);
  });

  it('Notification: platform can update any row (ack path); org ctx updates own + global', async () => {
    const admin = await probeWrite(c, CTX.platformAtB, `UPDATE "Notification" SET acknowledged=TRUE WHERE id='ntf-a1'`);
    expect(admin.rowCount).toBe(1);

    const tenantA = await probeWrite(c, CTX.tenantA, `UPDATE "Notification" SET acknowledged=TRUE WHERE id='ntf-a1'`);
    expect(tenantA.rowCount).toBe(1);

    // Tenant A cannot ack org B's row.
    const foreign = await probeWrite(c, CTX.tenantA, `UPDATE "Notification" SET acknowledged=TRUE WHERE id='ntf-b1'`);
    expect(foreign.rowCount).toBe(0);
  });
});

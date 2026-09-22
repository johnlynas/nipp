/**
 * DB-layer RLS — org-scoped tables (design §5.1, catalog §3.3 shapes 1/2).
 *
 * Runs as the NON-owner app role `nipp_app`: Postgres RLS applies. Per table:
 *   - ctx=org A sees exactly org-A rows (ids), ctx=org B sees exactly B's
 *   - UPDATE/DELETE of a foreign-org row touches 0 rows (silent deny)
 *   - INSERT whose org column names the other tenant is rejected by WITH CHECK
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import {
  prepareDatabase, appClient, withGucTxn, visibleIds, probeWrite,
  CTX, FIXTURE, type PreparedDb,
} from './rls-fixture';

interface OrgTableDef {
  /** Org column literal (quoted) for this table. */
  orgField: string;
  seedA: string[];
  seedB: string[];
  /** Columns + values for a WITH-CHECK probe: FK-valid under ctx A, org = B. */
  insertCols: string;
  insertVals: (org: string) => string;
}

// Business tables (organizationId) — FK references point at CTX-A rows so the
// only failing constraint is the RLS WITH CHECK on the foreign org column.
const ORG_TABLES: Record<string, OrgTableDef> = {
  Team: {
    orgField: 'organizationId', seedA: ['team-a1'], seedB: ['team-b1'],
    insertCols: 'id, name, "organizationId", "updatedAt"',
    insertVals: (o) => `('x-team', 'Rogue', '${o}', now())`,
  },
  TeamMember: {
    orgField: 'organizationId', seedA: ['tm-a1'], seedB: ['tm-b1'],
    insertCols: 'id, "teamId", "userId", "organizationId"',
    // userId=Super (not a member of team-a1 → unique(userId,teamId) stays fresh);
    // the ONLY check that can fail is RLS WITH CHECK on the foreign org.
    insertVals: (o) => `('x-tm', 'team-a1', '${FIXTURE.userSuper}', '${o}')`,
  },
  TeamRole: {
    orgField: 'organizationId', seedA: ['tr-a1'], seedB: ['tr-b1'],
    insertCols: 'id, "teamId", "roleId", "organizationId"',
    // role-b1 FK-valid (FKs are not RLS-filtered); unique(teamId,roleId) fresh.
    insertVals: (o) => `('x-tr', 'team-a1', 'role-b1', '${o}')`,
  },
  Calendar: {
    orgField: 'organizationId', seedA: ['cal-a1'], seedB: ['cal-b1'],
    insertCols: 'id, name, "organizationId", "updatedAt"',
    insertVals: (o) => `('x-cal', 'Rogue Cal', '${o}', now())`,
  },
  CalendarEvent: {
    orgField: 'organizationId', seedA: ['ev-a1', 'ev-a2'], seedB: ['ev-b1'],
    insertCols: 'id, title, "startDate", "endDate", "calendarId", "organizationId"',
    insertVals: (o) => `('x-ev', 'Rogue Ev', now(), now() + interval '1h', 'cal-a1', '${o}')`,
  },
  Role: {
    orgField: 'organizationId', seedA: ['role-a1'], seedB: ['role-b1'],
    insertCols: 'id, name, "organizationId", "updatedAt"',
    insertVals: (o) => `('x-role', 'Rogue Role', '${o}', now())`,
  },
  RolePermission: {
    orgField: 'organizationId', seedA: ['rp-a1'], seedB: ['rp-b1'],
    insertCols: 'id, "roleId", "permissionId", "organizationId"',
    insertVals: (o) => `('x-rp', 'role-a1', 'perm_view', '${o}')`,
  },
  MemberRole: {
    orgField: 'organizationId', seedA: ['mr-a1'], seedB: ['mr-b1'],
    insertCols: 'id, "memberId", "roleId", "organizationId"',
    insertVals: (o) => `('x-mr', 'mem-a1', 'role-a1', '${o}')`,
  },
  // BetterAuth-owned org tables (orgId). Note: Member.updatedAt has no DB
  // default (Prisma app-side) — set explicitly.
  Member: {
    orgField: 'orgId', seedA: ['mem-a1'], seedB: ['mem-b1'],
    insertCols: 'id, "orgId", "userId", "updatedAt"',
    insertVals: (o) => `('x-mem', '${o}', '${FIXTURE.userA}', now())`,
  },
  Invitation: {
    orgField: 'orgId', seedA: ['inv-a1'], seedB: ['inv-b1'],
    insertCols: 'id, email, role, token, "expiresAt", "orgId"',
    insertVals: (o) => `('x-inv', 'f@x.co', 'member', 'tok-x-inv', now() + interval '7d', '${o}')`,
  },
  SentInvitation: {
    orgField: 'orgId', seedA: ['snt-a1'], seedB: ['snt-b1'],
    insertCols: 'id, email, role, token, "expiresAt", "orgId"',
    insertVals: (o) => `('x-snt', 'f@x.co', 'member', 'tok-x-snt', now() + interval '7d', '${o}')`,
  },
};

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

describe('org-scoped: ctx sees exactly its own-org rows', () => {
  for (const [table, def] of Object.entries(ORG_TABLES)) {
    it(`ctx=org A → ${def.seedA.join(',')} in ${table}`, async () => {
      const ids = await withGucTxn(c, CTX.tenantA, () => visibleIds(c, table));
      expect(ids).toEqual(def.seedA);
    });

    it(`ctx=org B → ${def.seedB.join(',')} in ${table}`, async () => {
      const ids = await withGucTxn(c, CTX.tenantB, () => visibleIds(c, table));
      expect(ids).toEqual(def.seedB);
    });
  }
});

describe('org-scoped: writes bound to context org (WITH CHECK)', () => {
  it.each(Object.keys(ORG_TABLES))('INSERT claiming org B under ctx A denied for %s', async (table) => {
    const def = ORG_TABLES[table];
    const res = await probeWrite(
      c, CTX.tenantA,
      `INSERT INTO "${table}" (${def.insertCols}) VALUES ${def.insertVals(FIXTURE.orgB)}`,
    );
    expect(res.error).toMatch(/row-level security policy|violates row/i);
  });

  // Empirically verified on PG16 (suite build): tenant-context mutation of a
  // foreign-org row is silently denied — USING filters it out, so 0 rows.
  it('UPDATE of a foreign-org row is silently denied (0 rows)', async () => {
    const res = await probeWrite(c, CTX.tenantB, `UPDATE "Team" SET name='Hacked' WHERE id='team-a1'`);
    expect(res.error).toBeNull();
    expect(res.rowCount).toBe(0);
  });

  it('DELETE of a foreign-org row is silently denied (0 rows)', async () => {
    const res = await probeWrite(c, CTX.tenantB, `DELETE FROM "Team" WHERE id='team-a1'`);
    expect(res.error).toBeNull();
    expect(res.rowCount).toBe(0);
  });

  it('own-org rows remain intact', async () => {
    const ids = await withGucTxn(c, CTX.tenantA, () => visibleIds(c, 'Team'));
    expect(ids).toEqual(['team-a1']);
  });
});

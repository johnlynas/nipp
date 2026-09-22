/**
 * DB-layer RLS — JobDefinition / JobExecution platform-only stance
 * (design §5.1, catalog §3.3 #7: strongest posture — tables store executable
 * operator code, so the ONLY legitimate actor is a verified platform admin
 * whose context platform org matches the row's platformOrgId).
 *
 * Every probe runs as the same non-owner app role (`nipp_app`); only the GUC
 * context varies. GRANTs are identical in all cases, so any visibility
 * difference is produced by the RLS policies alone.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import { prepareDatabase, appClient, withGucTxn, visibleIds, probeWrite, CTX, FIXTURE, type PreparedDb } from './rls-fixture';

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

const JOBS = ['JobDefinition', 'JobExecution'] as const;

describe('job tables: tenant context cannot see ANY rows', () => {
  for (const t of JOBS) {
    it(`tenant A ctx → 0 rows in ${t}`, async () => {
      const ids = await withGucTxn(c, CTX.tenantA, () => visibleIds(c, t));
      expect(ids).toEqual([]);
    });

    it(`tenant B ctx → 0 rows in ${t} (even the tenant that owns no platform membership path)`, async () => {
      const ids = await withGucTxn(c, CTX.tenantB, () => visibleIds(c, t));
      expect(ids).toEqual([]);
    });

    it(`tenant B CANNOT insert into ${t} (no policy allows it at all)`, async () => {
      const sql = t === 'JobDefinition'
        ? `INSERT INTO "JobDefinition" (id, "platformOrgId", name, "handlerKey", "scheduleExpr")
           VALUES ('x-job', '${FIXTURE.orgPlatform}', 'rogue', 'builtin:x', '{"kind":"cron"}')`
        : `INSERT INTO "JobExecution" (id, "jobDefinitionId", "platformOrgId", status, trigger, source)
           VALUES ('x-je', 'job-p1', '${FIXTURE.orgPlatform}', 'PENDING', 'MANUAL', 'rogue')`;
      const res = await probeWrite(c, CTX.tenantB, sql);
      expect(res.error).toMatch(/row-level security policy|violates row/i);
    });
  }
});

describe('job tables: platform flag WITHOUT matching app.platform_org_id → still hidden', () => {
  for (const t of JOBS) {
    // flag=1, ctx org B, no platformOrgId GUC → policy requires BOTH the flag
    // AND platformOrgId = row."platformOrgId" ⇒ nothing visible.
    it(`flag=1 without app.platform_org_id → 0 rows in ${t}`, async () => {
      const ids = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, t));
      expect(ids).toEqual([]);
    });
  }
});

describe('job tables: verified platform context (flag + env platform org id)', () => {
  it('platform ctx sees the seeded JobDefinition + JobExecution', async () => {
    const defs = await withGucTxn(c, CTX.platformJobs, () => visibleIds(c, 'JobDefinition'));
    expect(defs).toEqual(['job-p1']);
    const execs = await withGucTxn(c, CTX.platformJobs, () => visibleIds(c, 'JobExecution'));
    expect(execs).toEqual(['je-p1']);
  });

  it('platform ctx with a WRONG platformOrgId sees nothing (org must match the row)', async () => {
    const ids = await withGucTxn(
      c, { ...CTX.platformJobs, platformOrgId: FIXTURE.orgB },
      () => visibleIds(c, 'JobDefinition'),
    );
    expect(ids).toEqual([]);
  });

  it('platform ctx can write to the job tables (its legitimate path)', async () => {
    const res = await probeWrite(
      c, CTX.platformJobs,
      `INSERT INTO "JobExecution" (id, "jobDefinitionId", "platformOrgId", status, trigger, source)
       VALUES ('x-je-ok', 'job-p1', '${FIXTURE.orgPlatform}', 'PENDING', 'MANUAL', 'job-scheduler:execution')`,
    );
    expect(res.error).toBeNull();
    expect(res.rowCount).toBe(1); // rolled back — fixture intact
  });

  it('tenant ctx DELETE on job tables touches 0 rows', async () => {
    const res = await probeWrite(c, CTX.tenantA, `DELETE FROM "JobDefinition"`);
    expect(res.rowCount).toBe(0);
  });
});

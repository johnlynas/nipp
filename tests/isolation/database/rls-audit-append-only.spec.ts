/**
 * DB-layer RLS — AuditLog append-only posture (design §5.1, catalog §3.3 #4;
 * NotificationLog write-once sibling).
 *
 *   - meta: pg_policies contains NO update/delete policy for these tables —
 *     append-only is enforced by ABSENCE (nipp_app can never mutate rows)
 *   - SELECT: ctx-org rows + NULL-org (global) rows + platform admin sees all
 *   - UPDATE/DELETE by anyone holding nipp_app → 0 rows (no policy ⇒ deny)
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import type { Client } from 'pg';
import {
  prepareDatabase, appClient, withGucTxn, visibleIds, probeWrite,
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

describe('audit tables: no UPDATE/DELETE policy exists (meta-check)', () => {
  for (const table of ['AuditLog', 'NotificationLog']) {
    it(`${table} has only SELECT+INSERT policies`, async () => {
      const r = await db.owner.query(
        `SELECT cmd FROM pg_policies WHERE schemaname='public' AND tablename=$1
         ORDER BY cmd`, [table],
      );
      expect(r.rows.map((x) => x.cmd)).toEqual(['INSERT', 'SELECT']);
    });

    it(`${table} DELETE by the app role touches 0 rows (append-only)`, async () => {
      const res = await probeWrite(c, CTX.platformAtB, `DELETE FROM "${table}"`);
      expect(res.rowCount).toBe(0);
    });

    it(`${table} UPDATE by the app role touches 0 rows`, async () => {
      const sql = table === 'AuditLog'
        ? `UPDATE "AuditLog" SET action='tampered' WHERE id='aud-a1'`
        : `UPDATE "NotificationLog" SET message='tampered' WHERE id='nlog-a1'`;
      const res = await probeWrite(c, CTX.platformAtB, sql);
      expect(res.rowCount).toBe(0);
    });

    it(`${table} row is physically intact after tamper attempts`, async () => {
      const n = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, table));
      expect(n).toEqual(table === 'AuditLog' ? ['aud-a1', 'aud-b1', 'aud-null'] : ['nlog-a1', 'nlog-global']);
    });
  }
});

describe('audit tables: cross-tenant SELECT visibility', () => {
  it('tenant A sees own-org + global (NULL org) audit rows only', async () => {
    const ids = await withGucTxn(c, CTX.tenantA, () => visibleIds(c, 'AuditLog'));
    expect(ids).toEqual(['aud-a1', 'aud-null']);
  });

  it('tenant B sees own-org + global audit rows only', async () => {
    const ids = await withGucTxn(c, CTX.tenantB, () => visibleIds(c, 'AuditLog'));
    expect(ids).toEqual(['aud-b1', 'aud-null']);
  });

  it('platform admin sees EVERY tenant’s audit rows', async () => {
    const ids = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, 'AuditLog'));
    expect(ids).toEqual(['aud-a1', 'aud-b1', 'aud-null']);
  });

  it('NotificationLog follows the same org∪NULL visibility rule', async () => {
    const a = await withGucTxn(c, CTX.tenantA, () => visibleIds(c, 'NotificationLog'));
    expect(a).toEqual(['nlog-a1', 'nlog-global']);
    const admin = await withGucTxn(c, CTX.platformAtB, () => visibleIds(c, 'NotificationLog'));
    expect(admin).toEqual(['nlog-a1', 'nlog-global']);
  });

  it('audit INSERT: own org or global row allowed; foreign-org row denied for tenant ctx', async () => {
    const ok = await probeWrite(
      c, CTX.tenantA,
      `INSERT INTO "AuditLog" (id, action, "resourceType", "organizationId") VALUES ('x-aud-a','probe','Team', '${FIXTURE.orgA}')`,
    );
    expect(ok.error).toBeNull();

    // NULL-org (global) row — allowed for any ctx (platform broadcast audit).
    const okGlobal = await probeWrite(
      c, CTX.tenantA,
      `INSERT INTO "AuditLog" (id, action, "resourceType", "organizationId") VALUES ('x-aud-g','probe','System', NULL)`,
    );
    expect(okGlobal.error).toBeNull();

    const denied = await probeWrite(
      c, CTX.tenantA,
      `INSERT INTO "AuditLog" (id, action, "resourceType", "organizationId") VALUES ('x-aud-f','probe','Team', '${FIXTURE.orgB}')`,
    );
    expect(denied.error).toMatch(/row-level security policy|violates row/i);
  });
});

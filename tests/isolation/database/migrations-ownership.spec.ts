/**
 * DB-layer — role-level ownership & policy-catalog drift check (design §5.1).
 *
 * Guards the two structural invariants every RLS policy depends on:
 *   1. NO public table is owned by the app role `nipp_app` — a table owner
 *      bypasses its own RLS silently; if a migration ever REASSIGN'd ownership
 *      this spec fails, and so does the merge.
 *   2. The live policy set (pg_policies over public schema) exactly matches
 *      the committed golden file `policy-catalog.golden`. Drift in either
 *      direction (someone hand-CREATE POLICY in prod, a migration loses a
 *      table) is caught by hash — regenerate with:
 *        node --import tsx scripts/rls-gen-policy-golden.ts
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDatabase, APP_ROLE, type PreparedDb } from './rls-fixture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(__dirname, 'policy-catalog.golden');

let db: PreparedDb;

beforeAll(async () => {
  db = await prepareDatabase();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

/** Live catalog as `TABLE | POLICY | CMD | usings_qual` lines, sorted. */
async function liveCatalog(owner: import('pg').Client): Promise<string> {
  const r = await owner.query(`
    SELECT tablename, policyname, cmd, coalesce(qual, '') AS qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma_%'
    ORDER BY tablename, policyname, cmd`);
  return r.rows.map((x) => `${x.tablename} | ${x.policyname} | ${x.cmd} | ${x.qual}`).join('\n');
}

describe('ownership: app role owns no public table', () => {
  it(`tables owned by ${APP_ROLE}: expect 0`, async () => {
    const q = await db.owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles o ON o.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND o.rolname = $1`, [APP_ROLE]);
    expect(q.rows).toEqual([]);
  });

  it(`${APP_ROLE} is a LOGIN role without SUPERUSER/BYPASSRLS/CREATEDB`, async () => {
    const q = await db.owner.query(`
      SELECT rolsuper, rolbypassrls, rolcreatedb, rolcanlogin FROM pg_roles WHERE rolname = $1`, [APP_ROLE]);
    expect(q.rows).toHaveLength(1);
    const { rolsuper, rolbypassrls, rolcreatedb, rolcanlogin } = q.rows[0];
    expect(rolsuper).toBe(false);
    expect(rolbypassrls).toBe(false);
    expect(rolcreatedb).toBe(false);
    expect(rolcanlogin).toBe(true);
  });

  it('RLS enabled on exactly the catalog’s 18 tables', async () => {
    const q = await db.owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
        AND c.relname NOT LIKE '_prisma_%'
      ORDER BY c.relname`);
    expect(q.rows.map((x) => x.relname)).toEqual([
      'AuditLog', 'Calendar', 'CalendarEvent', 'Invitation', 'JobDefinition',
      'JobExecution', 'Member', 'MemberRole', 'Notification', 'NotificationLog',
      'Organization', 'Permission', 'Role', 'RolePermission', 'SentInvitation',
      'Team', 'TeamMember', 'TeamRole',
    ]);
  });

  it('exempt tables (global catalog/auth) have NO RLS enabled', async () => {
    const q = await db.owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
        AND c.relname IN ('User','Session','Account','Resource','ResourceRole')
        AND c.relrowsecurity`);
    expect(q.rows).toEqual([]);
  });
});

describe('policy catalog drift vs golden file', () => {
  it('live pg_policies equals policy-catalog.golden (content + hash)', async () => {
    const live = await liveCatalog(db.owner);
    const goldenRaw = readFileSync(GOLDEN, 'utf8');
    // Compare body only — the golden carries a 2-line comment header.
    const goldenBody = goldenRaw.split('\n').filter((l) => !l.startsWith('#')).join('\n').trim();
    expect(live).toBe(goldenBody);
    // Hash as a CI-friendly mirror of the same assertion.
    const crypto = await import('node:crypto');
    const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
    expect(sha(live)).toBe(sha(goldenBody));
  });

  it('every RLS-enabled table has at least one policy', async () => {
    const q = await db.owner.query(`
      SELECT c.relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity
        AND c.relname NOT LIKE '_prisma_%'
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname)`);
    expect(q.rows).toEqual([]);
  });
});

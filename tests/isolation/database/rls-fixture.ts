/**
 * DB-layer RLS test fixture (RLS plan Task 4A, design §5.1).
 *
 * Prepares a SCRATCH database (`nipp_rls_test`) — deliberately a separate
 * database, not a schema: pg_policies/pg_class ownership assertions in
 * migrations-ownership.spec.ts are per-database facts, and the scratch DB is
 * dropped + recreated on every run so dev data is never touched.
 *
 * Flow (mirrors the empirically verified driver scripts/rls-phase2-verify.mjs):
 *   1. owner connect to `postgres`, DROP/CREATE nipp_rls_test
 *   2. apply the full Prisma migration chain in name order (the DDL of a
 *      fresh `prisma migrate deploy`) — pg simple-query protocol handles the
 *      DO $$ blocks, so CI needs no psql client
 *   3. ALTER ROLE nipp_app WITH PASSWORD <NIPP_APP_DB_PASSWORD> (the roles
 *      migration creates the role passwordless; the applier injects it)
 *   4. seed a deterministic two-tenant + platform fixture (owner role, so RLS
 *      does not interfere with setup)
 *
 * Specs then probe as `nipp_app` (the non-owner app role — RLS applies).
 * GUCs are set transaction-locally via PARAMETERIZED set_config($1,$2,true);
 * the set and the guarded query share ONE txn/physical connection, exactly
 * like lib/rls-transaction.ts::bindAndRun does in the app. Every probe txn is
 * ROLLED BACK so the fixture stays intact for sibling specs.
 */
import pg from 'pg';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const APP_ROLE = 'nipp_app';
export const DB_NAME = 'nipp_rls_test';

// Deterministic fixture ids (stable across runs; used directly in assertions).
export const FIXTURE = {
  userA: 'user_aaaa',
  userB: 'user_bbbb',
  userSuper: 'user_suppr',
  orgA: 'org_alpha_1',
  orgB: 'org_beta_2',
  orgPlatform: 'org_platform_9',
} as const;

export interface GucContext {
  userId?: string;
  orgId?: string;
  isPlatformAdmin?: boolean | '0' | '1';
  platformOrgId?: string;
}

/** Resolve owner DSN + app-role password: env wins, else parsed repo .env. */
export function resolveEnv(): { ownerBaseUrl: URL; appPw: string } {
  let dbUrl = process.env.DATABASE_URL;
  let appPw = process.env.NIPP_APP_DB_PASSWORD;
  if (!dbUrl || !appPw) {
    const envFile = path.resolve(__dirname, '../../../.env');
    try {
      const text = readFileSync(envFile, 'utf8');
      for (const line of text.split('\n')) {
        const m = line.match(/^\s*(DATABASE_URL|NIPP_APP_DB_PASSWORD)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const val = m[2].replace(/^["']|["']$/g, '');
        if (m[1] === 'DATABASE_URL' && !dbUrl) dbUrl = val;
        if (m[1] === 'NIPP_APP_DB_PASSWORD' && !appPw) appPw = val;
      }
    } catch {
      /* no .env — env vars are the only source */
    }
  }
  if (!dbUrl || !appPw) {
    throw new Error(
      'rls-fixture: DATABASE_URL (owner DSN) and NIPP_APP_DB_PASSWORD must be set (env or repo .env).',
    );
  }
  return { ownerBaseUrl: new URL(dbUrl), appPw };
}

/** Replace the db path + Prisma-only URI params to point at `db`. */
function withDbPath(base: URL, db: string): string {
  const u = new URL(base.href);
  u.pathname = '/' + db;
  u.search = '';
  return u.toString();
}

/** Apply the full migration chain (name order) to a target database. */
export async function applyMigrations(ownerClient: pg.Client): Promise<number> {
  const root = path.resolve(__dirname, '../../../prisma/migrations');
  const files = readdirSync(root)
    .sort()
    .filter((f) => f !== 'migration_lock.toml' && statSync(path.join(root, f)).isDirectory());
  for (const f of files) {
    const sql = readFileSync(path.join(root, f, 'migration.sql'), 'utf8');
    try {
      await ownerClient.query(sql); // simple protocol: multi-statement OK
    } catch (e) {
      throw new Error(`rls-fixture: migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return files.length;
}

/** Seed the deterministic two-tenant + platform fixture (owner role). */
export async function seedFixture(ownerClient: pg.Client): Promise<void> {
  // Prisma migrations create camelCase columns with DOUBLE QUOTES — literal
  // identifiers. Bare SQL must quote every one of them.
  const f = FIXTURE;
  await ownerClient.query(`
INSERT INTO "User" (id, name, email, "updatedAt") VALUES
  ('${f.userA}', 'Alice A', 'a@t.co', now()),
  ('${f.userB}', 'Bob B',   'b@t.co', now()),
  ('${f.userSuper}', 'Super P', 'sup@s.co', now());

INSERT INTO "Organization" (id, name, slug, status, "updatedAt") VALUES
  ('${f.orgA}', 'Tenant A', 'ta', 'ACTIVE', now()),
  ('${f.orgB}', 'Tenant B', 'tb', 'ACTIVE', now()),
  ('${f.orgPlatform}', 'Platform', 'platform', 'ACTIVE', now());

-- Members (orgId) — one per org + platform membership for the admin user.
INSERT INTO "Member" (id, role, "orgId", "userId", "updatedAt") VALUES
  ('mem-a1', 'admin',  '${f.orgA}', '${f.userA}', now()),
  ('mem-b1', 'member', '${f.orgB}', '${f.userB}', now()),
  ('mem-p1', 'member', '${f.orgPlatform}', '${f.userSuper}', now());

-- Roles + per-org role/permission/member mappings.
INSERT INTO "Permission" (id, key, resource, action, "updatedAt") VALUES
  ('perm_view',   'properties:view',  'properties', 'view', now()),
  ('perm_money',  'finance:post',     'finance',    'post', now());

INSERT INTO "Role" (id, name, "organizationId", "updatedAt") VALUES
  ('role-a1', 'Manager A', '${f.orgA}', now()),
  ('role-b1', 'Manager B', '${f.orgB}', now());

INSERT INTO "RolePermission" (id, "roleId", "permissionId", "organizationId") VALUES
  ('rp-a1', 'role-a1', 'perm_view',  '${f.orgA}'),
  ('rp-b1', 'role-b1', 'perm_money', '${f.orgB}');

INSERT INTO "MemberRole" (id, "memberId", "roleId", "organizationId") VALUES
  ('mr-a1', 'mem-a1', 'role-a1', '${f.orgA}'),
  ('mr-b1', 'mem-b1', 'role-b1', '${f.orgB}');

-- Invitations / sent invitations (orgId).
INSERT INTO "Invitation" (id, email, role, token, "expiresAt", "orgId") VALUES
  ('inv-a1', 'new@ta.co',  'member', 'tok-inv-a', now() + interval '7d', '${f.orgA}'),
  ('inv-b1', 'new@tb.co',  'member', 'tok-inv-b', now() + interval '7d', '${f.orgB}');

INSERT INTO "SentInvitation" (id, email, role, token, "expiresAt", "orgId") VALUES
  ('snt-a1', 'old@ta.co', 'member', 'tok-snt-a', now() + interval '7d', '${f.orgA}'),
  ('snt-b1', 'old@tb.co', 'member', 'tok-snt-b', now() + interval '7d', '${f.orgB}');

-- Teams (one per org) + memberships + a team-role assignment.
INSERT INTO "Team" (id, name, slug, "organizationId", "updatedAt") VALUES
  ('team-a1', 'Ops A',  'ops-a', '${f.orgA}', now()),
  ('team-b1', 'Ops B',  'ops-b', '${f.orgB}', now());

INSERT INTO "TeamMember" (id, "teamId", "userId", "organizationId") VALUES
  ('tm-a1', 'team-a1', '${f.userA}', '${f.orgA}'),
  ('tm-b1', 'team-b1', '${f.userB}', '${f.orgB}');

INSERT INTO "TeamRole" (id, "teamId", "roleId", "organizationId") VALUES
  ('tr-a1', 'team-a1', 'role-a1', '${f.orgA}'),
  ('tr-b1', 'team-b1', 'role-b1', '${f.orgB}');

-- Calendars + events (2 events in A, 1 in B — count-distinguishable).
INSERT INTO "Calendar" (id, name, "organizationId", "updatedAt") VALUES
  ('cal-a1', 'Main A', '${f.orgA}', now()),
  ('cal-b1', 'Main B', '${f.orgB}', now());

INSERT INTO "CalendarEvent" (id, title, "startDate", "endDate", "calendarId", "organizationId", "updatedAt") VALUES
  ('ev-a1', 'Event A1', now(), now() + interval '1h', 'cal-a1', '${f.orgA}', now()),
  ('ev-a2', 'Event A2', now(), now() + interval '1h', 'cal-a1', '${f.orgA}', now()),
  ('ev-b1', 'Event B1', now(), now() + interval '1h', 'cal-b1', '${f.orgB}', now());

-- Notifications: per-org rows + a GLOBAL broadcast (NULL org).
INSERT INTO "Notification" (id, title, message, scope, "organizationId", "updatedAt") VALUES
  ('ntf-a1',     'A msg',    'm', 'ORG',    '${f.orgA}', now()),
  ('ntf-b1',     'B msg',    'm', 'ORG',    '${f.orgB}', now()),
  ('ntf-global', 'Global',   'm', 'GLOBAL', NULL,       now());

-- NotificationLog: org row + global (append-only table).
INSERT INTO "NotificationLog" (id, "recipientEmail", "eventType", message, status, "organizationId") VALUES
  ('nlog-a1',    'a@t.co', 'org.event',   'm', 'SENT', '${f.orgA}'),
  ('nlog-global','x@y.co',  'broadcast',  'm', 'SENT', NULL);

-- AuditLog: per-org rows + a global (NULL org) row.
INSERT INTO "AuditLog" (id, timestamp, action, "resourceType", "organizationId") VALUES
  ('aud-a1',    now(), 'team.created',  'Team',         '${f.orgA}'),
  ('aud-b1',    now(), 'role.updated',  'Role',         '${f.orgB}'),
  ('aud-null',  now(), 'global.boot',   'System',       NULL);

-- Job tables (platform-keyed).
INSERT INTO "JobDefinition" (id, "platformOrgId", name, "handlerKey", "scheduleExpr", enabled, approved, "createdBy", "updatedAt") VALUES
  ('job-p1', '${f.orgPlatform}', 'nightly', 'builtin:x', '{"kind":"cron"}', true, true, '${f.userSuper}', now());

INSERT INTO "JobExecution" (id, "jobDefinitionId", "platformOrgId", status, trigger, source) VALUES
  ('je-p1', 'job-p1', '${f.orgPlatform}', 'SUCCEEDED', 'SCHEDULE', 'job-scheduler:execution');
`);
}

export interface PreparedDb {
  dbName: string;
  ownerUrl: string;
  appUrl: string;
  /** Owner connection to the scratch DB (fixtures/meta checks only). */
  owner: pg.Client;
  close(): Promise<void>;
}

/** Drop+create scratch DB, run migrations, seed. Call in beforeAll once. */
export async function prepareDatabase(): Promise<PreparedDb> {
  const { ownerBaseUrl, appPw } = resolveEnv();
  const adminUrl = withDbPath(ownerBaseUrl, 'postgres');

  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await admin.query(`CREATE DATABASE ${DB_NAME}`);
  await admin.end();

  const ownerDbUrl = withDbPath(ownerBaseUrl, DB_NAME);
  const appUrl = ownerDbUrl.replace(/\/\/[^@]+@/, `//${APP_ROLE}:${appPw}@`);

  const owner = new pg.Client({ connectionString: ownerDbUrl });
  await owner.connect();

  await applyMigrations(owner);
  await owner.query(`ALTER ROLE ${APP_ROLE} WITH PASSWORD '${appPw.replace(/'/g, "''")}'`);
  await seedFixture(owner);

  return {
    dbName: DB_NAME,
    ownerUrl: ownerDbUrl,
    appUrl,
    owner,
    close: async () => {
      await owner.end();
      const a = new pg.Client({ connectionString: adminUrl });
      try {
        await a.connect();
        await a.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
      } finally {
        await a.end().catch(() => {});
      }
    },
  };
}

/**
 * Open a FRESH nipp_app connection (no residual GUCs from sibling specs).
 * Connection-scoped pool defaults guarantee an empty context.
 */
export async function appClient(appUrl: string): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: appUrl });
  await c.connect();
  return c;
}

/**
 * Run `fn` inside ONE transaction that first sets the supplied GUCs via
 * parameterized set_config($1,$2,true). ROLLBACK on exit (fixture-safe).
 * Returns fn's result, or { error } when a guard statement throws.
 */
export async function withGucTxn<T>(
  client: pg.Client,
  gucs: GucContext | null,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    if (gucs) {
      const parts: string[] = [];
      const params: unknown[] = [];
      const add = (name: string, value: string | number) => {
        params.push(name, String(value));
        parts.push(`set_config($${params.length - 1}, $${params.length}, true)`);
      };
      if (gucs.userId !== undefined) add('app.current_user_id', gucs.userId);
      if (gucs.orgId !== undefined) add('app.current_org_id', gucs.orgId);
      if (gucs.isPlatformAdmin !== undefined) {
        const v = gucs.isPlatformAdmin === true ? '1' : gucs.isPlatformAdmin === false ? '0' : String(gucs.isPlatformAdmin);
        add('app.is_platform_admin', v);
      }
      if (gucs.platformOrgId !== undefined) add('app.platform_org_id', gucs.platformOrgId);
      await client.query(`SELECT ${parts.join(', ')}`, params);
    }
    return await fn();
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}

/** Count rows visible to the CURRENT connection context (caller is in-txn). */
export async function countRows(client: pg.Client, table: string): Promise<number> {
  const r = await client.query(`SELECT count(*)::int AS n FROM "${table}"`);
  return r.rows[0].n;
}

/** Visible row ids of `col` for the current context (ordered). */
export async function visibleIds(client: pg.Client, table: string, col = 'id'): Promise<string[]> {
  const r = await client.query(`SELECT "${col}" AS v FROM "${table}" ORDER BY "${col}"`);
  return r.rows.map((x) => x.v as string);
}

/** Run a write statement in-txn; denied writes surface as rowCount 0 (no throw). */
export async function probeWrite(
  client: pg.Client,
  gucs: GucContext | null,
  sql: string,
): Promise<{ rowCount: number; error: string | null }> {
  return withGucTxn(client, gucs, async () => {
    try {
      const r = await client.query(sql);
      return { rowCount: r.rowCount ?? -1, error: null };
    } catch (e) {
      return { rowCount: -1, error: (e as Error).message };
    }
  });
}

/** ctx objects reused across specs. */
export const CTX = {
  tenantA: { userId: FIXTURE.userA, orgId: FIXTURE.orgA, isPlatformAdmin: false },
  tenantB: { userId: FIXTURE.userB, orgId: FIXTURE.orgB, isPlatformAdmin: false },
  platformAtB: { userId: FIXTURE.userSuper, orgId: FIXTURE.orgB, isPlatformAdmin: true },
  platformAtA: { userId: FIXTURE.userSuper, orgId: FIXTURE.orgA, isPlatformAdmin: true },
  platformJobs: {
    userId: FIXTURE.userSuper,
    orgId: FIXTURE.orgPlatform,
    isPlatformAdmin: true,
    platformOrgId: FIXTURE.orgPlatform,
  },
} as const;

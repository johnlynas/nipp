/**
 * DB-layer RLS — fail-closed empty-context posture (design §5.1).
 *
 * A connection with NO GUCs set must see ZERO tenant rows in every org-scoped
 * table. Empty/NULL org settings match no row; the platform flag reads as
 * unset ⇒ 0 ≠ 1. Two postures are deliberately NOT zero:
 *   - AuditLog / NotificationLog NULL-org (global) rows stay visible — they
 *     carry cross-tenant audit visibility for platform ops (design §3.3).
 *
 * Probes use FRESH connections (no GUC residue possible from sibling specs),
 * exactly the shape of an un-wrapped query reaching the DB directly.
 */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import pg from 'pg';
import { prepareDatabase, appClient, FIXTURE, type PreparedDb } from './rls-fixture';

let db: PreparedDb;

beforeAll(async () => {
  db = await prepareDatabase();
}, 240_000);

afterAll(async () => {
  await db?.close();
});

const ORG_TABLES = [
  'Team', 'TeamMember', 'TeamRole', 'Calendar', 'CalendarEvent',
  'Role', 'RolePermission', 'MemberRole',
  'Member', 'Invitation', 'SentInvitation',
];

async function countAs(c: pg.Client, table: string): Promise<number> {
  // One explicit txn — matches how an unwrapped app statement could execute.
  await c.query('BEGIN');
  try {
    const r = await c.query(`SELECT count(*)::int AS n FROM "${table}"`);
    return r.rows[0].n;
  } finally {
    await c.query('ROLLBACK').catch(() => {});
  }
}

describe('empty context: fail-closed on every org-scoped table', () => {
  it.each(ORG_TABLES)('%s → 0 rows with no GUCs at all', async (table) => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, table)).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('Organization → 0 rows (no ctx org, no flag)', async () => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, 'Organization')).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('Notification → only the global broadcast row (NULL org)', async () => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, 'Notification')).toBe(1);
    } finally {
      await c.end();
    }
  });

  it('AuditLog / NotificationLog → global (NULL org) rows only', async () => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, 'AuditLog')).toBe(1); // aud-null
      expect(await countAs(c, 'NotificationLog')).toBe(1); // nlog-global
    } finally {
      await c.end();
    }
  });

  it('JobDefinition / JobExecution → 0 rows (strongest stance)', async () => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, 'JobDefinition')).toBe(0);
      expect(await countAs(c, 'JobExecution')).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('Permission → only permissions assigned to a role in… no org ⇒ 0 rows', async () => {
    const c = await appClient(db.appUrl);
    try {
      expect(await countAs(c, 'Permission')).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('control: the SAME connection with ctx GUCs sees tenant data', async () => {
    const c = await appClient(db.appUrl);
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.current_user_id',$1,false),set_config('app.current_org_id',$2,false)`, [FIXTURE.userA, FIXTURE.orgA]);
      const r = await c.query(`SELECT count(*)::int AS n FROM "Team"`);
      expect(r.rows[0].n).toBe(1); // session-scoped GUCs (local=false) on purpose: proves the context itself, not txn scope, drives visibility
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
});

/**
 * apply-roles-migration.ts — one-shot applier for prisma/migrations/20260919035439_rls_roles.
 *
 * Connects to DIRECT_DATABASE_URL as the owner role, executes the migration SQL
 * (which creates nipp_app if absent), then sets its password from
 * NIPP_APP_DB_PASSWORD and verifies grants. Idempotent: safe to re-run.
 *
 * Usage:  NIPP_APP_DB_PASSWORD=*** npx tsx scripts/apply-roles-migration.ts
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';

async function main(): Promise<void> {
  // tsx does not auto-load .env (Prisma/Next do). Minimal fallback for direct runs.
  if (!process.env.DIRECT_DATABASE_URL && !process.env.NIPP_APP_DB_PASSWORD) {
    try {
      const envPath = path.join(__dirname, '..', '.env');
      for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
        const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
        if (!m || process.env[m[1]] !== undefined) continue;
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        process.env[m[1]] = v;
      }
    } catch {
      // .env absent — rely on the environment.
    }
  }

  // Owner connection role-creation must run against a DSN carrying a password
  // (TCP + SCRAM). Prefer DIRECT_DATABASE_URL when it carries creds, otherwise
  // fall back to DATABASE_URL (the standard app DSN, which has the postgres pw).
  const candidates = [process.env.DIRECT_DATABASE_URL, process.env.DATABASE_URL]
    .filter(Boolean) as string[];
  const ownerUrlRaw = candidates.find((u) => new URL(u).password) ?? candidates[0];
  const appPassword = process.env.NIPP_APP_DB_PASSWORD;

  if (!ownerUrlRaw) {
    console.error('FATAL: neither DIRECT_DATABASE_URL nor DATABASE_URL is set');
    process.exit(1);
  }
  if (!new URL(ownerUrlRaw).password) {
    console.error('FATAL: owner DSN has no password; set DIRECT_DATABASE_URL with full creds');
    process.exit(1);
  }
  if (!appPassword) {
    console.error('FATAL: NIPP_APP_DB_PASSWORD is not set (add it to .env)');
    process.exit(1);
  }

  const migrationPath = path.join(
    __dirname,
    '..',
    'prisma',
    'migrations',
    '20260919035439_rls_roles',
    'migration.sql'
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  const client = new pg.Client({ connectionString: ownerUrlRaw });

  try {
    await client.connect();
    console.log('Connected as', (await client.query('SELECT current_user')).rows[0].current_user);

    await client.query(sql);
    console.log('Applied role/grant migration');

    // Password as an SQL string literal — DDL does not accept bind parameters.
    // Escape single quotes per SQL standard; password is server-generated and quoted.
    const escaped = `'${appPassword.replace(/'/g, "''")}'`;
    await client.query(`ALTER ROLE nipp_app WITH PASSWORD ${escaped}`);
    console.log('Set password for nipp_app');

    const role = (await client.query(`SELECT rolname FROM pg_roles WHERE rolname='nipp_app'`)).rows;
    const grantSample = (
      await client.query(
        `SELECT count(*) AS n FROM information_schema.table_privileges
         WHERE grantee = 'nipp_app' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')
           AND table_schema = 'public'`
      )
    ).rows[0];
    console.log(`Verified: role exists=${role.length === 1}, grants across ${grantSample.n} (table x privilege) rows`);

    // Connectivity check under the new role (same host/port/db as the owner DSN).
    const base = new URL(ownerUrlRaw);
    const appUrl = `postgresql://nipp_app:${encodeURIComponent(appPassword)}@${base.host}${base.pathname}?sslmode=disable`;
    const appClient = new pg.Client({ connectionString: appUrl });
    await appClient.connect();
    console.log('nipp_app can connect, current_user =', (await appClient.query('SELECT current_user')).rows[0].current_user);
    await appClient.end();
  } catch (e) {
    console.error('FATAL:', (e as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main()
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  })
  .finally(() => {
    // pg clients are closed in main's finally; nothing else to disconnect.
  });

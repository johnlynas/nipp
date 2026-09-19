// one-off debug: why does CalendarEventType disappear? (delete after use)
import pg from 'pg';
const c = new pg.Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/rls_phase2_verify' });
await c.connect();
const r = await c.query(`SELECT t.typname, t.typtype, ns.nspname FROM pg_type t JOIN pg_namespace ns ON ns.oid=t.typnamespace WHERE t.typname LIKE 'Calendar%' OR t.typname LIKE 'Notification%' ORDER BY 1`);
console.log('types after catch-up run (before CalendarEvent failure):');
for (const row of r.rows) console.log(' ', row.typname, row.typtype, row.nspname);
await c.end();

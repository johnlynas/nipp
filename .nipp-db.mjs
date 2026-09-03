import pg from 'pg';
import fs from 'fs';

const src = fs.readFileSync('/Users/johnlynas/dev/nipp-0807/.env', 'utf8');
const line = src.split('\n').find((l) => l.startsWith('DATABASE_URL=')) || '';
let url = line.slice('DATABASE_URL='.length).trim();
if (url.startsWith('"')) url = url.slice(1, -1);
console.log('URL:', url.slice(0, 20) + '...' + url.slice(-30));

const u = new URL(url);
console.log('parsed user:', u.username);
console.log('parsed pass (decoded):', JSON.stringify(u.password ? u.password.slice(0, 4) + '...len=' + u.password.length : null));
console.log('host:', u.hostname, 'port:', u.port || (u.host.match(/\d+$/) || [6432])[0]);

const client = new pg.Client({
  host: u.hostname,
  port: Number(u.port || 5432),
  user: u.username,
  password: decodeURIComponent(u.password),
  database: u.pathname.slice(1),
});
await client.connect();
console.log('connected ok');
const r = await client.query("SELECT version()");
console.log(r.rows[0].version.split(' ')[0]);
await client.end();

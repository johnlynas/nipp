import { verifyPassword } from 'better-auth/crypto';
import pg from 'pg';
import fs from 'fs';

const src = fs.readFileSync('/Users/johnlynas/dev/nipp-0807/.env', 'utf8');
const url = src.match(/^DATABASE_URL="(.+)"/m)[1];
const user = url.match(/\/\/([^:]+):/)[1];
const dbpass = url.match(/:([^@]+)@/)[1];

const client = new pg.Client({ host: 'localhost', port: 6432, user, password: dbpass, database: 'nipp_dev' });
await client.connect();
const { rows } = await client.query(
  'SELECT acc.password AS ph FROM "Account" acc JOIN "User" u ON u.id=acc."userId" WHERE u.email ILIKE \'%johnlynas%\''
);
console.log('hash prefix:', rows[0].ph.slice(0, 25), 'len', rows[0].ph.length);

const ok = await verifyPassword('RuthB3421', rows[0].ph).catch((e) => 'ERR: ' + e.message);
console.log('RuthB3421 matches stored hash?', ok);
await client.end();

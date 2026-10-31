#!/usr/bin/env tsx
/**
 * Backfill TeamMember.membershipKey with Better Auth 1.7's canonical key:
 *   base64url-no-padding(SHA-256(JSON.stringify([teamId, userId])))
 *
 * Run AFTER migration 20261031000000_better_auth_1_7_schema and BEFORE the
 * tighten migration 20261031000001:
 *
 *   npx tsx scripts/backfill-team-membership-key.ts
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  process.env[m[1]] ??= v;
}

import prisma from '../lib/db';

function membershipKey(teamId: string, userId: string): string {
  const digest = createHash('sha256').update(JSON.stringify([teamId, userId])).digest();
  return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; teamId: string; userId: string }>>(
    'SELECT "id", "teamId", "userId" FROM "TeamMember"',
  );
  console.log(`backfilling membershipKey for ${rows.length} TeamMember row(s)`);
  let updated = 0;
  for (const row of rows) {
    const key = membershipKey(row.teamId, row.userId);
    await prisma.$executeRawUnsafe(
      `UPDATE "TeamMember" SET "membershipKey" = $1 WHERE "id" = $2`,
      key,
      row.id,
    );
    updated += 1;
  }
  const nullLeft = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM "TeamMember" WHERE "membershipKey" IS NULL',
  );
  const total = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    'SELECT count(*)::int AS n FROM "TeamMember"',
  );
  console.log(
    `updated=${updated} nullLeft=${nullLeft[0]?.n ?? -1} total=${total[0]?.n ?? -1}`,
  );
  if (nullLeft[0]?.n !== 0) {
    throw new Error('backfill incomplete — do not run the tighten migration');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

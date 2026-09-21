// Probe: does Promise.all([count, groupBy]) inside withRLSContext throw P2028?
// Usage: npx tsx scripts/tmp-probe-p2028.ts
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

import prisma from '../lib/db';
import { withRLSContext } from '../lib/rls-transaction';
import { tenantDb } from '../lib/tenant-db';

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{ userId: string; orgId: string }>>(`
    SELECT u.id AS "userId", m."orgId" AS "orgId" FROM "User" u JOIN "Member" m ON m."userId" = u.id
    JOIN "Organization" o ON o.id = m."orgId" WHERE o.slug = 'platform' LIMIT 1`);
  const { userId, orgId } = rows[0];
  console.log(`probe ctx: userId=${userId} platformOrg=${orgId}`);

  let failures = 0;
  const check = (label: string, ok: boolean) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); if (!ok) failures++; };

  // A: parallel sibling count+groupBy on the same model (your exact failing shape)
  try {
    const [a, b] = await withRLSContext(
      { userId, orgId: orgId, isPlatformAdmin: true },
      () => Promise.all([tenantDb.organization.count(), tenantDb.organization.groupBy({ by: ['status'], _count: { status: true } })]) as Promise<[number, Array<Record<string, unknown>>]>
    );
    check(`A: parallel count+groupBy -> [${a}] ${JSON.stringify(b)}`, true);
  } catch (e) {
    check(`A: parallel count+groupBy threw: ${(e as Error).message.split('\n')[0]}`, false);
  }

  // B: sequential siblings (control)
  try {
    await withRLSContext(
      { userId, orgId: orgId, isPlatformAdmin: true },
      async () => {
        const a = await tenantDb.organization.count();
        const b = await tenantDb.organization.groupBy({ by: ['status'], _count: { status: true } });
        check(`B: sequential count+groupBy -> [${a}] ${JSON.stringify(b)}`, !!(a >= 0 && b.length >= 0));
      }
    );
  } catch (e) {
    check(`B: sequential threw: ${(e as Error).message.split('\n')[0]}`, false);
  }

  // C: parallel findMany across two different models (resources route shape)
  try {
    await withRLSContext(
      { userId, orgId: orgId, isPlatformAdmin: true },
      () => Promise.all([tenantDb.organization.findMany({ take: 1 }), tenantDb.resource.findMany({ take: 1 })])
    );
    check('C: parallel findMany across two models', true);
  } catch (e) {
    check(`C: parallel findMany threw: ${(e as Error).message.split('\n')[0]}`, false);
  }

  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });

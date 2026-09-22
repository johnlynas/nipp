// Isolated repro: N concurrent withPlatformContext-style ops, each doing
// Promise.all([count, groupBy]) — the exact service shape. Pure Prisma, no Next.
// Usage: npx tsx scripts/tmp-stress-p2028.ts
import { readFileSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = /^\s*([A-Z0-9_]+)=(.*)$/.exec(line);
  if (!m) continue;
  let v = m[2].trim().replace(/\r$/, '');
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[m[1]] ??= v;
}

import prisma from '../lib/db';
import { withExplicitRLS } from '../lib/rls-transaction';
import { runWithTenantContext } from '../lib/tenant-context';
import { tenantDb } from '../lib/tenant-db';

function withPlatformCtx<T>(userId: string, op: () => T | Promise<T>): Promise<T> {
  const orgId = process.env.PLATFORM_ORGANIZATION_ID!;
  return withExplicitRLS({ userId, orgId, isPlatformAdmin: true, platformOrgId: orgId }, () => runWithTenantContext({ userId, isPlatformAdmin: true }, op));
}

async function main() {
  const [row] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT u.id AS id FROM "User" u LIMIT 1`);
  void row;

  let ok = 0;
  const errors = new Map<string, number>();
  const N = 48; // waves of 8
  for (const wave of [0, 1, 2, 3, 4, 5]) {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        try {
          // EXACT shape of organization-service.ts:125 — base client, NO pinned tx:
          const [globalTotal, globalStatusCounts] = await Promise.all([
            prisma.organization.count(),
            prisma.organization.groupBy({ by: ['status'], _count: { status: true } }),
          ]);
          if (typeof globalTotal === 'number' && Array.isArray(globalStatusCounts)) ok++;
        } catch (e) {
          const msg = ((e as Error).message || String(e)).split('\n')[0];
          errors.set(msg, (errors.get(msg) ?? 0) + 1);
        }
      })
    );
  }

  console.log(`base client: succeeded ${ok}/${N}`);
  for (const [msg, n] of errors) console.log(`errors x${n}: ${msg.slice(0, 140)}`);

  // Part 2: same through tenantDb inside withPlatformCtx (pinned tx + slot lock)
  ok = 0; errors.clear();
  const userId = (row! as { id: string }).id;
  for (const wave of [0, 1, 2, 3]) {
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        try {
          await withPlatformCtx(userId, () =>
            Promise.all([
              tenantDb.organization.count(),
              tenantDb.organization.groupBy({ by: ['status'], _count: { status: true } }),
              tenantDb.resource.findMany({ take: 1 }),
            ])
          );
          ok++;
        } catch (e) {
          const msg = ((e as Error).message || String(e)).split('\n')[0];
          errors.set(msg, (errors.get(msg) ?? 0) + 1);
        }
      })
    );
  }
  console.log(`pinned tx: succeeded ${ok}/32`);
  for (const [msg, n] of errors) console.log(`errors x${n}: ${msg.slice(0, 140)}`);

  await prisma.$disconnect();
  process.exit(errors.size ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });

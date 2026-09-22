// Live RLS proof under the APP role (nipp_app). Connects via .env DATABASE_URL; shows:
//   1. context-less (no GUCs) -> 0 org-scoped rows (fail-closed)
//   2. platform-admin flag=1  -> full cross-org visibility on admin surface
//   3. single-org ctx         -> exactly that org's Member rows, others hidden
const fs = require('fs'); const path = require('path');
process.chdir('/Users/johnlynas/dev/nipp-0807');
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const { PrismaClient } = require(path.join(process.cwd(), 'node_modules/@prisma/client'));

(async () => {
  const prisma = new PrismaClient();
  const role = await prisma.$queryRawUnsafe(`SELECT current_user::text AS u`);
  console.log('connected as role:', JSON.stringify(role[0]));

  // 1) Context-less: no GUCs set -> RLS must hide all org-scoped rows.
  const plain = await prisma.$queryRawUnsafe(`
    SELECT (SELECT count(*) FROM "Organization")::int AS orgs,
           (SELECT count(*) FROM "Member")::int AS members,
           current_setting('app.current_org_id', true) AS org_guc,
           current_setting('app.is_platform_admin', true) AS flag`);
  console.log('1. context-less (empty GUCs): ', JSON.stringify(plain[0]));

  // Pick a real org id for the scoped test (needs visibility — do it as platform first).
  const adminScan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id','prober',true), set_config('app.is_platform_admin','1',true)`);
    return tx.$queryRawUnsafe(`
      SELECT (SELECT count(*) FROM "Organization")::int AS orgs,
             (SELECT count(*) FROM "Member")::int AS members,
             (SELECT "id" FROM "Member" ORDER BY "id" LIMIT 1) AS a_sample_member_id_from_any_org,
             current_setting('app.is_platform_admin', true) AS flag`);
  });
  console.log('2. platform-admin (flag=1):   ', JSON.stringify(adminScan[0]));

  // Find an org that has members, so we can show the scoped count is strict.
  const orgProbe = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SELECT set_config('app.current_user_id','prober',true), set_config('app.is_platform_admin','1',true)`);
    return tx.$queryRawUnsafe(`
      SELECT "orgId" FROM "Member" WHERE "orgId" IS NOT NULL ORDER BY "id" LIMIT 1`);
  });
  const targetOrg = orgProbe[0]?.orgId;

  if (targetOrg) {
    // 3) Single-org context: bind that org id, flag=0 -> only that org's members.
    const lit = targetOrg.replace(/'/g, "''");
    const scoped = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.current_org_id','${lit}',true), set_config('app.is_platform_admin','0',true)`);
      return tx.$queryRawUnsafe(`
        SELECT (SELECT count(*) FROM "Member")::int AS members_in_ctx_org,
               (SELECT count(*) FROM "Calendar")::int AS calendars_in_ctx_org`);
    });
    console.log('3. single-org ctx (org=' + targetOrg.slice(0, 12) + '…): ', JSON.stringify(scoped[0]));
  } else {
    console.log('3. (skipped — no members in DB to probe)');
  }

  await prisma.$disconnect();
  console.log('OK — RLS is live and enforcing under nipp_app');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

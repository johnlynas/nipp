const fs = require('fs');
const path = require('path');
const root = '/Users/johnlynas/dev/nipp-0807';
process.chdir(root);

// Load .env DATABASE_URL (nipp_app) into process.env before prisma reads it.
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { PrismaClient } = require(path.join(root, 'node_modules/@prisma/client'));

(async () => {
  const prisma = new PrismaClient();
  console.log('Prisma client $extends (base):', typeof prisma.$extends);

  // Interactive transaction surface:
  await prisma.$transaction(async (tx) => {
    console.log('interactive tx $extends:', typeof tx.$extends);
    console.log('interactive tx .$executeRawUnsafe:', typeof tx.$executeRawUnsafe);
    console.log('interactive tx .member:', typeof tx.member);
    const r = await tx.$queryRawUnsafe('SELECT current_user::text AS u');
    console.log('tx raw connect (role):', JSON.stringify(r[0]));
  });

  // Can we $extends the base client and use its $transaction (pinned, same pool)?
  const ext = prisma.$extends({ query: { organization: {} } }); // no-op shape test
  console.log('extended client $extends:', typeof ext.$extends);
  await ext.$transaction(async (tx) => {
    console.log('tx-from-extended-client $extends:', typeof tx.$extends, '| .member:', typeof tx.member);
    const r = await tx.$executeRawUnsafe("SELECT set_config('app.current_org_id','x',true), current_setting('app.current_org_id', true) AS g");
    console.log('GUC bind + read back on tx conn:', JSON.stringify(r[0]));
  });

  await prisma.$disconnect();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

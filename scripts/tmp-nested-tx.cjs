// Does a nested prisma.$transaction work inside a running interactive transaction?
const fs = require('fs');
const path = require('path');
const root = '/Users/johnlynas/dev/nipp-0807';
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)="(.*)"/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}
const { PrismaClient } = require(path.join(root, 'node_modules/@prisma/client'));

(async () => {
  const prisma = new PrismaClient();
  try {
    await prisma.$transaction(async (outer) => {
      await outer.$queryRawUnsafe("SELECT set_config('app.current_org_id','t',true)");
      // nested interactive on the SAME client:
      const nested = await prisma.$transaction(async (inner) => {
        return inner.$queryRawUnsafe("SELECT current_setting('app.current_org_id', true) AS g, 'nested'::text AS which");
      });
      console.log('NESTED OK:', JSON.stringify(nested[0]));
    });
  } catch (e) {
    console.log('NESTED FAILED:', e.code || '', '-', e.message.split('\n')[0]);
  }
  // batch form inside interactive:
  try {
    await prisma.$transaction(async (outer) => {
      const r = await prisma.$transaction([outer.$queryRaw`SELECT 1 AS one`]);
      console.log('BATCH-INSIDE OK:', JSON.stringify(r));
    });
  } catch (e) {
    console.log('BATCH-INSIDE FAILED:', e.code || '', '-', e.message.split('\n')[0]);
  }
  await prisma.$disconnect();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });

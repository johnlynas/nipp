'use strict';
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  try {
    const org = await p.organization.findFirst({ orderBy: { createdAt: 'asc' } });
    console.log('org:', org ? JSON.stringify({ id: org.id, name: org.name }).slice(0, 160) : 'NONE');
    console.log('calendarEvents:', await p.calendarEvent.count());
  } catch (e) { require('fs').writeFileSync('/tmp/orgprobe-err.txt', e.stack || String(e)); console.log('FAIL (see /tmp/orgprobe-err.txt)'); } finally { await p.$disconnect(); }
})();

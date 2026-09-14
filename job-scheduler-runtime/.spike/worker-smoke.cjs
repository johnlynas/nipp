/**
 * Standalone worker-side smoke: forks job-scheduler-worker/index.cjs for each
 * built-in handler with a real DATABASE_URL and checks the message protocol.
 * Usage: bash run-worker-smoke.sh
 */
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ROOT = '/Users/johnlynas/dev/nipp-0807';
const WORKER = path.join(ROOT, 'job-scheduler-worker', 'index.cjs');
const BUILTINS_DIR = path.join(ROOT, 'job-scheduler-runtime', 'builtins');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL not set'); process.exit(2);
}

const HANDLERS = ['noop', 'health-check', 'calendar-health-check', 'calendar-selftest'];

let failures = 0;

async function firstOrgId() {
  const db = new PrismaClient();
  try {
    const org = await db.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return org ? org.id : null;
  } finally {
    await db.$disconnect();
  }
}

function runOne(key, orgId) {
  return new Promise((resolve) => {
    const wd = {
      __nippHandlerPath: path.join(BUILTINS_DIR, `${key}.cjs`),
      job: { name: key, worker: { workerData: {
        jobId: `smoke-${key}`, jobName: `smoke-${key}`, platformOrgId: orgId || '',
        handlerKey: key, trigger: 'SCHEDULE', actorId: null, input: key === 'noop' ? { hello: 1 } : undefined,
        timeoutMs: 30_000,
      }}},
    };
    const w = new Worker(WORKER, { workerData: wd });
    const messages = [];
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) { finished = true; console.log(`  [${key}] TIMEOUT messages=${JSON.stringify(messages.map(m => m && m.kind))}`); failures++; resolve(); }
    }, 30_000);

    w.on('message', (m) => {
      messages.push(m);
      if (m === 'done') {
        clearTimeout(timer);
        const res = messages.find((x) => x && typeof x === 'object' && ['job-result', 'job-error', 'job-killed', 'job-cancelled'].includes(x.kind));
        const started = messages.some((x) => x && typeof x === 'object' && x.kind === 'job-started');
        if (started && res && res.ok === true) {
          console.log(`  [${key}] OK ${JSON.stringify(res.resultJson).slice(0, 220)}`);
        } else if (started && res) {
          console.log(`  [${key}] FAILED kind=${res.kind} error=${String(res.error || '').slice(0, 300)}`);
          failures++;
        } else {
          console.log(`  [${key}] MALFORMED messages=${JSON.stringify(messages).slice(0, 200)}`);
          failures++;
        }
        finished = true;
        resolve();
      }
    });
    w.on('error', (e) => { clearTimeout(timer); console.log(`  [${key}] worker error: ${e.message}`); failures++; if (!finished) { finished = true; resolve(); } });
    w.on('exit', (code) => { if (!finished) { finished = true; clearTimeout(timer); console.log(`  [${key}] exited code=${code} without done (messages=${messages.length})`); failures++; resolve(); } });
  });
}

(async () => {
  const orgId = await firstOrgId();
  console.log(`worker smoke: ${WORKER} (org=${orgId || 'none'})`);
  for (const key of HANDLERS) await runOne(key, orgId);
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
})();

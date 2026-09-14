/**
 * R3 parent process — boots Bree in-process with ONE file job (timeout 600ms).
 * Run via run-spike.sh (exports DATABASE_URL, NODE_ENV=production).
 */
'use strict';
const path = require('path');
const fs = require('fs');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_DIR = path.join(APP_ROOT, 'job-scheduler-runtime', '.spike');
const JOB_PATH = path.join(RUNTIME_DIR, 'spike-job.cjs');
const SEEN = path.join(RUNTIME_DIR, 'worker-seen.json');

fs.rmSync(SEEN, { force: true });

const Bree = require(path.join(APP_ROOT, 'node_modules', 'bree'));

const bree = new Bree({
  root: false,
  doRootCheck: false,
  acceptedExtensions: ['.cjs'],
  defaultExtension: 'cjs',
  errorHandler: (err, meta) => {
    console.error('PARENT errorHandler:', err && err.stack ? err.stack : err, JSON.stringify(meta));
  },
  logger: {
    info: (m) => console.log('[bree]', m),
    warn: (m) => console.warn('[bree:warn]', typeof m === 'string' ? m : (m && m.message) || String(m)),
    error: (m) => console.error('[bree:err]', typeof m === 'string' ? m : ((m && m.stack) || JSON.stringify(m))),
  },
  workerMessageHandler: ({ name, message }) => {
    console.log('PARENT msg from', name, '->', JSON.stringify(message));
  },
});

let created = 0;
bree.on('worker created', (n) => { created++; console.log(`PARENT worker created "${n}" (run ${created})`); });
bree.on('worker deleted', (n) => {
  console.log(`PARENT worker deleted "${n}"`);
  if (created >= 1) setTimeout(finish, 300);
});

bree.add({
  name: 'spike',
  type: 'timeout',
  time: 600,
  path: JOB_PATH,
  worker: {
    workerData: { hello: 'from-parent-marker', orgId: 'org_spike' },
    env: { __SPIKE_MARKER: 'env-passed-marker' },
  },
}).then(
  () => bree.start('spike').then(() => console.log('[spike] start() resolved'), (e) => { console.error('START rejected:', e.message); process.exit(4); }),
  (err) => { console.error('ADD rejected:', err && err.message); process.exit(3); }
);

function finish() {
  try {
    console.log('\n--- worker-seen.json (worker-side discovery) -----------------');
    console.log(fs.readFileSync(SEEN, 'utf8'));
  } catch {
    console.log('NO worker-seen file yet.');
  }
}

setTimeout(() => { console.log('TIMEOUT — worker lifecycle never completed'); process.exit(2); }, 20000);
console.log(`[spike] parent up; job path: ${JOB_PATH}`);

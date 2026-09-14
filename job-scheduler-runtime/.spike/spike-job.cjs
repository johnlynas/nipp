/**
 * R3 in-repo Bree spike — worker FILE loaded from the app tree by absolute path.
 * Answers (results written to worker-seen.json + posted to parent):
 *   Q1: how does a file-based worker read `workerData`? (parentPort accessor?)
 *   Q2: does `require('<app dep>')` resolve from this dir via upward node_modules?
 *   Q3: can the worker open a working PrismaClient and query the DB?
 *   Q4: structured message -> 'done' protocol reaches the parent handler?
 */
'use strict';
const { parentPort, threadId, isMainThread } = require('worker_threads');
const fs = require('fs');
const path = require('path');

// --- Q1: discover how workerData reaches a file-based worker ------------
const wt = require('worker_threads');
let jobData = null;
try { jobData = wt.workerData ?? null; } catch { /* ignored */ }
const discovery = {
  threadId,
  isMainThread: wt.isMainThread,
  hasParentPort: Boolean(wt.parentPort),
  workerViaModuleDestructure: jobData, // documented Node channel
  envMarker: process.env.__SPIKE_MARKER ?? null,
};

// --- Q2/Q3: upward require + a real DB query ----------------------------
let prismaRequire = 'not-attempted';
let jobCount = null;

async function main() {
  try {
    const { PrismaClient } = require('@prisma/client'); // Q2
    prismaRequire = 'ok';
    const db = new PrismaClient(); // Q3
    await db.$connect();
    jobCount = await db.jobDefinition.count();
    await db.$disconnect();
  } catch (e) {
    prismaRequire = `failed: ${e.message.split('\n')[0]}`;
  }

  fs.writeFileSync(
    path.join(__dirname, 'worker-seen.json'),
    JSON.stringify({ discovery, prismaRequire, jobCount }, null, 2),
  );

  // --- Q4: structured message, then the 'done' contract ------------------
  if (parentPort) {
    parentPort.postMessage({ kind: 'spike-result', threadId, prismaRequire, jobCount });
    parentPort.postMessage('done');
  }
}

main().catch((e) => {
  if (parentPort) {
    parentPort.postMessage({ kind: 'spike-error', error: e.message.split('\n')[0] });
    parentPort.postMessage('done');
  }
});

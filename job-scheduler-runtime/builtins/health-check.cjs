/**
 * Built-in handler: `health-check`
 *
 * Runs the platform health probes (database, cache, PgBouncer connection pool)
 * from inside the forked worker, each opening its own short-lived connection —
 * which means this job independently verifies the per-worker bootstrap path
 * (R4) that every future handler relies on.
 *
 * The DB probe uses the worker's OWN prisma client, not the parent's singleton,
 * so a failure isolates worker-side connectivity rather than masking it.
 *
 * Unhealthy probes are reported in the result and surfaced by BREE as an ERROR
 * notification by the parent (source 'job-scheduler:failure'). A healthy run is
 * silent — the per-execution JOB notification already confirms it.
 */
'use strict';

async function execute(ctx) {
  const checks = {};
  let overall = 'healthy';

  // --- Database (critical) — worker-owned Prisma client -------------------
  try {
    const start = Date.now();
    await ctx.db().$queryRaw`SELECT 1`;
    checks.database = { status: 'healthy', latency_ms: Date.now() - start };
  } catch (e) {
    checks.database = { status: 'unhealthy', error: firstLine(e.message) };
    overall = 'unhealthy';
  }

  // --- Cache (non-critical) — ioredis, lazy + optional --------------------
  let redisClient = null;
  try {
    const { Redis } = require('ioredis');
    const url = process.env.REDIS_URL;
    if (!url) {
      checks.cache = { status: 'skipped', message: 'REDIS_URL not configured' };
    } else {
      redisClient = new Redis(url, {
        lazyConnect: true,
        connectTimeout: 3000,
        socketKeepAlive: false,
        retryStrategy: () => null, // never let ioredis keep the worker alive
      });
      const start = Date.now();
      await Promise.race([
        redisClient.ping(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout after 3s')), 3000)),
      ]);
      checks.cache = { status: 'healthy', latency_ms: Date.now() - start };
    }
  } catch (e) {
    checks.cache = { status: 'unhealthy', error: firstLine(e.message) };
    if (overall === 'healthy') overall = 'degraded';
  } finally {
    if (redisClient) { try { redisClient.disconnect(); } catch { /* best effort */ } }
  }

  // --- PgBouncer admin probe (critical in this deployment) -----------------
  const port = parseInt(process.env.PGBOUNCER_PORT || '6432', 10);
  try {
    // A successful TCP handshakes against the pool's listener is the worker-side
    // reachability signal (a full pgBouncer admin SQL session needs the pg driver
    // + SHOW POOLS, which the DB check above already covers at the query level).
    const ok = await tcpProbe(process.env.PGBOUNCER_HOST || 'localhost', port, 3000);
    checks['connection-pool'] = ok
      ? { status: 'healthy' }
      : { status: 'unhealthy', error: `PgBouncer admin port ${port} unreachable` };
    if (!ok) overall = 'unhealthy';
  } catch (e) {
    checks['connection-pool'] = { status: 'unhealthy', error: firstLine(e.message) };
    overall = 'unhealthy';
  }

  const unhealthy = Object.entries(checks).filter(([, c]) => c.status === 'unhealthy').map(([k]) => k);

  if (overall !== 'healthy') {
    // Fail the run so execution history + the parent's failure notification
    // make an unhealthy platform visible (the health-check job is the alarm).
    throw new Error(`health-check: ${overall} — ${unhealthy.join(', ')}`);
  }

  return {
    handler: 'health-check',
    status: overall,
    checks,
    at: new Date().toISOString(),
  };
}

function firstLine(s) {
  return String(s || '').split('\n')[0].slice(0, 300);
}

function tcpProbe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const net = require('net');
    const t = setTimeout(() => { try { socket.destroy(); } catch /* eslint-disable-line no-empty */ {} resolve(false); }, timeoutMs);
    const socket = net.connect({ host, port });
    socket.on('connect', () => {
      clearTimeout(t);
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      clearTimeout(t);
      try { socket.destroy(); } catch /* eslint-disable-line no-empty */ {}
      resolve(false);
    });
  });
}

module.exports = { execute };

/**
 * Job Scheduler — Bree worker-per-run executor (Phase 2)
 *
 * Wraps a [Bree](https://jobscheduler.net) instance so the job scheduler can
 * execute each due job in a **separate worker thread**, per the Phase 0 spike
 * findings (plan §"Phase 0 Spike Evidence"):
 *
 *   - R1: Bree forks a fresh `node:worker_threads` Worker for every run; at
 *     most one live worker per job name; results cross the boundary with
 *     `postMessage`.
 *   - R2: handlers are **file-based** (never eval'd) — the runner `.cjs` file
 *     is materialized into the gitignored, writable `job-scheduler-runtime/`
 *     directory at execution time and persists across runs; edited source is
 *     picked up on the next fork.
 *   - R3: Bree and its deps run un-bundled in the main process — they are
 *     listed under `serverExternalPackages` in `next.config.ts`, so webpack
 *     never processes them and their `new Worker()` calls see real filesystem
 *     paths (validated end-to-end by tests/integration/job-scheduler.test.ts).
 *
 * Lifecycle per run (all on the parent):
 *   1. `materializeRunner(jobId)` atomically writes
 *      `job-scheduler-runtime/<safeJobId>.cjs` (temp sibling + `fs.rename`,
 *      atomic on POSIX) so a forking worker never reads half-written JS.
 *   2. A one-shot Bree job `{ name: <runKey>, path: <runnerPath>, timeout: 5 }`
 *      is registered (`bree.add`) and fired (`bree.run(runKey)`). Bree's
 *      per-name worker guard then keeps at most one live worker per runKey —
 *      the invariant R1 established.
 *   3. The parent listens on the Worker handle (attached in the `worker
 *      created` event) for the runner's `run:result` message; non-zero crashes,
 *      message errors, and wall-clock timeouts each settle the waiter as a
 *      failure outcome, so a run always resolves.
 *   4. On completion the Bree job definition is dropped with `bree.remove(runKey)`.
 *
 * The main-thread scanner (lib/job-scheduler-engine.ts) remains the sole thing
 * that decides **when** a job is due — this module only owns **how one run
 * executes** (worker fork → result). That keeps the DB claim gate, idempotency,
 * and execution history in exactly one place: `JobSchedulerService.runJob`.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

// Bree ships its own types (src/index.d.ts). It must stay external to webpack
// (`serverExternalPackages` in next.config.ts) so it runs in Node's raw CJS
// runtime inside the Next.js server.
import Bree from 'bree';
import { env } from '@/lib/env';
import tenantDb from '@/lib/tenant-db';
import { logger } from '@/lib/logger';
import { NotificationPriority, NotificationScope } from '@prisma/client';
import { pushNotification } from '@/lib/notification-push';

// ---------------------------------------------------------------------------
// Paths and config
// ---------------------------------------------------------------------------

/** Repository root — runners reference project modules by absolute path. */
const APP_ROOT = process.cwd();

/**
 * App-tree runtime directory for materialized runners (plan §R2). Kept inside
 * the app tree so Node's upward `require` resolution finds the project's
 * `node_modules` for free; gitignored (`.gitignore`: job-scheduler-runtime/);
 * must be a writable mount in the Docker image.
 */
const RUNTIME_DIR = path.join(APP_ROOT, 'job-scheduler-runtime');

/** Hard cap on a single worker run (safety beyond the per-job timeout). */
const HARD_CAP_MS = 1_800_000; // 30 min
export { HARD_CAP_MS };

type RunnerOutcome =
  | { kind: 'ok'; result: unknown }
  | { kind: 'error'; error: string }
  | { kind: 'timeout' };

interface RunWaiter {
  runKey: string;
  resolve: (outcome: RunnerOutcome) => void;
  timeoutTimer?: NodeJS.Timeout;
}

// ---------------------------------------------------------------------------
// Shared process state (globalThis singleton — Next.js dev double-evaluation)
// ---------------------------------------------------------------------------

type BreeEngineState = {
  bree: Bree | null;
  /** runKey → waiter for an in-flight worker. */
  waiters: Map<string, RunWaiter>;
};

function getBreeState(): BreeEngineState {
  const g = globalThis as unknown as Record<string, BreeEngineState | undefined>;
  if (!g.jobSchedulerBreeState) {
    g.jobSchedulerBreeState = { bree: null, waiters: new Map() };
  }
  return g.jobSchedulerBreeState;
}

// ---------------------------------------------------------------------------
// Runner source (materialized per job — the file a Bree worker loads)
// ---------------------------------------------------------------------------

/** Path prefix embedded into every generated runner (REFS object). */
const RUNNER_PATHS = {
  bootstrap: path.join(APP_ROOT, 'job-scheduler-runtime', 'job-scheduler-worker-bootstrap.cjs'),
  service: path.join(APP_ROOT, 'services', 'job-scheduler-service.ts'),
  builtins: path.join(APP_ROOT, 'lib', 'job-scheduler-builtins.ts'),
  // RLS primitives the worker binds its run in (JobDefinition/JobExecution are
  // platform-only at the policy level — an unbound worker persists nothing).
  rlsTransaction: path.join(APP_ROOT, 'lib', 'rls-transaction.ts'),
};

/**
 * The runner template. It is self-contained **CommonJS** (Bree workers load it
 * by absolute path via `new Worker(filename)`):
 *
 *   - installs a per-worker TypeScript + `@/` alias loader hook (a fresh
 *     worker thread shares nothing with the main thread — it must register its
 *     own; see job-scheduler-worker-bootstrap.cjs),
 *   - registers the trusted built-in handler set into the service registry,
 *   - calls `JobSchedulerService.runJob(jobId, …)` exactly once and reports the
 *     outcome through `postMessage`, then exits.
 *
 * Why runJob (not the raw handler)? The claim gate, JobExecution row, timeout,
 * SSE notification, and audit trail all live in runJob — so a worker run and an
 * inline (legacy mode) run produce identical execution history. The runner is
 * pure orchestration: no handler logic of its own. No eval, no stringified
 * closures (plan §R2): the only dynamic content embedded below is a
 * JSON.stringified payload of absolute paths + jobId (quote-safe by
 * construction).
 */
function buildRunnerSource(jobId: string): string {
  const refs = JSON.stringify({ ...RUNNER_PATHS, jobId });
  // Note: the template literal below contains generated CJS code with require() calls.
  return `// Generated by lib/job-scheduler-bree.ts — do not edit.
'use strict';
const { parentPort } = require('node:worker_threads');
function report(outcome) {
  try { parentPort.postMessage({ type: 'run:result', ...outcome }); } catch {}
  process.exit(0);
}
(async () => {
  try {
    const REFS = ${refs};
    // Per-worker loader (TypeScript + '@/…' alias; see bootstrap comment).
    require(REFS.bootstrap);
    const serviceModule = require(REFS.service);
    const builtins = require(REFS.builtins);
    const rlsTx = require(REFS.rlsTransaction);
    serviceModule.JobSchedulerService.registerBuiltins(builtins.BUILTIN_HANDLERS);
    // RLS: the worker thread starts with NO tenant context and no request ALS.
    // JobDefinition/JobExecution are platform-only at the policy level — without
    // a bound platform-admin GUC, every write inside runJob is silently dropped
    // under the non-owner app role (claim, execution record, lastRunStatus). The
    // only server-derived identity available out-of-request is the env platform
    // org; withPlatformContextForDB binds it. A missing var degrades to unbound
    // (legacy) behavior rather than crashing the run.
    //
    // txTimeoutMs: Prisma auto-terminates interactive transactions after 5 s by
    // default, but a handler can legitimately run up to the job's timeout cap —
    // so the bound context must live at least as long as the worst-case run plus
    // margin (30 min hard cap + teardown). Pool cost: one pinned pooled
    // connection per in-flight worker run; MAX_CONCURRENT default 5 keeps that
    // inside connection_limit=10 for route traffic.
    const platformOrgId = process.env.PLATFORM_ORGANIZATION_ID;
    const RES = serviceModule.JobSchedulerService.runJob.bind(serviceModule.JobSchedulerService);
    const res = platformOrgId
      ? await rlsTx.withPlatformContextForDB(platformOrgId, () => RES(REFS.jobId, { trigger: 'SCHEDULE' }), { txTimeoutMs: 1_800_000 + 60_000 })
      : await RES(REFS.jobId, { trigger: 'SCHEDULE' });
    report({ ok: true, run: res });
  } catch (err) {
    report({ ok: false, error: err && err.message ? err.message : String(err) });
  }
})();
`;
}

/**
 * The worker-side bootstrap CJS file. Materialized once into RUNTIME_DIR and
 * required at the top of every runner. It makes a raw `worker_threads` Worker
 * able to execute this repository's TypeScript sources and resolve the repo's
 * `@/…` path alias:
 *
 *   - `node:module.registerHooks` (Node >= 22.15, CJS-aware) — so a `.cjs`
 *     entry point can `require()` `.ts` files;
 *   - the `resolve` hook redirects BOTH project-relative specifiers
 *     (`./env-schema`, `../foo`) and `@/<p>` aliases to candidates that try
 *     the TypeScript extensions Node's CJS resolver does not know about —
 *     transpiled CJS emits plain `require('./x')`, which vanilla Node resolves
 *     as `.js`/`.json`/`.node` only, so any extensionless relative import from
 *     a project file throws MODULE_NOT_FOUND without this;
 *   - the `load` hook transpiles project `.ts` sources (single-file, no type
 *     check — `typescript.transpileModule`) to CommonJS before require runs.
 *
 * node_modules is untouched: every dependency still resolves and loads as
 * plain JS exactly as it does on the main thread. The bootstrapper itself must
 * stay side-effect-light: it runs inside every forked worker.
 */
function buildWorkerBootstrapSource(): string {
  return `// Job scheduler worker bootstrap — generated by lib/job-scheduler-bree.ts.
'use strict';
// A fresh worker thread shares NO loader state with the main thread, so the
// repo's TypeScript sources and the '@/…' alias must be registered locally
// before the first require of a .ts module. registerHooks (Node >= 22.15)
// covers the CJS path this runner uses.
const nodeModule = require('node:module');
const path = require('node:path');
const fsSync = require('node:fs');

const APP_ROOT = ${JSON.stringify(APP_ROOT)};

// Mark this thread as a job-scheduler worker (read via isJobSchedulerWorker()
// in services/job-scheduler-service.ts): the scheduler's SSE subscribers only
// live in the parent thread, so in-worker lifecycle-notification emission is
// skipped and the parent re-emits once it receives the run result.
globalThis.jobSchedulerWorker = true;

function exists(p) { try { fsSync.accessSync(p); return true; } catch { return false; } }
function resolveTsCandidate(base) {
  const candidates = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

if (typeof nodeModule.registerHooks !== 'function') {
  throw new Error('job-scheduler worker bootstrap requires node:module.registerHooks (Node >= 22.15)');
}

const typescript = require(require.resolve('typescript', { paths: [APP_ROOT] }));

nodeModule.registerHooks({
  resolve(source, context, nextResolve) {
    // '@/…' alias → project root (TS extensions).
    if (typeof source === 'string' && source.startsWith('@/')) {
      const candidate = resolveTsCandidate(path.join(APP_ROOT, source.slice(2)));
      if (candidate) return nextResolve(candidate, context);
    }
    // Extensionless RELATIVE imports from project files: transpiled CJS emits
    // require('./env-schema') etc., which vanilla Node's CJS resolver cannot
    // map to .ts/.tsx. Redirect when the importing file is inside APP_ROOT
    // (node_modules packages keep vanilla semantics).
    if (typeof source === 'string' && (source.startsWith('./') || source.startsWith('../'))) {
      let parentPath = '';
      try { parentPath = require('node:url').fileURLToPath(context.parentURL); } catch {}
      if (parentPath.startsWith(APP_ROOT + path.sep) && !parentPath.includes('node_modules')) {
        const candidate = resolveTsCandidate(path.resolve(path.dirname(parentPath), source));
        if (candidate) return nextResolve(candidate, context);
      }
    }
    return nextResolve(source, context);
  },
  load(url, context, nextLoad) {
    if (typeof url === 'string' && url.endsWith('.ts') && !url.includes('node_modules')) {
      const nodeUrl = require('node:url');
      const filePath = nodeUrl.fileURLToPath(url);
      const out = typescript.transpileModule(fsSync.readFileSync(filePath, 'utf8'), {
        compilerOptions: {
          module: typescript.ModuleKind.CommonJS,
          target: typescript.ScriptTarget.ES2022,
          esModuleInterop: true,
          resolveJsonModule: true,
          isolatedModules: true,
        },
        fileName: filePath,
      });
      return { format: 'commonjs', source: out.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
`;
}

/**
 * Write (idempotently) the worker bootstrap into RUNTIME_DIR. Returns its path.
 * Idempotent by CONTENT: a previously written bootstrap is kept only when it
 * byte-matches the current template, so loader fixes in this file take effect
 * on the next run without waiting out the 24 h freshness window (which used to
 * silently ship stale loaders; see the relative-import resolve hook below).
 */
async function materializeWorkerBootstrap(): Promise<string> {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  const finalPath = path.join(RUNTIME_DIR, 'job-scheduler-worker-bootstrap.cjs');
  const source = buildWorkerBootstrapSource();
  const existing = await fs.readFile(finalPath, 'utf8').catch(() => null);
  if (existing === source) return finalPath; // byte-identical — nothing to do
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, source, 'utf8');
  try {
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  return finalPath;
}

/**
 * Write the runner for a job atomically: temp sibling + `fs.rename` (atomic on
 * POSIX) so a forking worker never reads half-written JS. Returns the absolute
 * `.cjs` path. The file persists across runs by design — the next fork re-reads
 * it, which is how edited source takes effect without a restart (plan §R2).
 */
async function materializeRunner(jobId: string): Promise<string> {
  await materializeWorkerBootstrap();
  const safe = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const finalPath = path.join(RUNTIME_DIR, `${safe}.cjs`);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, buildRunnerSource(jobId), 'utf8');
  try {
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
  return finalPath;
}

// ---------------------------------------------------------------------------
// Bree instance
// ---------------------------------------------------------------------------

type BreeLogger = { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

/** Thin adapter so Bree's Cabin-style logger calls land in pino (prod) / console (dev). */
function makeBreeLogger(): BreeLogger {
  const isProd = env.NODE_ENV === 'production';
  return {
    info(msg: unknown, meta?: unknown) {
      const e = msg instanceof Error ? msg.message : String(msg);
      if (isProd) logger.info({ bree: e, meta }, '[bree]');
      else console.log(`[bree][info] ${e}`);
    },
    warn(msg: unknown, meta?: unknown) {
      const e = msg instanceof Error ? msg.message : String(msg);
      if (isProd) logger.warn({ bree: e, meta }, '[bree]');
      else console.warn(`[bree][warn] ${e}`);
    },
    error(msg: unknown, meta?: unknown) {
      const e = msg instanceof Error ? msg.message : String(errToSafeString(msg));
      if (isProd) logger.error({ bree: e, meta }, '[bree]');
      else console.error(`[bree][error] ${e}`);
    },
  };
}

function errToSafeString(v: unknown): string {
  return v instanceof Error ? v.message : String(v);
}

/**
 * Create the Bree instance (once per process). `root: false` +
 * `doRootCheck: false` disable the on-disk `jobs/` directory requirement;
 * runners are added by absolute path.
 */
function getBree(): Bree {
  const state = getBreeState();
  if (!state.bree) {
    const bree = new Bree({
      root: false,
      doRootCheck: false,
      logger: makeBreeLogger(),
      jobs: [],
      timeout: 0,
      interval: 0,
    });

    // Surface worker lifecycle on the parent so runs are observable and a
    // wedged worker never silently holds its waiter:
    //   - 'run:result' message  → ok/error outcome (happy paths)
    //   - non-'done' exit       → crash or kill (Bree already terminated the
    //                             Worker on our timeout path; if it simply
    //                             died, code is non-zero)
    //   - messageerror          → structured message could not be cloned
    bree.on('worker created', (name: string) => {
      void (async () => {
        const waiter = state.waiters.get(name);
        if (!waiter) return;
        // Bree stores the Worker synchronously in this.workers before emitting
        // 'worker created' (see Bree.run), so it is already present.
        const worker = bree.workers.get(name);
        if (!worker) return;
        worker.on('message', (message: unknown) => {
          const m = message as { type?: string; ok?: boolean; run?: unknown; error?: string };
          if (m && m.type === 'run:result') {
            settleWaiter(name, m.ok ? { kind: 'ok', result: m.run } : { kind: 'error', error: m.error ?? 'worker reported failure' });
          }
        });
        worker.on('exit', (code: number) => {
          settleWaiter(name, code === 0
            ? { kind: 'error', error: 'worker exited cleanly without reporting an outcome' }
            : { kind: 'error', error: `worker exited with code ${code} before reporting` });
        });
        worker.on('messageerror', (err: Error) => {
          settleWaiter(name, { kind: 'error', error: `worker message error: ${err.message}` });
        });
      })();
    });

    state.bree = bree;
  }
  return state.bree;
}

function settleWaiter(runKey: string, outcome: RunnerOutcome): void {
  const state = getBreeState();
  const waiter = state.waiters.get(runKey);
  if (!waiter) return; // already settled (a racing event path won)
  if (waiter.timeoutTimer) clearTimeout(waiter.timeoutTimer);
  state.waiters.delete(runKey);
  waiter.resolve(outcome);
}

/** Drop a completed Bree job definition without touching other names. */
async function removeRunKey(bree: Bree, runKey: string): Promise<void> {
  try {
    await bree.remove(runKey);
  } catch (err) {
    // Already gone or never fully registered — not a failure for the caller.
    logger.warn({ runKey, error: errToSafeString(err) }, 'bree engine: removing job definition failed');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute one job in a fresh Bree worker thread and await its outcome.
 *
 * The runner calls `JobSchedulerService.runJob(jobId, { trigger: 'SCHEDULE' })`
 * *inside* the worker — claim gate, JobExecution row, handler dispatch, timeout,
 * SSE notification and audit trail all run where they always have (same
 * service, same code path; the worker rebuilds its own Prisma/logger context
 * through the TS loader). The parent only marshals in `jobId` and receives the
 * RunResult.
 *
 * @param jobId      JobDefinition id
 * @param timeoutMs  Per-job wall-clock cap (JobDefinition.timeoutMs); bounded
 *                   by HARD_CAP_MS as a global backstop.
 */
async function executeJobInWorker(jobId: string, timeoutMs?: number): Promise<RunnerOutcome> {
  const state = getBreeState();
  const bree = getBree();

  const cap = Math.min(Number.isFinite(timeoutMs) && timeoutMs ? timeoutMs : HARD_CAP_MS, HARD_CAP_MS);
  const runnerPath = await materializeRunner(jobId);
  // Unique per run: overlapping runs of the same job (manual + schedule in
  // flight simultaneously) never collide; Bree's per-name guard still limits
  // one live worker *per runKey*.
  const runKey = `jsr-${jobId}-${Date.now()}`;

  const outcomePromise = new Promise<RunnerOutcome>((resolve) => {
    state.waiters.set(runKey, {
      runKey,
      resolve,
      timeoutTimer: setTimeout(() => {
        settleWaiter(runKey, { kind: 'timeout' });
        void stopOneRun(bree, runKey); // best-effort kill of the wedged worker
      }, cap + 15_000), // grace for worker startup/teardown around the job's own cap
    });
  });

  try {
    await bree.add({ name: runKey, path: runnerPath, timeout: 5 });
    await bree.run(runKey).catch((err: unknown) => {
      settleWaiter(runKey, { kind: 'error', error: `bree run failed: ${errToSafeString(err)}` });
    });
  } catch (err) {
    settleWaiter(runKey, { kind: 'error', error: errToSafeString(err) });
    await removeRunKey(bree, runKey);
    throw err;
  }

  const outcome = await outcomePromise;
  await removeRunKey(bree, runKey);
  return outcome;
}

/** Stop a single in-flight run: Bree posts 'cancel' to its worker if alive. */
async function stopOneRun(bree: Bree, runKey: string): Promise<void> {
  const worker = bree.workers.get(runKey);
  if (!worker) return;
  try {
    await bree.stop(runKey);
  } catch (err) {
    logger.warn({ runKey, error: errToSafeString(err) }, 'bree engine: stop single run failed');
  }
}

/**
 * Reap orphaned runner files: any `<safeJobId>.cjs` in RUNTIME_DIR whose
 * JobDefinition no longer exists is unlinked (plan §R2 lifecycle). Safe to call
 * at boot; never touches files for live jobs; skips temp/bootstrap entries.
 */
async function reapStaleRunners(): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(RUNTIME_DIR);
  } catch {
    return 0; // directory absent — nothing to reap
  }
  let reaped = 0;
  for (const name of entries) {
    if (!name.endsWith('.cjs') || name.includes('.tmp-')) continue;
    if (name === 'job-scheduler-worker-bootstrap.cjs') continue;
    const jobId = name.slice(0, -4); // '<safeJobId>.cjs' — reverse the sanitization
    try {
      const row = await tenantDb.jobDefinition.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!row) {
        await fs.unlink(path.join(RUNTIME_DIR, name));
        reaped++;
      }
    } catch (err) {
      logger.warn({ file: name, error: errToSafeString(err) }, 'bree engine: reap check failed for runner file');
    }
  }
  if (reaped > 0) logger.info({ reaped }, 'bree engine: reaped stale runner files');
  return reaped;
}

/**
 * Emit one platform-visible alert when the worker engine itself fails. Kept
 * here so callers don't duplicate push wiring.
 */
async function notifyWorkerEngineFailure(message: string): Promise<void> {
  try {
    await pushNotification({
      title: 'Job scheduler worker engine error',
      message,
      priority: NotificationPriority.ERROR,
      scope: NotificationScope.GLOBAL,
      source: 'job-scheduler:worker-error',
    });
  } catch {
    // A broken notification channel must not mask the original failure.
  }
}

/**
 * Shut the engine down: cancel all in-flight workers (Bree posts 'cancel') and
 * drop pending one-shot schedules so nothing forks after this returns. Wired to
 * SIGTERM/SIGINT by lib/job-scheduler-engine.ts (graceful shutdown, plan risk
 * table). Idempotent.
 */
async function stopAllRuns(): Promise<void> {
  const state = getBreeState();
  if (!state.bree) return;
  try {
    await state.bree.stop();
  } catch (err) {
    logger.warn({ error: errToSafeString(err) }, 'bree engine: graceful stop incomplete');
  }
}

export interface JobSchedulerBreeExecutor {
  executeJobInWorker: typeof executeJobInWorker;
  stopOneRun: typeof stopOneRun;
  stopAllRuns: typeof stopAllRuns;
  reapStaleRunners: typeof reapStaleRunners;
  notifyWorkerEngineFailure: typeof notifyWorkerEngineFailure;
  materializeRunner: typeof materializeRunner;
  materializeWorkerBootstrap: typeof materializeWorkerBootstrap;
  buildRunnerSource: typeof buildRunnerSource;
  buildWorkerBootstrapSource: typeof buildWorkerBootstrapSource;
  /** Absolute path of the runtime directory (exposed for tests/integration). */
  runtimeDir: string;
}

const JobSchedulerBree: JobSchedulerBreeExecutor = {
  executeJobInWorker,
  stopOneRun,
  stopAllRuns,
  reapStaleRunners,
  notifyWorkerEngineFailure,
  materializeRunner,
  materializeWorkerBootstrap,
  buildRunnerSource,
  buildWorkerBootstrapSource,
  runtimeDir: RUNTIME_DIR,
};

export default JobSchedulerBree;
export { RUNTIME_DIR as BREE_RUNTIME_DIR, APP_ROOT, getBree, buildRunnerSource, buildWorkerBootstrapSource };
export type { RunnerOutcome, BreeEngineState };

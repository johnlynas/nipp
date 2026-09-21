/**
 * Active RLS transaction slot — per-ASYNC-LINEAGE (request-scoped).
 *
 * withRLS/withExplicitRLS pin an interactive-transaction client here for the
 * duration of one operation; lib/tenant-db.ts resolves every model access against
 * this store so that — inside a bound transaction — GUCs set via $executeRawUnsafe
 * and all model queries physically share the SAME connection (Postgres RLS enforced).
 * Outside a transaction the store is empty and tenantDb falls through to the
 * platform-scoped base client (bootstrap / RSC renders / non-tenant paths).
 *
 * CRITICAL (bug fixed 2026-09-20): this MUST be AsyncLocalStorage, not a single
 * mutable global. A one-slot global is shared across ALL concurrent requests in the
 * Node process: request B's render would inherit request A's pinned tx — including
 * AFTER A's transaction had committed ("Transaction already closed" on live RSC pages).
 *
 * Scoping uses `storage.run(tx, op)`, NOT `enterWith`: run() confines the store to
 * the callback's async descendants and leaves the surrounding context untouched, so
 * no completed transaction can leak into later requests. (enterWith rewrites the
 * current lineage frame for continuations scheduled before the "reset" — leaks.)
 *
 * Deliberately self-contained (own AsyncLocalStorage, no lib imports) so tests can
 * mock tenant-context/rls modules freely without this module breaking on missing
 * mock exports.
 */
import { AsyncLocalStorage } from 'async_hooks';

const activeRLSTxStorage = new AsyncLocalStorage<unknown | undefined>();

/**
 * Run `op` with `tx` visible to getActiveRLSTx() throughout op's async descendants
 * (the whole operation tree, across awaits). The surrounding context is unchanged.
 *
 * Always returns a real Promise: `run` forwards the callback result as-is, so an op
 * that returns synchronously would surface a non-Thenable value (bug 2026-09-21: sync
 * route closures with un-awaited service calls produced `.then is not a function`,
 * rejecting the outer $transaction and rolling back pinned txns mid-query → P2028
 * storm). `Promise.resolve` normalizes sync returns without changing async behavior.
 */
export function wrapWithActiveRLSTx<T>(tx: unknown, op: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(activeRLSTxStorage.run(tx, () => op()));
}

/** The currently pinned interactive-tx client, or null outside a bound transaction. */
export function getActiveRLSTx(): unknown | null {
  const store = activeRLSTxStorage.getStore();
  return store ?? null;
}

/**
 * Per-pinned-transaction serialization slot (bug fixed 2026-09-21 — P2028 storm).
 *
 * A pinned interactive tx is a SINGLE connection whose whole op commits when the
 * outer callback resolves. Two model ops issued concurrently on it (the ubiquitous
 * `Promise.all([findMany, count])` pattern in services) RACE: whichever finishes
 * first makes Prisma commit the tx "batch", and the other lands on a committed
 * transaction → P2028 "Transaction already closed". Verified live on 6.19.3:
 * under Next.js (microtask gaps between sibling issue and execution grow with
 * load / route-handler awaits) this fires on every loaded page; in isolation it
 * does not. Fix: queue every model access per pinned tx (slot object carries a
 * promise chain). Siblings become sequential — correct on a 1-conn tx by design,
 * no shared-state change, no cross-request coupling (separate requests pin
 * separate tx objects → parallelism preserved across requests).
 */
export interface RLSTxSlot {
  tx: unknown;
  lockMap: Map<unknown, Promise<unknown>>;
}

export function makeRLSTxSlot(tx: unknown): RLSTxSlot {
  return { tx, lockMap: new Map() };
}

/** Run `fn` serially with every other pinned-tx model op (queue per slot/tx). */
export function runWithRLSTxLock<T>(slot: RLSTxSlot, fn: () => T | Promise<T>): Promise<T> {
  const prev = slot.lockMap.get(slot.tx) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Cap the chain tail at no-op resolutions so we only remember settle state.
  slot.lockMap.set(slot.tx, next.then(() => undefined, () => undefined));

  // P2028 DIAG (temporary): per-tx in-flight depth. Serial ops on one pinned tx
  // keep depth ≤1 through the lock; if a P2028 still fires we need to see whether
  // >1 op is ever entering simultaneously (proxy bypass) or not (root cause lies
  // outside this chain). Emits one line per pinned tx at teardown.
  const d = diagFor(slot.tx);
  d.depth++;
  if (d.depth > d.maxDepth) d.maxDepth = d.depth;
  d.ops++;
  next.then(
    () => { d.depth--; },
    () => { d.depth--; },
  );
  return next as Promise<T>;
}

const __diag = new Map<object, { depth: number; maxDepth: number; ops: number }>();
function diagFor(key: unknown) {
  const k = key as object;
  let s = __diag.get(k);
  if (!s) {
    s = { depth: 0, maxDepth: 0, ops: 0 };
    __diag.set(k, s);
  }
  return s;
}

/** DIAG helper: log per-pinned-tx in-flight stats at op teardown (temporary). */
export function diagLogMaxDepth(key: unknown): number {
  const s = __diag.get(key as object);
  if (!s) return 0;
  if (process.env.NODE_ENV !== 'production' && s.maxDepth > 1) {
    // ANOMALY: two model ops ran simultaneously on one pinned tx — the P2028 race.
    console.log(`[rls-tx-diag] OVERLAP maxConcurrentOps=${s.maxDepth} totalOps=${s.ops}`);
  }
  return s.maxDepth;
}

/** DIAG helper: clear recorded per-tx stats. */
export function diagResetPinnedTx(): void {
  __diag.clear();
}

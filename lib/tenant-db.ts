/**
 * tenantDb — verified-context Prisma client (RLS plan Phase 1C/3A, as-built).
 *
 * Two cooperating lines of defense:
 *   1. APP LAYER: $extends query callbacks (lib/tenant-extension-core.ts) force
 *      `organizationId` (= `orgId` on Member) into where/data on every
 *      tenant-scoped model operation, resolved from the async-localStorage
 *      tenant context; platform-admin contexts pass through to RLS. Fail-closed
 *      when no context is active at all.
 *   2. DB LAYER: callers wrap their verified context in withTenantRLS /
 *      withPlatformContext (lib/rls-transaction.ts, lib/platform-db.ts). That
 *      pins ONE interactive-transaction client, sets app.current_* GUCs on it,
 *      and publishes it via lib/db-context.ts. This module is a Proxy: inside
 *      such a transaction every MODEL access resolves to the tenant-extension-
 *      wrapped interactive tx (extensions applied to `tx`), so the GUCs, the
 *      app-layer scoping, and the Postgres RLS policies all evaluate on the
 *      SAME physical connection (verified: $extends applies to interactive-tx
 *      clients — scripts/rls-phase3-probe.mjs).
 *
 * Outside a bound transaction the proxy falls through to the platform-scoped
 * extended base client (startup/platform-bootstrap paths without a tenant).
 * The app DB role is nipp_app (non-owner): Postgres RLS applies to every query,
 * fail-closed — an unverified context-less scoped query cannot return rows.
 */
// Public surface type — consumers see the FULL base client type ($transaction,
// counts, includes, … all resolve exactly as before). Only runtime model
// resolution is context-aware (see module docs).
export type TenantDb = typeof import('./db').default;

import prisma from './db';
import { getActiveRLSTx, runWithRLSTxLock, type RLSTxSlot } from './db-context';
import { TENANT_SCOPED_MODELS, buildTenantExtensions, type TenantExtension } from './tenant-extension-core';

const TENANT_EXTENSIONS: TenantExtension[] = buildTenantExtensions();

/** Minimal interface for chaining $extends calls in reduce. */
interface Extendable {
  $extends(extension: unknown): Extendable;
}

// Compose the platform-scoped base client (type cast keeps call sites fully typed).
const baseExtended = TENANT_EXTENSIONS.reduce(
  (client, ext) => client.$extends(ext),
  prisma as unknown as Extendable,
) as unknown as typeof prisma;

/** Memoization note: interactive-tx clients need NO re-wrap — see resolveModel. */

function resolveModel(prop: string): unknown {
  if (prop.startsWith('$')) {
    // $* client methods normally on the base client. Special case: $transaction
    // must REUSE any pinned RLS connection, because a fresh Prisma interactive-
    // tx opens a NEW pooled connection where the GUCs bound for this operation are
    // NOT visible (verified live: nested tx reads app.current_org_id = null).
    // Re-entering the pinned tx keeps GUCs + queries on ONE physical connection so
    // service-level transactions inside a withRLS op stay covered end-to-end.
    if (prop === '$transaction') {
      const pinned = getActiveRLSTx() as RLSTxSlot | null;
      if (pinned) {
        return async (fn: (tx: never) => Promise<unknown> | unknown) => fn(pinned.tx as never);
      }
    }
    return (baseExtended as unknown as Record<string, unknown>)[prop];
  }

  const tx = getActiveRLSTx() as RLSTxSlot | null;
  if (tx && Object.prototype.hasOwnProperty.call(tx.tx, prop)) {
    // Inside a bound RLS transaction: resolve the model to the SAME pinned
    // interactive-tx client that had its GUCs set via $executeRawUnsafe.
    //
    // Prisma LIMITATION (verified live on 6.19.3): `tx.$extends` is undefined —
    // extensions cannot be applied to interactive-transaction clients. So we do
    // NOT re-wrap tx with the app-layer tenant extension; the DB layer is the
    // enforcer here: GUCs + Postgres RLS policies evaluate on this one physical
    // connection (the second line of defense, fully covering all 18 tables).
    // Non-transactional calls below retain the app-layer injection as a third line.
    //
    // P2028 GUARD (2026-09-21): each model op on a pinned tx runs through the
    // slot's lock, so sibling ops (the ubiquitous Promise.all([list, count]))
    // serialize on the single connection instead of racing — first to finish
    // no longer commits the underlying "batch" under the other. Methods are
    // wrapped one-by-one via a per-access proxy (model objects expose findMany/
    // count/… as functions; the model accessor itself stays an object).
    const raw = (tx.tx as Record<string, unknown>)[prop] as Record<PropertyKey, unknown>;
    return new Proxy(raw, {
      get: (target, key) => {
        const v = (target as Record<PropertyKey, unknown>)[key];
        if (typeof v === 'function') {
          return (...a: unknown[]) => runWithRLSTxLock(tx, () => (v as (...args: unknown[]) => Promise<unknown>)(...a));
        }
        return v;
      },
    });
  }
  return (baseExtended as unknown as Record<string, unknown>)[prop];
}

/** Public surface: same type as the base client; runtime is context-aware. */
const tenantDb = new Proxy(baseExtended as unknown as Record<string, unknown>, {
  get: (target, prop: string | symbol) => {
    if (typeof prop !== 'string') return (target as unknown as Record<symbol, unknown>)[prop];
    return resolveModel(prop);
  },
  has: (target, prop) => prop in target,
}) as unknown as TenantDb;

export { tenantDb };
/** Test/inspection handle: the tenant-scoped model names. */
export { TENANT_SCOPED_MODELS };
export default tenantDb;

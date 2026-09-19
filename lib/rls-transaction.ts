/**
 * runWithRLS — the single choke-point that binds verified RLS context to a
 * database operation, guaranteeing the GUCs and the query share ONE connection.
 *
 * How it works:
 *   1. Validate the context (fail closed on empty userId/orgId).
 *   2. Start an interactive Prisma transaction — for its duration Prisma pins
 *      this client to a single physical connection, so GUCs set with
 *      set_config(..., local=true) are visible to every query in the block
 *      and disappear when the block ends (pooling cannot leak context).
 *   3. Issue buildRLSContextQueries() via $executeRawUnsafe on that tx.
 *   4. Run the caller's operation on the SAME tx client, propagating its
 *      value/throw unchanged.
 *
 * This is the Phase-2+3 wiring target: services/routes call
 * `runWithRLS(client, ctx, (tx) => service.txCall(tx))`. It is intentionally
 * not imported by tenant-db.ts in Phase 1 (no live policies yet — see plan).
 */
import type { PrismaClient } from '@prisma/client';
import { buildRLSContextQueries, type RLSContext } from './rls-context';

/** Minimal interactive-transaction client surface used here. */
export interface RLSTx {
  $executeRawUnsafe(query: string): Promise<unknown>;
}

export interface RLSClient {
  $transaction<T>(fn: (tx: RLSTx & Record<string, unknown>) => Promise<T>): Promise<T>;
}

/**
 * Run `op` inside a single-connection transaction with verified RLS GUCs set.
 */
export async function runWithRLS<T>(
  client: PrismaClient | RLSClient,
  ctx: RLSContext,
  op: (tx: RLSTx & Record<string, unknown>) => Promise<T> | T
): Promise<T> {
  if (!ctx || !ctx.userId) {
    throw new Error('RLS context invalid: userId required (fail-closed)');
  }
  if (!ctx.orgId) {
    throw new Error('RLS context invalid: orgId required (fail-closed)');
  }

  const c = client as RLSClient;
  return c.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(buildRLSContextQueries(ctx));
    return op(tx);
  });
}

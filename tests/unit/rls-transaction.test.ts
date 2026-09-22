import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { withTenantRLS, withExplicitRLS, runWithRLS, type RLSTx } from '@/lib/rls-transaction';
// Static import of the REAL slot module — in this test file static and dynamic
// resolution may yield separate instances (Vitest CJS interop), so every
// assertion MUST read through THIS binding; rls-transaction reads its own.
import * as dbContext from '@/lib/db-context';

// ---------------------------------------------------------------------------
// Fake ALS state for the tenant-context module (used by withTenantRLS)
// ---------------------------------------------------------------------------
const ctxState = { current: null as { userId: string; orgId: string; isPlatformAdmin: boolean } | null };
vi.mock('@/lib/tenant-context', () => ({
  getRLSContext: () => ctxState.current,
  // Pass-through: the wrapper only establishes ALS scope for `op`; tests
  // assert on GUC binding + slot routing, not ALS internals.
  runWithTenantContext: (_ctx: unknown, op: () => unknown) => op(),
}));

// Fake prisma base client (withTenantRLS / withExplicitRLS bind onto it).
// `live.tx` is swapped per-test to a fresh fake tx. vi.hoisted keeps the fakes
// available inside the hoisted vi.mock factories (no TDZ on module consts).
const { live, baseClient } = vi.hoisted(() => {
  const live: { tx: unknown } = { tx: null };
  const baseClient = {
    $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(live.tx) as Promise<unknown>,
  };
  return { live, baseClient };
});
vi.mock('@/lib/db', () => ({ default: baseClient }));

// lib/db-context (the slot) is intentionally NOT mocked here: rls-transaction's
// relative './db-context' import resolves to its own instance, so a vi.mock
// factory would only intercept the test-side copy and leave the slot
// assertions asserting against the wrong module. The real slot module is
// trivial (LIFO set/get), safe to exercise directly through the static
// binding imported above.

function makeFakeTx() {
  const calls: string[] = [];
  const execMock = vi.fn(async (sql: string) => {
    calls.push(sql);
  });
  const tx: RLSTx = { $executeRawUnsafe: execMock } as unknown as RLSTx;
  return { tx, calls, execMock };
}

describe('withTenantRLS (ALS-driven binding)', () => {
  it('binds the current ALS context on the pinned tx and routes the slot to it', async () => {
    ctxState.current = { userId: 'u9', orgId: 'org-Z', isPlatformAdmin: true };
    const fake = makeFakeTx();
    live.tx = fake.tx;

    let sawSlot: unknown = null;
    const res = await withTenantRLS(async () => {
      sawSlot = dbContext.getActiveRLSTx();
      return 42;
    });

    expect(res).toBe(42);
    expect(fake.execMock).toHaveBeenCalledTimes(1);
    const sql = String(fake.execMock.mock.calls[0][0]);
    expect(sql).toContain("set_config('app.current_user_id', 'u9', true)");
    expect(sql).toContain("'org-Z'");
    expect(sql).toContain("set_config('app.is_platform_admin', '1', true)");
    // Slot wrapper (2026-09-21 P2028 fix): the pinned value is {tx, lockMap};
    // it must expose the SAME tx so tenantDb routes model ops onto the GUC'd conn.
    expect(sawSlot).not.toBeNull();
    expect((sawSlot as { tx: unknown }).tx).toBe(fake.tx);
  });

  it('fails closed when no verified ALS context is active', async () => {
    ctxState.current = null;
    await expect(withTenantRLS(() => 'x')).rejects.toThrow(/verified tenant context/);

    ctxState.current = { userId: '', orgId: 'org-Q', isPlatformAdmin: false };
    await expect(withTenantRLS(() => 'x')).rejects.toThrow(/verified tenant context/);
  });

  it('resets the slot after the transaction (no leak across operations)', async () => {
    ctxState.current = { userId: 'u9', orgId: 'org-Z', isPlatformAdmin: false };
    const fake = makeFakeTx();
    live.tx = fake.tx;
    await withTenantRLS(async () => 'ok');
    expect(dbContext.getActiveRLSTx()).toBeNull();
  });
});

describe('withExplicitRLS', () => {
  it('binds explicit platform context (flag + platform_org_id) and propagates result', async () => {
    const fake = makeFakeTx();
    live.tx = fake.tx;
    const res = await withExplicitRLS(
      { userId: 'admin1', orgId: 'platform-org', isPlatformAdmin: true, platformOrgId: 'platform-org' },
      async () => 'done'
    );
    expect(res).toBe('done');
    const sql = String(fake.execMock.mock.calls[0][0]);
    expect(sql).toContain("set_config('app.is_platform_admin', '1', true)");
    expect(sql).toContain("set_config('app.platform_org_id', 'platform-org', true)");
  });

  it('omits the platform_org_id GUC for ordinary tenant contexts', async () => {
    const fake = makeFakeTx();
    live.tx = fake.tx;
    await withExplicitRLS({ userId: 'u1', orgId: 'org-C', isPlatformAdmin: false }, () => null);
    const sql = String(fake.execMock.mock.calls[0][0]);
    expect(sql).not.toContain('app.platform_org_id');
  });

  it('rejects missing orgId fail-closed (no unscoped GUC binding)', async () => {
    await expect(
      withExplicitRLS({ userId: 'u1', orgId: '', isPlatformAdmin: false }, () => null)
    ).rejects.toThrow(/orgId/);
  });

  it('propagates operation failures unchanged (GUC failure masks nothing)', async () => {
    const fake = makeFakeTx();
    live.tx = fake.tx;
    await expect(
      withExplicitRLS({ userId: 'u1', orgId: 'org-B', isPlatformAdmin: false }, () => {
        throw new Error('db down');
      })
    ).rejects.toThrow('db down');
  });
});

describe('runWithRLS (explicit client primitive)', () => {
  it('sets GUCs on the interactive-tx connection before running the operation', async () => {
    const fake = makeFakeTx();
    const client = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(fake.tx) } as unknown as PrismaClient;

    let opReceived: unknown = null;
    await runWithRLS(client, { userId: 'u1', orgId: 'org-A', isPlatformAdmin: false }, (t) => {
      opReceived = t;
      return 'ok';
    });

    expect(fake.calls[0]).toContain("set_config('app.current_user_id'");
    expect(fake.calls[0]).toContain("'org-A'");
    expect(fake.calls[0]).toContain("set_config('app.is_platform_admin', '0', true)");
    expect(opReceived).toBe(fake.tx);
  });

  it('propagates operation result and GUC-set failures', async () => {
    const ok = makeFakeTx();
    const clientOk = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(ok.tx) } as unknown as PrismaClient;
    const res = await runWithRLS(clientOk, { userId: 'u1', orgId: 'org-B', isPlatformAdmin: true }, () => 7);
    expect(res).toBe(7);

    const failing = makeFakeTx();
    failing.execMock.mockRejectedValueOnce(new Error('db down'));
    const clientFail = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(failing.tx) } as unknown as PrismaClient;
    await expect(
      runWithRLS(clientFail, { userId: 'u1', orgId: 'org-B', isPlatformAdmin: false }, () => 7)
    ).rejects.toThrow('db down');
  });

  it('rejects missing orgId fail-closed', async () => {
    const { tx } = makeFakeTx();
    const client = { $transaction: (fn: (t: unknown) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
    await expect(
      runWithRLS(client, { userId: 'u1', orgId: '', isPlatformAdmin: false }, () => null as unknown as never)
    ).rejects.toThrow(/orgId/);
  });
});

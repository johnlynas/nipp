import { describe, it, expect, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { runWithRLS, type RLSClient, type RLSTx } from '@/lib/rls-transaction';

/**
 * Fake prisma-like client: verifies set_config runs on the SAME interactive
 * transaction connection as the operation, before it, using the GUC helper.
 */
function makeFakeClient() {
  const calls: string[] = [];
  const execMock = vi.fn(async (sql: string) => {
    calls.push(sql);
  });
  const tx = { $executeRawUnsafe: execMock } as unknown as RLSTx;
  const client = {
    $transaction: vi.fn((fn: (t: RLSTx) => Promise<unknown>) => fn(tx)),
  } as unknown as RLSClient;
  return { client, tx, calls, execMock };
}

describe('runWithRLS', () => {
  it('sets GUCs on the interactive-tx connection before running the operation', async () => {
    const { client, tx, calls } = makeFakeClient();
    let opReceived: RLSTx | null = null;
    await runWithRLS(client, { userId: 'u1', orgId: 'org-A', isPlatformAdmin: false }, (t) => {
      opReceived = t;
      return 'ok';
    });
    // GUC setting happened first, on the same connection the op ran on
    expect(calls[0]).toContain("set_config('app.current_user_id'");
    expect(calls[0]).toContain("'org-A'");
    expect(calls[0]).toContain("set_config('app.is_platform_admin', '0', true)");
    expect(opReceived).toBe(tx);
  });

  it('propagates operation result and does not mask GUC failures', async () => {
    const ok = makeFakeClient();
    const res = await runWithRLS(ok.client, { userId: 'u1', orgId: 'org-B', isPlatformAdmin: true }, (t) =>
      Promise.resolve(7)
    );
    expect(res).toBe(7);

    const failing = makeFakeClient();
    failing.execMock.mockRejectedValueOnce(new Error('db down'));
    await expect(
      runWithRLS(failing.client, { userId: 'u1', orgId: 'org-B', isPlatformAdmin: false }, (t) =>
        Promise.resolve(7)
      )
    ).rejects.toThrow('db down');
  });

  it('rejects invalid context fail-closed (no empty user/org)', async () => {
    const { client } = makeFakeClient();
    await expect(
      runWithRLS(client, { userId: '', orgId: 'org', isPlatformAdmin: false }, (t) => null)
    ).rejects.toThrow(/userId/);
    await expect(
      runWithRLS(client, { userId: 'u1', orgId: '', isPlatformAdmin: false }, (t) => null)
    ).rejects.toThrow(/orgId/);
  });
});

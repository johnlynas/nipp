/**
 * RLS plan Phase 1D — verified tenant context (userId + isPlatformAdmin).
 */
import { describe, it, expect } from 'vitest';
import {
  runWithTenant,
  runWithTenantContext,
  getCurrentOrgId,
  getCurrentUserId,
  getRLSContext,
} from '@/lib/tenant-context';

describe('runWithTenant (legacy, org-only)', () => {
  it('still sets orgId and leaves RLS context null (fail-closed until full ctx)', () => {
    const r = runWithTenant('org-legacy', () => ({
      org: getCurrentOrgId(),
      user: getCurrentUserId(),
      rls: getRLSContext(),
    }));
    expect(r.org).toBe('org-legacy');
    expect(r.user).toBeNull();
    expect(r.rls).toBeNull();
  });
});

describe('runWithTenantContext (verified RLS context)', () => {
  it('propagates userId, orgId and platform flag', () => {
    const r = runWithTenantContext(
      { userId: 'u-1', orgId: 'org-A', isPlatformAdmin: true },
      () => ({ org: getCurrentOrgId(), user: getCurrentUserId(), rls: getRLSContext() })
    );
    expect(r.org).toBe('org-A');
    expect(r.user).toBe('u-1');
    expect(r.rls).toEqual({ userId: 'u-1', orgId: 'org-A', isPlatformAdmin: true });
  });

  it('defaults isPlatformAdmin to false', () => {
    const rls = runWithTenantContext({ userId: 'u-2', orgId: 'org-B' }, () => getRLSContext());
    expect(rls).toEqual({ userId: 'u-2', orgId: 'org-B', isPlatformAdmin: false });
  });

  it('does not leak outside the callback (async-safe)', async () => {
    await runWithTenantContext({ userId: 'u-3', orgId: 'org-C' }, async () => {
      expect(getRLSContext()?.userId).toBe('u-3');
    });
    expect(getRLSContext()).toBeNull();
  });

  it('fail-closed on missing required fields', () => {
    // orgId intentionally missing: allowed by the type only in platform mode,
    // so runtime fail-closed still throws (no @ts-expect-error — input is typed).
    expect(() => runWithTenantContext({ userId: 'u' }, () => null)).toThrow(/orgId/);
    expect(() =>
      runWithTenantContext({ userId: '', orgId: 'o' } as { userId: string; orgId: string }, () => null)
    ).toThrow(/userId/);
  });

  it('inner context shadows outer', () => {
    const r = runWithTenantContext({ userId: 'outer', orgId: 'org-A' }, () => {
      return runWithTenantContext({ userId: 'inner', orgId: 'org-B' }, () => {
        return getRLSContext()!;
      });
    });
    expect(r).toEqual({ userId: 'inner', orgId: 'org-B', isPlatformAdmin: false });
    // outer restored after inner returns
    const r2 = runWithTenantContext({ userId: 'outer', orgId: 'org-A' }, () => getRLSContext()!);
    expect(r2.userId).toBe('outer');
  });
});

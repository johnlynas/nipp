/**
 * Application-layer isolation tests: tenant-context (AsyncLocalStorage)
 *
 * Tests that runWithTenant / getCurrentOrgId correctly propagate and isolate
 * the organization ID across async boundaries.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runWithTenant, getCurrentOrgId, getTenantContext, createStorage } from '@/lib/tenant-context';

describe('Tenant Context — runWithTenant', () => {
  it('sets and propagates orgId within the callback', () => {
    const orgA = 'org-a-test-id';

    const result = runWithTenant(orgA, () => {
      return getCurrentOrgId();
    });

    expect(result).toBe(orgA);
  });

  it('returns null outside of runWithTenant', () => {
    expect(getCurrentOrgId()).toBeNull();
  });

  it('nested runWithTenant uses innermost context', () => {
    const orgA = 'org-a-test-id';
    const orgB = 'org-b-test-id';

    const outerResult = runWithTenant(orgA, () => {
      // Outer sees orgA
      const outer = getCurrentOrgId();

      // Inner overrides to orgB
      const inner = runWithTenant(orgB, () => getCurrentOrgId());

      // Back to outer — should still be orgA
      const backToOuter = getCurrentOrgId();

      return { outer, inner, backToOuter };
    });

    expect(outerResult).toEqual({
      outer: orgA,
      inner: orgB,
      backToOuter: orgA,
    });
  });

  it('context does not leak across async boundaries', async () => {
    const orgA = 'org-a-test-id';
    const orgB = 'org-b-test-id';

    let outerResult: string | null = null;
    let innerResult: string | null = null;

    await runWithTenant(orgA, async () => {
      // Start an async operation that captures the context
      const innerPromise = new Promise<string | null>((resolve) => {
        // Switch context before awaiting
        innerResult = runWithTenant(orgB, () => getCurrentOrgId());
        resolve(innerResult);
      });

      // Wait for the inner promise to complete
      await innerPromise;

      // Outer context should still be orgA
      outerResult = getCurrentOrgId();
    });

    expect(innerResult).toBe(orgB);
    expect(outerResult).toBe(orgA);
  });

  it('context does not leak across parallel async operations', async () => {
    const orgA = 'org-a-test-id';
    const orgB = 'org-b-test-id';

    let resultA: string | null = null;
    let resultB: string | null = null;

    await Promise.all([
      runWithTenant(orgA, async () => {
        // Simulate some async work
        await new Promise((r) => setTimeout(r, 10));
        resultA = getCurrentOrgId();
      }),
      runWithTenant(orgB, async () => {
        await new Promise((r) => setTimeout(r, 5));
        resultB = getCurrentOrgId();
      }),
    ]);

    expect(resultA).toBe(orgA);
    expect(resultB).toBe(orgB);
  });

  it('getTenantContext returns the full store', () => {
    const orgA = 'org-a-test-id';

    const result = runWithTenant(orgA, () => {
      return getTenantContext();
    });

    expect(result).toEqual({ orgId: orgA });
  });

  it('getTenantContext returns null outside context', () => {
    expect(getTenantContext()).toBeNull();
  });

  it('createStorage creates independent storage instances', () => {
    const storage1 = createStorage<{ value: string }>();
    const storage2 = createStorage<{ value: string }>();

    let val1: { value: string } | undefined;
    let val2: { value: string } | undefined;

    storage1.run({ value: 'from-storage-1' }, () => {
      val1 = storage1.getStore();
      // storage2 should be independent
      val2 = storage2.getStore();
    });

    expect(val1).toEqual({ value: 'from-storage-1' });
    expect(val2).toBeUndefined();
  });

  it('runWithTenant returns the callback result', () => {
    const result = runWithTenant('org-x', () => {
      return 42;
    });

    expect(result).toBe(42);
  });

  it('runWithTenant handles async callbacks', async () => {
    const result = await runWithTenant('org-x', async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getCurrentOrgId();
    });

    expect(result).toBe('org-x');
  });
});

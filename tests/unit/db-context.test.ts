import { describe, it, expect } from 'vitest';
import { wrapWithActiveRLSTx, getActiveRLSTx, makeRLSTxSlot, runWithRLSTxLock } from '@/lib/db-context';

describe('wrapWithActiveRLSTx', () => {
  it('returns a real Promise even when op returns synchronously (2026-09-21 fix)', async () => {
    const tx = {};
    let seenInOp: unknown;
    const res = wrapWithActiveRLSTx(tx, () => {
      seenInOp = getActiveRLSTx();
      return 'sync-value'; // no Promise — mirrors sync route closures that used to crash `.then`
    });
    // Must be Thenable before the fix this would have returned the raw string.
    expect(typeof res.then).toBe('function');
    await expect(Promise.resolve(res)).resolves.toBe('sync-value');
    expect(seenInOp).toBe(tx);
  });

  it('still propagates async ops and settles rejections normally', async () => {
    const tx = {};
    const res = wrapWithActiveRLSTx(tx, async () => getActiveRLSTx());
    await expect(res).resolves.toBe(tx);

    await expect(wrapWithActiveRLSTx(tx, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
  });

  it('restores surrounding context after op completes (no tx leak)', async () => {
    const outer = {};
    await wrapWithActiveRLSTx(outer, async () => {
      expect(getActiveRLSTx()).toBe(outer);
    });
    expect(getActiveRLSTx()).toBeNull();
  });
});

describe('runWithRLSTxLock', () => {
  it('never executes two ops concurrently on the same pinned tx', async () => {
    const slot = makeRLSTxSlot({ id: 'tx-1' });
    let running = 0;
    let maxRunning = 0;
    const op = () => new Promise<void>((r) => setTimeout(r, 5)).then(() => {
      running++; maxRunning = Math.max(maxRunning, running);
      return new Promise<void>((r2) => setTimeout(() => { running--; r2(); }, 5));
    });
    await Promise.all([runWithRLSTxLock(slot, op), runWithRLSTxLock(slot, op)]);
    expect(maxRunning).toBe(1); // true P2028 race would be 2+ here
  });

  it('keeps independent slots parallel (no cross-tx coupling)', async () => {
    const a = makeRLSTxSlot({ id: 'tx-a' });
    const b = makeRLSTxSlot({ id: 'tx-b' });
    let running = 0;
    let maxConcurrent = 0;
    const op = () => new Promise<void>((r) => setTimeout(r, 10)).then(() => {
      running++; maxConcurrent = Math.max(maxConcurrent, running);
      return new Promise<void>((r2) => setTimeout(() => { running--; r2(); }, 10));
    });
    await Promise.all([runWithRLSTxLock(a, op), runWithRLSTxLock(b, op)]);
    expect(maxConcurrent).toBe(2);
  });
});

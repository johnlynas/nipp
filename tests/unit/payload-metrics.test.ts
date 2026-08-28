/**
 * Unit tests for lib/payload-metrics.ts — in-memory metric counters.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { incrementMetric, getMetricsSnapshot, resetMetrics } from '@/lib/payload-metrics';

// Every counter that the metrics module tracks, derived from a fresh snapshot
// so the test stays in sync if new counters are added.
function allCounterNames(): string[] {
  return Object.keys(getMetricsSnapshot());
}

describe('payload-metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe('getMetricsSnapshot', () => {
    it('starts with all counters at zero after reset', () => {
      const snapshot = getMetricsSnapshot();

      // Sanity: the expected well-known counters exist.
      expect(snapshot.encryptedRequestCount).toBe(0);
      expect(snapshot.decryptionFailures).toBe(0);
      expect(snapshot.keyIssuanceCount).toBe(0);
      expect(snapshot.replayCacheUnavailable).toBe(0);
      expect(snapshot.responseEncryptionFailures).toBe(0);

      // Every counter must be a number and start at zero.
      for (const name of allCounterNames()) {
        const value = snapshot[name as keyof typeof snapshot];
        expect(typeof value).toBe('number');
        expect(value).toBe(0);
      }
    });

    it('returns a copy, not the internal counter object', () => {
      incrementMetric('replayDetections');

      const snapshot = getMetricsSnapshot();
      // Mutating the snapshot must not affect future snapshots.
      snapshot.replayDetections = 999;

      const next = getMetricsSnapshot();
      expect(next.replayDetections).toBe(1);
    });
  });

  describe('incrementMetric', () => {
    it('increments a single counter by one', () => {
      incrementMetric('decryptionFailures');

      expect(getMetricsSnapshot().decryptionFailures).toBe(1);
      // Other counters are unaffected.
      expect(getMetricsSnapshot().unknownKeyIds).toBe(0);
    });

    it('increments the same counter multiple times', () => {
      incrementMetric('staleTimestamps');
      incrementMetric('staleTimestamps');
      incrementMetric('staleTimestamps');

      expect(getMetricsSnapshot().staleTimestamps).toBe(3);
    });

    it('tracks unrelated counters independently', () => {
      incrementMetric('encryptedRequestCount');
      incrementMetric('encryptedResponseCount');
      incrementMetric('replayDetections');
      incrementMetric('keyIssuanceCount');
      incrementMetric('keyRateLimited');
      incrementMetric('payloadTooLarge');
      incrementMetric('plaintextPermissive');

      const snapshot = getMetricsSnapshot();
      expect(snapshot.encryptedRequestCount).toBe(1);
      expect(snapshot.encryptedResponseCount).toBe(1);
      expect(snapshot.replayDetections).toBe(1);
      expect(snapshot.keyIssuanceCount).toBe(1);
      expect(snapshot.keyRateLimited).toBe(1);
      expect(snapshot.payloadTooLarge).toBe(1);
      expect(snapshot.plaintextPermissive).toBe(1);
      expect(snapshot.decryptionFailures).toBe(0);
    });

    it('increments every known counter at least once', () => {
      for (const name of allCounterNames()) {
        incrementMetric(name as Parameters<typeof incrementMetric>[0]);
      }

      const snapshot = getMetricsSnapshot();
      for (const name of allCounterNames()) {
        expect(snapshot[name as keyof typeof snapshot]).toBe(1);
      }
    });
  });

  describe('resetMetrics', () => {
    it('zeros all counters that were previously incremented', () => {
      // Bump every counter.
      for (const name of allCounterNames()) {
        incrementMetric(name as Parameters<typeof incrementMetric>[0]);
      }
      expect(
        getMetricsSnapshot().encryptedRequestCount,
      ).toBe(1);

      resetMetrics();

      const snapshot = getMetricsSnapshot();
      for (const name of allCounterNames()) {
        expect(snapshot[name as keyof typeof snapshot]).toBe(0);
      }
    });

    it('has no effect when there is nothing to reset', () => {
      resetMetrics();
      expect(getMetricsSnapshot().replayDetections).toBe(0);
    });
  });
});

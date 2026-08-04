/**
 * Payload encryption metrics collector.
 *
 * In-memory counters for observability of the payload encryption system.
 * These are process-local counters — in multi-instance deployments, each
 * instance tracks its own metrics. A centralized metrics backend (Prometheus,
 * Datadog, etc.) should be wired in for production dashboards.
 */

// ---------------------------------------------------------------------------
// Metric counters
// ---------------------------------------------------------------------------

interface MetricCounter {
  /** Total number of encrypted requests received */
  encryptedRequestCount: number;
  /** Total number of encrypted responses produced */
  encryptedResponseCount: number;
  /** Total decryption failures (tamper, wrong key, AAD mismatch) */
  decryptionFailures: number;
  /** Total unknown key ID lookups */
  unknownKeyIds: number;
  /** Total expired key lookups */
  expiredKeys: number;
  /** Total replay detections (duplicate nonces) */
  replayDetections: number;
  /** Total stale timestamp rejections */
  staleTimestamps: number;
  /** Total payload-too-large rejections */
  payloadTooLarge: number;
  /** Total replay-cache-unavailable errors (fail-closed) */
  replayCacheUnavailable: number;
  /** Total plaintext PII requests accepted in permissive mode */
  plaintextPermissive: number;
  /** Total payload key issuance events */
  keyIssuanceCount: number;
  /** Total rate-limited payload key requests */
  keyRateLimited: number;
  /** Total response encryption failures */
  responseEncryptionFailures: number;
}

const counters: MetricCounter = {
  encryptedRequestCount: 0,
  encryptedResponseCount: 0,
  decryptionFailures: 0,
  unknownKeyIds: 0,
  expiredKeys: 0,
  replayDetections: 0,
  staleTimestamps: 0,
  payloadTooLarge: 0,
  replayCacheUnavailable: 0,
  plaintextPermissive: 0,
  keyIssuanceCount: 0,
  keyRateLimited: 0,
  responseEncryptionFailures: 0,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Increment a metric counter by name. */
export function incrementMetric(name: keyof MetricCounter): void {
  (counters[name] as number)++;
}

/** Get a snapshot of all current metric values. */
export function getMetricsSnapshot(): MetricCounter {
  return { ...counters };
}

/** Reset all counters to zero (useful for tests). */
export function resetMetrics(): void {
  Object.keys(counters).forEach((key) => {
    (counters[key as keyof MetricCounter] as number) = 0;
  });
}

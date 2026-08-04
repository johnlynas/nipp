/**
 * Redis-backed replay cache for multi-instance deployments.
 *
 * Stores request nonces in Redis to prevent replay attacks across all instances.
 * Includes health checks and graceful degradation for when Redis is unavailable.
 *
 * Usage:
 *   import { RedisReplayCache } from '@/lib/replay-cache-redis';
 *   // The middleware uses this automatically when PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis
 */

import { redisSet, redisDel, redisPing, getRedis, redisSetWithNx } from './redis';
import { env } from './env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplayCache {
  /** Check if a nonce has been seen before. Returns true if replay detected. */
  isReplay(sessionId: string, nonce: string): Promise<boolean>;

  /** Record a nonce as seen. Returns true if successfully recorded. */
  record(sessionId: string, nonce: string, ttlSeconds: number): Promise<boolean>;

  /** Check if the cache backend is healthy. */
  healthCheck(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Redis replay cache implementation
// ---------------------------------------------------------------------------

/** Prefix for replay nonces in Redis. */
const REPLAY_PREFIX = 'replay:';

/** Build a Redis key for a replay nonce: replay:{sessionId}:{nonce} */
function redisKey(sessionId: string, nonce: string): string {
  return `${REPLAY_PREFIX}${sessionId}:${nonce}`;
}

/** Build a Redis key for the session nonce set: replay:sessions:{sessionId} */
function redisSessionKey(sessionId: string): string {
  return `${REPLAY_PREFIX}sessions:${sessionId}`;
}

export class RedisReplayCache implements ReplayCache {
  /**
   * Atomically check-and-record a nonce using SET NX.
   *
   * This combines the isReplay check and record into a single atomic Redis
   * operation, preventing concurrent replay bypass. If SET NX succeeds the
   * nonce is new; if it fails (key already exists) it is a replay.
   */
  async isReplay(sessionId: string, nonce: string): Promise<boolean> {
    const key = redisKey(sessionId, nonce);

    try {
      // SET NX with TTL — atomic check-and-set.
      // Returns 'OK' if the key was set (new nonce), 'nil' if it already existed (replay).
      const result = await redisSetWithNx(key, '1', env.PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS);
      return !result; // true = replay detected (SET NX failed)
    } catch {
      // Redis unavailable — fail open to avoid blocking legitimate requests.
      // The middleware's strict check will detect the unhealthy backend and return 503 in enforce mode.
      return false;
    }
  }

  /** Record a nonce as seen with TTL. */
  async record(sessionId: string, nonce: string, ttlSeconds: number): Promise<boolean> {
    const key = redisKey(sessionId, nonce);
    try {
      await redisSet(key, '1', ttlSeconds);

      // Track this nonce in the session set for potential cleanup.
      const sKey = redisSessionKey(sessionId);
      await redisSet(sKey, '1', ttlSeconds).catch(() => { /* ignore session set errors */ });

      return true;
    } catch {
      // Redis unavailable — caller should handle fallback
      return false;
    }
  }

  /** Check if Redis is available by sending a PING. */
  async healthCheck(): Promise<boolean> {
    return redisPing();
  }

  /** Delete a specific nonce (for testing or manual cleanup). */
  async delete(sessionId: string, nonce: string): Promise<void> {
    const key = redisKey(sessionId, nonce);
    await redisDel(key);

    // Also remove from the session set.
    const sKey = redisSessionKey(sessionId);
    try {
      await redisDel(sKey);
    } catch { /* ignore */ }
  }

  /** Delete all nonces for a session (for logout or session invalidation). */
  async deleteSession(sessionId: string): Promise<void> {
    const sKey = redisSessionKey(sessionId);

    // Scan for all nonce keys belonging to this session and delete them.
    try {
      const redisClient = getRedis();
      if (!redisClient) return;

      let cursor = '0';
      do {
        const result: [string, string[]] = await redisClient.scan(
          cursor,
          'MATCH', `${REPLAY_PREFIX}${sessionId}:*`,
        );
        cursor = result[0];
        const keys = result[1];
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      } while (cursor !== '0');

      // Also delete the session tracking set.
      await redisDel(sKey);
    } catch {
      // Scan/delete may fail if Redis is under stress — nonces will expire via TTL.
    }
  }
}

// ---------------------------------------------------------------------------
// Memory replay cache fallback (single-instance only)
// ---------------------------------------------------------------------------

interface MemoryEntry {
  timestamp: number;
}

export class MemoryReplayCache implements ReplayCache {
  private entries = new Map<string, MemoryEntry>();

  /** Maximum number of entries before evicting the oldest. */
  private static readonly MAX_ENTRIES = 100_000;

  /** TTL in milliseconds, read from environment (default 60s). */
  private readonly ttlMs: number;

  constructor() {
    this.ttlMs = env.PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS * 1000;
  }

  async isReplay(sessionId: string, nonce: string): Promise<boolean> {
    const key = `${sessionId}:${nonce}`;

    // Atomic check-and-set: if the key doesn't exist, add it and return false (not a replay).
    // If it already exists, return true (replay detected).
    if (this.entries.has(key)) {
      return true; // replay
    }

    this.entries.set(key, { timestamp: Date.now() });

    // Evict oldest entries if we exceed the size limit.
    if (this.entries.size > MemoryReplayCache.MAX_ENTRIES) {
      this._evictOldest();
    }

    // Schedule cleanup (lazy)
    if (!this._cleanupTimer) {
      this._startCleanup();
    }

    return false; // new nonce
  }

  async record(sessionId: string, nonce: string, _ttlSeconds: number): Promise<boolean> {
    const key = `${sessionId}:${nonce}`;
    this.entries.set(key, { timestamp: Date.now() });

    if (this.entries.size > MemoryReplayCache.MAX_ENTRIES) {
      this._evictOldest();
    }

    if (!this._cleanupTimer) {
      this._startCleanup();
    }

    return true;
  }

  async healthCheck(): Promise<boolean> {
    // Memory cache is always healthy (no external dependency)
    return true;
  }

  async delete(sessionId: string, nonce: string): Promise<void> {
    const key = `${sessionId}:${nonce}`;
    this.entries.delete(key);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }

  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Evict the oldest entries until we're under the size limit. */
  private _evictOldest(): void {
    // Sort by timestamp and remove the oldest half.
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].timestamp - b[1].timestamp,
    );
    const toRemove = Math.ceil(sorted.length / 2);
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(sorted[i][0]);
    }
  }

  private _startCleanup(): void {
    // Cleanup interval matches the TTL so stale entries are removed promptly.
    this._cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.entries.entries()) {
        if (now - entry.timestamp > this.ttlMs) {
          this.entries.delete(key);
        }
      }
    }, this.ttlMs);

    if (typeof this._cleanupTimer.unref === 'function') {
      this._cleanupTimer.unref();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a replay cache based on configuration.
 * Returns RedisReplayCache if PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis,
 * otherwise returns MemoryReplayCache.
 */
export function createReplayCache(): ReplayCache {
  const backend = env.PAYLOAD_ENCRYPTION_REPLAY_CACHE;

  if (backend === 'redis') {
    return new RedisReplayCache();
  }

  // Default to memory cache (single-instance only)
  return new MemoryReplayCache();
}

/**
 * Get the configured replay cache backend name.
 */
export function getReplayCacheBackend(): 'redis' | 'memory' {
  return env.PAYLOAD_ENCRYPTION_REPLAY_CACHE;
}

/**
 * Redis-backed payload key store for multi-instance deployments.
 *
 * Stores payload keys in Redis with TTL-based expiry so that:
 * - Keys issued by one instance are visible to all instances behind a load balancer.
 * - Revocation propagates across instances immediately.
 * - Expired keys are automatically evicted by Redis.
 *
 * Data model:
 *   pk:{keyId}          → JSON string (the key itself, TTL = expiresAt)
 *   pk:sess:{sessionId} → Redis Set of key IDs belonging to the session (no TTL)
 *   pk:zset:{sessionId} → Redis Sorted Set scored by expiresAt for O(log N) eviction
 *
 * This store implements the PayloadKeyStore interface and can be wired in via:
 *   import { RedisPayloadKeyStore } from '@/lib/payload-key-server-redis';
 *   setPayloadKeyStore(new RedisPayloadKeyStore());
 */

import { redisGet } from './redis';
import type { PayloadKey, PayloadKeyStore, PayloadKeyLookup } from './payload-key-server';

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------

/** Prefix for payload keys in Redis. */
const KEY_PREFIX = 'pk:';

/** Build a Redis key for a payload key: pk:{keyId} */
function redisKey(keyId: string): string {
  return `${KEY_PREFIX}${keyId}`;
}

/** Build a Redis key for the session membership set: pk:sess:{sessionId} */
function sessionSetKey(sessionId: string): string {
  return `pk:sess:${sessionId}`;
}

/** Build a Redis key for the eviction sorted set: pk:zset:{sessionId} */
function sessionZSetKey(sessionId: string): string {
  return `pk:zset:${sessionId}`;
}

// ---------------------------------------------------------------------------
// Lua scripts (atomic operations)
// ---------------------------------------------------------------------------

/**
 * Atomic put-with-eviction script.
 *
 * Ensures that the maxKeysPerSession check, eviction of the oldest key, and
 * insertion of the new key happen atomically — preventing race conditions
 * where multiple instances simultaneously decide to evict the same key.
 *
 * KEYS[1] = pk:{keyId}          (the key data)
 * KEYS[2] = pk:sess:{sessionId}  (session membership set)
 * KEYS[3] = pk:zset:{sessionId}  (eviction sorted set)
 * ARGV[1] = serialized key JSON
 * ARGV[2] = TTL in seconds for the key data
 * ARGV[3] = expiresAt (score for sorted set)
 * ARGV[4] = maxKeysPerSession limit
 */
const PUT_WITH_EVICTION_SCRIPT = `
  -- Add the new key to the session set and sorted set.
  redis.call('SADD', KEYS[2], ARGV[3])
  redis.call('ZADD', KEYS[3], tonumber(ARGV[3]), ARGV[3])

  -- Evict the oldest key if we exceed the limit.
  local count = redis.call('SCARD', KEYS[2])
  while count > tonumber(ARGV[4]) do
    -- Get the oldest key ID (lowest score = earliest expiry).
    local oldest = redis.call('ZRANGE', KEYS[3], 0, 0)
    if #oldest == 0 then break end
    local oldestKid = oldest[1]

    -- Delete the key data and its session membership.
    redis.call('DEL', 'pk:' .. oldestKid)
    redis.call('SREM', KEYS[2], oldestKid)
    redis.call('ZREMRANGEBYRANK', KEYS[3], 0, 0)

    count = redis.call('SCARD', KEYS[2])
  end

  -- Store the key data with TTL.
  redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))

  return 0
`;

/**
 * Atomic remove-key script.
 *
 * Removes a key from the session set, sorted set, and data store atomically.
 * Also cleans up empty sets/zsets to avoid orphaned keys.
 *
 * KEYS[1] = pk:{keyId}          (the key data)
 * KEYS[2] = pk:sess:{sessionId}  (session membership set)
 * KEYS[3] = pk:zset:{sessionId}  (eviction sorted set)
 * ARGV[1] = keyId (used as the score in the sorted set — must match what was stored)
 */
const REMOVE_KEY_SCRIPT = `
  -- Remove from session set and sorted set.
  redis.call('SREM', KEYS[2], ARGV[1])
  redis.call('ZREMRANGEBYSCORE', KEYS[3], ARGV[1], ARGV[1])

  -- Delete the key data.
  redis.call('DEL', KEYS[1])

  -- Clean up empty sets/zsets.
  if redis.call('SCARD', KEYS[2]) == 0 then
    redis.call('DEL', KEYS[2], KEYS[3])
  end

  return 0
`;

// ---------------------------------------------------------------------------
// Redis-backed store
// ---------------------------------------------------------------------------

export class RedisPayloadKeyStore implements PayloadKeyStore {
  /** Maximum number of active keys per session (enforces eviction). */
  private maxKeysPerSession: number;

  /** Cached Lua script references (loaded once per instance). */
  private putScriptSha: string | null = null;
  private removeKeyScriptSha: string | null = null;

  constructor(maxKeysPerSession = 10) {
    this.maxKeysPerSession = maxKeysPerSession;
  }

  /** Store a payload key in Redis with TTL-based expiry. */
  async put(key: PayloadKey): Promise<void> {
    const ttlSeconds = Math.max(1, key.expiresAt - Math.floor(Date.now() / 1000));
    const serialized = JSON.stringify(key);

    // Use atomic Lua script for put-with-eviction.
    await this._evalScript(
      'put',
      [redisKey(key.keyId), sessionSetKey(key.sessionId), sessionZSetKey(key.sessionId)],
      [serialized, String(ttlSeconds), key.keyId, String(this.maxKeysPerSession)],
    );
  }

  /** Retrieve a payload key by ID and session. Returns null if not found or expired. */
  async get(keyId: string, sessionId: string): Promise<PayloadKey | null> {
    const raw = await this._getRaw(keyId);
    if (!raw) return null;

    const key: PayloadKey = JSON.parse(raw);

    // Check session binding
    if (key.sessionId !== sessionId) return null;

    // Check expiry — Redis TTL handles this, but double-check
    if (Date.now() / 1000 > key.expiresAt) {
      await this._removeKey(keyId, sessionId);
      return null;
    }

    return key;
  }

  /** Lookup a key without deleting expired entries. Distinguishes unknown vs expired. */
  async lookup(keyId: string, sessionId: string): Promise<PayloadKeyLookup> {
    const raw = await this._getRaw(keyId);
    if (!raw) return { key: null, reason: 'unknown' };

    const key: PayloadKey = JSON.parse(raw);

    // Check session binding
    if (key.sessionId !== sessionId) return { key: null, reason: 'unknown' };

    // Check expiry
    if (Date.now() / 1000 > key.expiresAt) {
      return { key, reason: 'expired' };
    }

    return { key, reason: undefined };
  }

  /** Revoke all keys for a session. */
  async revokeForSession(sessionId: string): Promise<void> {
    // Get all key IDs for this session from the set.
    const client = await import('./redis').then((m) => m.getRedis());
    if (!client) return;

    const keyIds = await client.smembers(sessionSetKey(sessionId));

    // Delete each key's data and clean up the sets.
    for (const kid of keyIds) {
      await this._removeKey(kid, sessionId);
    }
  }

  /** Remove expired entries. Returns count removed (0 for Redis — TTL handles it). */
  async cleanup(): Promise<number> {
    // Redis handles TTL-based expiry automatically.
    return 0;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Get raw stored key from Redis. */
  private async _getRaw(keyId: string): Promise<string | null> {
    const result = await redisGet(redisKey(keyId));
    return typeof result === 'string' ? result : null;
  }

  /** Remove a single key and its session mappings. */
  private async _removeKey(keyId: string, sessionId: string): Promise<void> {
    await this._evalScript(
      'remove',
      [redisKey(keyId), sessionSetKey(sessionId), sessionZSetKey(sessionId)],
      [keyId], // keyId is used as the score in the sorted set
    );
  }

  /** Evaluate a Lua script, loading it first if needed. */
  private async _evalScript(
    name: 'put' | 'remove',
    keys: string[],
    args: string[],
  ): Promise<void> {
    const client = await import('./redis').then((m) => m.getRedis());
    if (!client) return;

    let sha: string | null = null;
    const script = name === 'put' ? PUT_WITH_EVICTION_SCRIPT : REMOVE_KEY_SCRIPT;

    if (name === 'put') {
      if (!this.putScriptSha) {
        try {
          this.putScriptSha = (await client.script('LOAD', script)) as string;
        } catch {
          // Script loading failed — fall through to EVAL below.
        }
      }
      sha = this.putScriptSha;
    } else {
      if (!this.removeKeyScriptSha) {
        try {
          this.removeKeyScriptSha = (await client.script('LOAD', script)) as string;
        } catch {
          // Script loading failed — fall through to EVAL below.
        }
      }
      sha = this.removeKeyScriptSha;
    }

    if (sha) {
      await client.evalsha(sha, keys.length, ...keys, ...args);
    } else {
      await client.eval(script, keys.length, ...keys, ...args);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/**
 * Create a Redis-backed payload key store.
 * @param maxKeysPerSession - Maximum active keys per session (default: 10)
 * @returns A new RedisPayloadKeyStore instance
 */
export function createRedisPayloadKeyStore(maxKeysPerSession = 10): RedisPayloadKeyStore {
  return new RedisPayloadKeyStore(maxKeysPerSession);
}

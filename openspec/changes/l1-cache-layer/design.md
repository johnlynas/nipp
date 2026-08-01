# Design: L1 In-Memory Cache Layer

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│              Next.js Node.js Runtime                │
│                                                     │
│  API Route / Resolver                               │
│       │                                             │
│       ▼                                             │
│  ┌──────────────┐    HIT     ┌─────────────────┐   │
│  │ L1: In-Mem   │──────────▶ │ Return cached    │   │
│  │ LRU Cache    │            │ value (<0.1ms)   │   │
│  └──────┬───────┘            └─────────────────┘   │
│         │ MISS                                      │
│         ▼                                           │
│  ┌──────────────┐    HIT     ┌─────────────────┐   │
│  │ L2: Redis    │──────────▶ │ Return value     │   │
│  │ (Distributed)│            │ + populate L1    │   │
│  └──────┬───────┘            └─────────────────┘   │
│         │ MISS                                      │
│         ▼                                           │
│  ┌──────────────┐                                  │
│  │ Caller       │────▶ DB query (Prisma)           │
│  │ Resolver     │                                  │
│  └──────────────┘                                  │
│       │                                             │
│       ▼ (write-through)                             │
│  ┌──────────────┐    ┌─────────────────┐           │
│  │ L1: In-Mem   │◀───│ L2: Redis       │           │
│  └──────────────┘    └─────────────────┘           │
│                                                     │
│  Pub/Sub Subscriber (cross-instance invalidation)   │
└─────────────────────────────────────────────────────┘
```

## Technical Decisions

### Decision 1: Use `lru-cache` library (not a plain Map)

**Context:** We need an LRU eviction policy, TTL support, and size calculation. A plain `Map` would require manual implementation of all three.

**Decision:** Use the well-maintained `lru-cache` npm package (v10+).

**Rationale:**
- Battle-tested, type-safe, actively maintained
- Built-in TTL with `ttl`, `ttlResolution`, and `allowStale` options
- Size calculation via `sizeCalculation` callback (byte-level accuracy)
- `maxEntrySize` protection against individual oversized entries
- No need to reinvent LRU eviction logic

**Alternatives considered:**
- Plain `Map` — rejected: no eviction, no TTL, manual management
- `quick-lru` — rejected: no TTL support, simpler but insufficient for our needs
- Custom implementation — rejected: unnecessary complexity and bug risk

### Decision 2: L1 TTL of 60 seconds (shorter than Redis's 5 minutes)

**Context:** L1 is instance-local and not shared across instances. A long TTL means stale data persists longer during invalidation windows.

**Decision:** Set L1 max TTL to 60 seconds, while Redis (L2) retains its existing 5-minute TTL.

**Rationale:**
- Short L1 TTL limits the stale data window to 60 seconds per instance
- Redis Pub/Sub invalidation handles explicit mutations (role changes, permission updates) immediately
- The 60-second TTL is a safety net for cases where Pub/Sub invalidation doesn't fire
- Redis still provides 5-minute consistency as the distributed source of truth

**Alternatives considered:**
- Match Redis TTL (5 min) — rejected: stale data window too long across instances
- No TTL, only explicit invalidation — rejected: memory leak risk if Pub/Sub fails

### Decision 3: Runtime detection to disable L1 on Edge

**Context:** Next.js App Router supports both Node.js and Edge runtimes. Edge runtimes don't support persistent in-memory state across requests.

**Decision:** Check `process.env.NEXT_RUNTIME !== 'edge'` before creating the L1 cache. On Edge, `lruCache` is `null` and all operations fall through to Redis directly.

**Rationale:**
- Edge runtime isolates state per request — an in-memory cache would only survive within a single request lifecycle
- No additional dependencies or complexity needed — just a runtime check at initialization
- The hybrid layer handles the `null` case transparently

**Alternatives considered:**
- Force all routes to Node.js runtime — rejected: too invasive, breaks existing Edge middleware
- Use a different caching mechanism on Edge — rejected: over-engineering; Redis-only is acceptable for Edge

### Decision 4: Write-through caching (L2 first, then L1)

**Context:** When data is written, both cache layers need to be updated. The order matters for consistency.

**Decision:** Write to Redis (L2) first, then populate L1. If L1 write fails, the data is still in Redis (source of truth).

**Rationale:**
- Redis is the distributed source of truth — it must always have the latest data
- L1 is a performance optimization — if it fails, Redis still serves correctly
- Write-through ensures both layers stay in sync (Pub/Sub handles cross-instance)

**Alternatives considered:**
- Write to L1 first — rejected: if Redis write fails, L1 has stale data that won't be corrected
- Write-behind (async) — rejected: adds complexity and risk of data loss on crash

### Decision 5: Cache stampede protection via single-flight deduplication

**Context:** When the L1 cache is cold (e.g., after a restart), many concurrent requests for the same key could all miss L1 and trigger simultaneous DB/Redis queries.

**Decision:** Use a `Map<string, Promise<T>>` to track in-flight resolution promises. When a cache miss occurs, check if a promise already exists for that key — if so, await it instead of firing a new query.

**Rationale:**
- Simple, no external dependencies needed
- The `Map` naturally cleans up as promises resolve/reject
- Works at the application level, independent of Redis or DB state

**Alternatives considered:**
- Redis distributed lock — rejected: adds network round-trip for stampede protection (defeats the purpose)
- Semaphore pattern — rejected: more complex, same effect as single-flight

### Decision 6: Redis Pub/Sub for cross-instance invalidation

**Context:** L1 is instance-local. When data changes, other instances' L1 caches become stale.

**Decision:** Publish invalidation events to a Redis channel (`cache:invalidations`) whenever data is mutated. All instances subscribe to this channel and evict the affected key from their L1 cache.

**Rationale:**
- Redis is already in use — no new infrastructure needed
- Pub/Sub is fire-and-forget (acceptable for cache invalidation)
- Simple channel-based model: one channel, JSON payloads with `{ key }`

**Alternatives considered:**
- Short L1 TTL only — rejected: doesn't handle explicit mutations (role changes) promptly
- Redis keyspace notifications — rejected: less reliable than Pub/Sub, not supported in all Redis configurations

## Data Flow

### Read Path (Permission Resolution Example)

1. **Request arrives** → API route calls `resolvePermissions(userId, orgId)`
2. **L1 check** → `lruCache.get(cacheKey)` — if hit, return immediately (<0.1ms)
3. **L2 check** → `redisGet(cacheKey)` — if hit, store in L1 and return (~5ms)
4. **DB fallback** → Call caller-provided resolver function (Prisma query, ~15–40ms)
5. **Write-through** → Store result in both L2 (Redis, 5min TTL) and L1 (60s TTL)
6. **Return** → Result to caller

### Write Path (Permission Mutation Example)

1. **Mutation occurs** → Role/permission updated in database
2. **L2 write** → `redisSet(cacheKey, value, 300)` — source of truth
3. **L1 write** → `lruCache.set(cacheKey, value)` — performance optimization
4. **Pub/Sub publish** → `redis.publish('cache:invalidations', JSON.stringify({ key }))`
5. **Other instances** → Receive Pub/Sub message, evict key from their L1 cache

### Cross-Instance Invalidation Flow

```
Instance A:  Mutation → redis.publish('cache:invalidations', { key })
Instance B:  redis.subscribe('cache:invalidations') → on message → lruCache.delete(key)
Instance C:  redis.subscribe('cache:invalidations') → on message → lruCache.delete(key)
```

## Component Specifications

### `lib/cache/lru.ts` — L1 Cache Singleton

**Purpose:** Create and manage the in-memory LRU cache instance.

**Key exports:**
```typescript
export function getLruCache(): LRUCache<string, string> | null
export function invalidate(key: string): void
export function clear(): void
export function getMetrics(): CacheMetrics
```

**Configuration:**
- `max`: 1000 entries (configurable via env `L1_CACHE_MAX_ENTRIES`)
- `ttl`: 60,000ms (configurable via env `L1_CACHE_TTL_MS`)
- `sizeCalculation`: `Buffer.byteLength(value)` for accurate memory tracking
- `maxEntrySize`: 10KB (reject entries larger than this)
- `allowStale`: false

**Runtime guard:** Returns `null` if `NEXT_RUNTIME === 'edge'`.

### `lib/cache/hybrid.ts` — Hybrid Read/Write Layer

**Purpose:** Orchestrate the L1→L2→DB read path and write-through.

**Key exports:**
```typescript
export async function cacheGet<T>(
  key: string,
  resolver: () => Promise<T>,
  options?: { ttlSeconds?: number }
): Promise<T | null>

export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<void>

export async function cacheDel(key: string): Promise<void>
```

**Behavior:**
- `cacheGet`: Check L1 → if miss, check L2 (Redis) → if miss, call `resolver()` → write-through to both layers
- `cacheSet`: Write to L2 (Redis) first, then L1
- `cacheDel`: Delete from both L1 and L2

### `lib/cache/stampede.ts` — Stampede Protection

**Purpose:** Deduplicate concurrent cache misses on the same key.

**Key exports:**
```typescript
export function getOrSet<T>(
  key: string,
  resolver: () => Promise<T>
): Promise<T>
```

**Behavior:** Uses a module-level `Map<string, Promise<T>>`. On first miss, stores the promise. Subsequent concurrent calls for the same key await the existing promise.

### `lib/cache/health.ts` — Cache Metrics

**Purpose:** Expose cache health metrics for monitoring.

**Key exports:**
```typescript
export function getCacheMetrics(): {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  l1Size: number;       // entry count
  l1MemoryBytes: number;
  l1HitRate: number;    // percentage
}
```

## Security Considerations

- Cache keys contain user IDs and org IDs — no sensitive data stored in cache values (only permission key strings)
- L1 memory is process-local — no cross-process leakage risk
- Pub/Sub invalidation messages are internal only (not exposed externally)
- Cache size limits prevent memory exhaustion attacks

## Performance Considerations

| Metric | Before (Redis Only) | After (L1 + L2) |
|--------|---------------------|-----------------|
| Read latency (hot key) | ~5–15ms (network) | <0.1ms (memory) |
| Read latency (cold key) | ~5–15ms (L2 hit) or ~20–50ms (DB) | ~5–15ms (L2 hit) or ~20–50ms (DB) |
| Redis load under peak | 100% of reads | 20–40% of reads (L1 absorbs hot keys) |
| Memory per instance | Negligible | ~5–20MB (1000 entries × avg 5KB) |
| Cache hit rate per instance | 100% (distributed) | 60–90% (varies by traffic pattern) |

## Implementation Notes

- The L1 cache is a **performance optimization**, not a correctness requirement. If Redis is down, the system still works (falls through to DB).
- All cache operations are **best-effort** — failures in L1 or Redis should never block the primary request flow.
- The `ENABLE_L1_CACHE` environment variable provides a kill switch for rapid rollback if issues arise.

## Caching Architecture Documentation

A standalone `CACHING_ARCHITECTURE.md` file will be created at the project root to document the complete caching strategy. This serves as the single source of truth for:

- **Layer overview**: ISR → L1 (in-memory) → Redis (L2) → PostgreSQL, with React Query on the client
- **Per-layer details**: TTLs, key formats, invalidation strategies, and failure modes
- **Data flow diagrams**: Read path, write path, cross-instance invalidation
- **Trade-offs and decisions**: Why each layer exists, when to bypass it, known limitations
- **Monitoring**: Metrics to track (hit rates, memory usage, Redis latency)

This document is intended for both developers and reviewers who need to understand the caching strategy without digging through code.

# Caching Architecture — Property NI Portal

This document describes the multi-layered caching strategy used by the Property NI Multi-Tenant Portal. The system combines five independent layers — from edge-level caching to client-side state management — each addressing a different part of the performance and consistency problem.

## Table of Contents

- [1. Next.js ISR (Edge Layer)](#1-nextjs-isr-edge-layer)
- [2. L1 In-Memory Cache (Instance-Local)](#2-l1-in-memory-cache-instance-local)
  - [Architecture](#architecture)
  - [Configuration](#configuration)
  - [Read Path](#read-path)
  - [Write & Invalidation](#write--invalidation)
  - [Stampede Protection](#stampede-protection)
- [3. L2 Redis Cache (Distributed)](#3-l2-redis-cache-distributed)
  - [Client Configuration](#client-configuration)
  - [Helper Functions](#helper-functions)
  - [Pub/Sub Invalidation](#pubsub-invalidation)
- [4. Hybrid Cache Layer (Orchestration)](#4-hybrid-cache-layer-orchestration)
  - [Read Path: L1 → L2 → Resolver](#read-path-l1--l2--resolver)
  - [Write Path: cacheSet](#write-path-cacheset)
  - [Delete Path: cacheDel](#delete-path-cachedel)
  - [Adaptive TTL Types](#adaptive-ttl-types)
- [5. Client-Side Caching (React Query + SSE)](#5-client-side-caching-react-query--sse)
  - [React Query Configuration](#react-query-configuration)
  - [SSE (Server-Sent Events)](#sse-server-sent-events)
- [6. Cache Warming (Startup)](#6-cache-warming-startup)
  - [What Gets Warmed](#what-gets-warmed)
  - [Search Result Aggregation Keys](#search-result-aggregation-keys)
- [7. Monitoring & Health](#7-monitoring--health)
  - [Cache Metrics Endpoint (Public)](#cache-metrics-endpoint-public)
  - [Admin Cache Metrics Endpoint](#admin-cache-metrics-endpoint)
  - [Health Check Integration](#health-check-integration)
- [8. Replay Cache (Payload Encryption)](#8-replay-cache-payload-encryption)
  - [Redis Backend](#redis-backend)
  - [Memory Backend](#memory-backend)
- [9. Trade-offs & Decisions](#9-trade-offs--decisions)
  - [Why L1 + L2?](#why-l1--l2)
  - [TTL Strategy Rationale](#ttl-strategy-rationale)
  - [What We Don't Cache and Why](#what-we-dont-cache-and-why)
- [10. Configuration Reference](#10-configuration-reference)

## Appendices

- [A. API Endpoints Reference](#appendix-a-api-endpoints-reference)
- [B. Cache Key Naming Conventions](#appendix-b-cache-key-naming-conventions)
- [C. Benchmark Results Summary](#appendix-c-benchmark-results-summary)
- [D. Cross-References](#appendix-d-cross-references)

---

## 1. Next.js ISR (Edge Layer)

### Purpose

Control HTTP caching headers at the framework level, preventing browser and CDN caches from storing authenticated responses.

### Configuration

Authenticated routes do not use Next.js `revalidate` exports for ISR. Instead, the middleware in `middleware.ts` sets cache-busting headers on every authenticated response:

| Header | Value | Purpose |
|--------|-------|---------|
| `Cache-Control` | `no-store, max-age=0` | Prevents all caching (browser, CDN, intermediate proxies) |
| `Surrogate-Control` | `no-store` | Vercel/CDN-specific cache bypass |
| `Pragma` | `no-cache` | HTTP/1.0 fallback for legacy proxies |

### Trade-offs

- **Pros:** Simple, framework-native, works at CDN edge when deployed on Vercel
- **Cons:** Not suitable for authenticated/user-specific data; coarse-grained (entire route, not individual keys)

---

## 2. L1 In-Memory Cache (Instance-Local)

### Architecture

The L1 cache is a high-performance, instance-local in-memory cache implemented using the `lru-cache` library (v12+). It provides sub-millisecond reads for hot data, eliminating network round-trips to Redis.

```
┌─────────────────────────────────────┐
│         Next.js Node Runtime        │
│                                     │
│  API Route / Resolver               │
│       │                             │
│       ▼                             │
│  ┌──────────────┐    HIT     ┌─────┐│
│  │ L1: In-Mem   │──────────▶ │Return││
│  │ LRU Cache    │            │Data ││
│  └──────┬───────┘            └─────┘│
│         │ MISS                      │
│         ▼                           │
│  ┌──────────────┐    HIT     ┌─────┐│
│  │ L2: Redis    │──────────▶ │Return││
│  └──────┬───────┘            └─────│
│         │ MISS                      │
│         ▼                           │
│  ┌──────────────┐                   │
│  │ Prisma (DB)  │                   │
│  └──────────────┘                   │
│       │                             │
│       ▼ (write-through)             │
│  ┌──────────────┐    ┌──────────┐   │
│  │ L1: In-Mem   │◀────L2: Redis│   │
│  └──────────────┘    └──────────┘   │
│                                     │
│  Pub/Sub Subscriber                 │
│  (cross-instance invalidation)      │
└─────────────────────────────────────┘
```

### Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| `L1_CACHE_MAX_ENTRIES` | 1000 | Maximum cache entries per instance |
| `L1_CACHE_TTL_MS` | 60,000 (60s) | Max TTL for cache entries in milliseconds |
| `ENABLE_L1_CACHE` | `true` | Feature flag to disable L1 entirely |

### Runtime Detection

- **Node.js runtime:** L1 cache is active (default for API routes)
- **Edge runtime:** L1 cache is disabled — it requires persistent state across requests, which the Edge runtime does not provide

The singleton uses `globalThis` to ensure a single instance across all Next.js route bundles. It is initialized lazily at call time so that Next.js 15 dev mode (which runs instrumentation on both Edge and Node runtimes) does not lock the cache to null.

### Read Path

1. **L1 Check** → `lruCache.get(key)` — if hit, return immediately (<0.1ms)
2. **L2 Check** → `redisGet(key)` — if hit, populate L1 and return (~5ms)
3. **DB Fallback** → Call resolver function (Prisma query, ~15–40ms)
4. **Write-Through** → Store result in both L2 (Redis, variable TTL) and L1 (60s TTL)

### Write & Invalidation

| Operation | Method | Description |
|-----------|--------|-------------|
| Set | `lruCache.set(key, value)` | Stores serialized JSON with TTL |
| Delete single key | `invalidate(key)` | Removes one entry from L1 |
| Clear all | `clear()` | Empties the entire cache |

### Stampede Protection

When the L1 cache is cold (e.g., after a restart), concurrent requests for the same key could all miss and trigger simultaneous DB queries. Stampede protection is implemented in `lib/cache/stampede.ts` using a `Map<string, Promise>` to deduplicate concurrent misses:

```
Request A (miss) → creates resolver promise → stored in inflight map
Request B (miss) → finds existing promise → awaits same result
Request C (miss) → finds existing promise → awaits same result
```

Only one resolver is executed per unique key. All waiting callers share its result. The in-flight entry is cleaned up via `.finally()` once the promise settles (resolved or rejected).

---

## 3. L2 Redis Cache (Distributed)

### Purpose

Distributed server-side cache for cross-instance consistency and persistence across restarts. Serves as the source of truth when L1 entries expire or instances are evicted.

### Client Configuration

- **Library:** `ioredis` with a singleton pattern
- **Retry strategy:** Maximum 10 retries, exponential backoff (capped at 3 seconds)
- **Max retries per request:** 3
- **Connection pooling:** Handled internally by ioredis

### Helper Functions

| Function | Description |
|----------|-------------|
| `redisGet(key)` | Get a value from Redis (returns null if not configured) |
| `redisSet(key, value, ttlSeconds)` | Set a value with TTL in seconds |
| `redisDel(key)` | Delete a key from Redis |
| `redisPing()` | Check if Redis is available (returns boolean) |
| `redisSetWithNx(key, value, ttlSeconds)` | Atomic set-if-not-exists with TTL (returns 'OK' or null) |
| `getRedis()` | Returns the singleton Redis client, or null if REDIS_URL is not configured |
| `forceRedisReconnect()` | Force reconnects the Redis client if in a bad state |

### Pub/Sub Invalidation

When data changes, the hybrid layer publishes an invalidation message to Redis channel `cache:invalidations`. All instances subscribe to this channel on Redis connection and evict the affected key from their L1 cache:

```
Instance A:  Mutation → redis.publish('cache:invalidations', { key })
Instance B:  subscriber.on('message') → lruCache.delete(key)
Instance C:  subscriber.on('message') → lruCache.delete(key)
```

The subscriber is started automatically when Redis transitions to the `ready` state. It uses a duplicated connection (`redis.duplicate()`) so it does not interfere with the main client's command queue.

---

## 4. Hybrid Cache Layer (Orchestration)

### Purpose

The hybrid layer in `lib/cache/hybrid.ts` orchestrates reads and writes across L1 (in-memory) and L2 (Redis), providing a unified interface with write-through semantics, adaptive TTLs, and stampede protection.

### Read Path: L1 → L2 → Resolver

```
Request → cacheGet(key, resolver, options)
    │
    ▼
L1 Check (lruCache.has(key))
    ├── HIT → Return cached value (<0.1ms)
    │
    └── MISS
        │
        ▼
Stampede Protection (getOrSet)
    │
    ▼
L2 Check (redisGet)
    ├── HIT → Populate L1, return value (~5ms)
    │
    └── MISS
        │
        ▼
Resolver (DB query)
    │
    ▼
Write-Through: L2 (Redis, adaptive TTL) + L1 (60s TTL)
    │
    ▼
Publish Invalidation (cache:invalidations channel)
```

### Write Path: cacheSet

```
Mutation → Update Database (caller's responsibility)
    │
    ▼
cacheSet(key, value, options)
    ├── Write to Redis (L2) — source of truth
    ├── Write to L1 (in-memory)
    └── Publish Invalidation (cache:invalidations channel)
```

### Delete Path: cacheDel

```
Mutation → Update Database (caller's responsibility)
    │
    ▼
cacheDel(key)
    ├── Delete from L1 (in-memory)
    ├── Delete from L2 (Redis)
    └── Publish Invalidation (cache:invalidations channel)
```

### Adaptive TTL Types

The hybrid layer supports four adaptive TTL types that control how long data persists in Redis (L2):

| Type | TTL | Use Case |
|------|-----|----------|
| `permanent` | Infinity (no TTL) | Entries only evicted on explicit delete; used for cache-warmed data (orgs, users, roles, permissions catalog) |
| `stable` | 3600s (1 hour) | Data that changes infrequently; org metadata, user profiles |
| `volatile` | 300s (5 minutes) | Data that changes frequently; permissions (can change with role updates) |
| `search` | 30s | Search results (relatively stable but benefit from frequent refresh) |

The TTL type is specified via the `ttlType` option in `cacheGet()` and `cacheSet()`. An explicit `ttlSeconds` parameter overrides the adaptive type.

---

## 5. Client-Side Caching (React Query + SSE)

### React Query Configuration

Client-side data caching is handled by TanStack Query v5. The following table shows the configuration per hook type:

| Data Type | staleTime | cacheTime (gcTime) |
|-----------|-----------|-------------------|
| User profile | 15 min | 1 hour |
| User settings | 2 min | 30 min |
| Organization details | 5 min | 30 min |
| Permissions | 30 min | 1 hour |
| Notifications list | Polling: 60s | Default (5 min) |

React Query is integrated with BetterAuth via the session callback, so authenticated data is available on initial page load without an extra API call.

### SSE (Server-Sent Events)

SSE is implemented in `app/api/notifications/stream/route.ts` for real-time notification delivery to the frontend.

| Aspect | Status |
|--------|--------|
| Development | Mock SSE stream — sends simulated notifications every 15 seconds |
| Production | Disabled (returns HTTP 501) — Redis Pub/Sub implementation planned |
| Channel | `notifications` (not yet connected to Redis) |
| Fallback | 60-second polling interval when SSE is unavailable |

**Trade-offs:** Real-time updates without polling; simple HTTP-based protocol. Not yet implemented in production — requires Redis Pub/Sub infrastructure.

---

## 6. Cache Warming (Startup)

### Purpose

Pre-populate the L1 cache on application startup to eliminate cold-start latency. Implemented in `lib/cache/warm.ts`.

### What Gets Warmed

On startup, the following data is loaded in parallel from the database:

| Data Type | Entity Keys | Search Aggregation Keys |
|-----------|-------------|------------------------|
| Organizations | `org:{id}` | `search:org:{name}`, `org:list:{name}` |
| Users | `user:{id}` | `search:user:{name}`, `search:user:{email}`, `user:list:{name}`, `user:list:{email}` |
| Roles (per org) | `role:{orgId}:{id}` | `search:role:{orgId}:{name}`, `role:list:{orgId}:{name}` |
| Permissions (catalog) | `perm:catalog:{key}` | `search:perm:{key}`, `perm:resource:{resource}` |

Each entity generates 2–4 cache entries (entity key + one or more search/list keys). For an organization with 10 roles, this produces approximately 40 cache entries.

### Search Result Aggregation Keys

In addition to entity keys (used by detail endpoints), cache warming also populates search result aggregation keys. These are pre-computed results for common search queries, so that the first user search hits L1 immediately without a database query.

### Entry Characteristics

All warmed entries are marked as "permanent" — they have no TTL and will only be evicted on explicit delete (e.g., when an org, user, role, or permission is removed). The `invalidateEntity()` function provides a targeted invalidation API for these cases.

---

## 7. Monitoring & Health

### Cache Metrics Endpoint (Public)

`GET /api/cache/metrics` — Returns detailed cache metrics. Requires Super Admin authentication.

| Field | Description |
|-------|-------------|
| `metrics.l1Hits` | Total L1 cache hits |
| `metrics.l1Misses` | Total L1 cache misses |
| `metrics.l2Hits` | Total L2 (Redis) hits |
| `metrics.l2Misses` | Total L2 (Redis) misses |
| `metrics.l1Size` | Current entry count in L1 |
| `metrics.l1MemoryBytes` | Estimated memory usage (entry count × 200 bytes average) |
| `metrics.l1HitRate` | L1 hit rate as percentage (0–100) |
| `metrics.redisConnected` | Redis connection state (boolean) |
| `l1Details.enabled` | Whether L1 cache is active |
| `l1Details.maxSize` | Maximum entries configured for L1 |
| `l1Details.maxEntrySize` | Maximum entry size in bytes (10,000) |

### Admin Cache Metrics Endpoint

`GET /api/admin/cache/metrics?action=reset` — Same metrics as the public endpoint, plus a reset capability.

- Without `?action=reset`: Returns metrics only
- With `?action=reset`: Resets all L1 and L2 counters to zero, then returns fresh metrics

The response includes computed L2 hit rate: `l2HitRate = (l2Hits / (l2Hits + l2Misses)) * 100`.

### Health Check Integration

The health endpoint (`GET /api/health`) includes a cache check that pings Redis with a 2-second timeout. Health state transitions (healthy → unhealthy, unhealthy → healthy) are logged via the `system-logs` module:

| Check | Status Values | Timeout |
|-------|--------------|---------|
| database | `healthy`, `unhealthy` | N/A (query-based) |
| cache | `healthy`, `unhealthy`, `skipped` | 2 seconds (ping) |
| connection-pool | `healthy`, `unhealthy` | N/A (PgBouncer query) |

When Redis is not configured, the cache check returns `skipped` and does not affect overall health status.

---

## 8. Replay Cache (Payload Encryption)

The replay cache prevents replay attacks on encrypted payloads by tracking request nonces. It is configured in `lib/replay-cache-redis.ts` and selected via the `PAYLOAD_ENCRYPTION_REPLAY_CACHE` environment variable.

### Redis Backend

When `PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis`, the system uses `RedisReplayCache`:

| Operation | Mechanism |
|-----------|-----------|
| `isReplay(sessionId, nonce)` | Atomic SET NX with TTL — returns true if the key already exists (replay detected) |
| `record(sessionId, nonce, ttl)` | SET key with TTL + tracks in session set for cleanup |
| `deleteSession(sessionId)` | SCAN for all keys matching `replay:{sessionId}:*` and delete them |
| `healthCheck()` | Redis PING |

The atomic SET NX operation prevents race conditions where concurrent requests with the same nonce both pass the replay check. If Redis is unavailable, the cache fails open (returns false, allowing the request through) to avoid blocking legitimate traffic.

### Memory Backend

When `PAYLOAD_ENCRYPTION_REPLAY_CACHE` is not set to `redis`, the system uses `MemoryReplayCache`:

| Feature | Detail |
|---------|--------|
| Storage | In-memory Map |
| Max entries | 100,000 (evicts oldest half when exceeded) |
| TTL | Read from `PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS` (default 60s) |
| Cleanup | Background interval that removes expired entries every TTL period |

The memory backend is suitable for single-instance deployments. It has no external dependency and always reports healthy, but nonces are lost on process restart.

---

## 9. Trade-offs & Decisions

### Why L1 + L2?

- **Performance:** Hot data (permissions checked on nearly every request) benefits from sub-millisecond L1 reads
- **Consistency:** Redis (L2) provides distributed consistency; Pub/Sub handles cross-instance sync
- **Resilience:** If Redis is down, the system falls through to DB (L1 is an optional optimization)

### Why 60s L1 TTL vs Variable Redis TTL?

L1 is instance-local, so stale data persists longer during invalidation windows without Pub/Sub. The 60-second max TTL limits the stale data window while still providing significant hit rates for hot keys. Redis uses adaptive TTLs (30s to infinity) based on data volatility — it is the source of truth, so longer TTLs ensure consistency across restarts.

### Why Not Cache Everything?

- **Write-heavy data:** Caching frequent writes causes cache thrashing and invalidation overhead
- **Large payloads:** Cache memory is limited; prioritize high-frequency, small-payload data (permissions, search results)
- **Real-time data:** Data that changes frequently (notifications) is better served by SSE or polling

### Why Not Skip L1 and Use Redis Only?

- **Network overhead:** Every cache miss requires a Redis round-trip (~5–15ms)
- **Redis load:** Under peak traffic, Redis becomes a bottleneck (connections, serialization, network)
- **Latency:** L1 provides <0.1ms reads vs ~5–15ms for Redis — 50–150x faster

---

## 10. Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_L1_CACHE` | `true` | Enable or disable the L1 in-memory cache entirely |
| `L1_CACHE_MAX_ENTRIES` | 1000 | Maximum number of entries in the L1 cache per instance |
| `L1_CACHE_TTL_MS` | 60000 (60s) | Maximum TTL for L1 cache entries in milliseconds |
| `REDIS_URL` | (none) | Redis connection string; if unset, Redis operations are skipped gracefully |
| `PAYLOAD_ENCRYPTION_REPLAY_CACHE` | `memory` | Replay cache backend: `redis` or `memory` (default) |
| `PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS` | 60 | TTL for replay nonces in seconds |

### Runtime Detection

| Runtime | L1 Cache |
|---------|----------|
| Node.js (default) | Active |
| Edge (`process.env.NEXT_RUNTIME === 'edge'`) | Disabled — stateless per request |

---

## Appendix A: API Endpoints Reference

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/api/health` | GET | No | Health check (database, Redis, PgBouncer) with state transition logging |
| `/api/cache/metrics` | GET | Super Admin | Cache metrics (L1/L2 hit rates, sizes, Redis status) + L1 details |
| `/api/admin/cache/metrics` | GET | Super Admin | Cache metrics + optional `?action=reset` to clear counters |

---

## Appendix B: Cache Key Naming Conventions

| Pattern | Example | Layer | Purpose |
|---------|---------|-------|---------|
| `org:{id}` | `org:cms0jvces0000p9ve61l5zx2g` | L1 + L2 | Organization entity cache (detail endpoints) |
| `user:{id}` | `user:cms0jvck7002hp9ve64bfhsi3` | L1 + L2 | User entity cache (detail endpoints) |
| `role:{orgId}:{id}` | `role:cms0jvces0000p9ve61l5zx2g:r1` | L1 + L2 | Role entity cache (detail endpoints) |
| `perm:catalog:{key}` | `perm:catalog:org:read` | L1 + L2 | Permission catalog entry (search aggregation) |
| `perm:{userId}:{orgId}` | `perm:u1:o1` | L1 + L2 | Resolved permissions for a user in an org (volatile TTL) |
| `search:org:{name}` | `search:org:platform` | L1 + L2 | Organization search result aggregation (volatile TTL) |
| `search:user:{name}` | `search:user:admin` | L1 + L2 | User search result aggregation by name (volatile TTL) |
| `search:user:{email}` | `search:user:admin@example.com` | L1 + L2 | User search result aggregation by email (volatile TTL) |
| `search:role:{orgId}:{name}` | `search:role:o1:admin` | L1 + L2 | Role search result aggregation (volatile TTL) |
| `search:perm:{key}` | `search:perm:org:read` | L1 + L2 | Permission search result aggregation (volatile TTL) |
| `org:list:{name}` | `org:list:platform` | L1 + L2 | Organization list entry for search (volatile TTL) |
| `user:list:{name}` | `user:list:admin` | L1 + L2 | User list entry for search (volatile TTL) |
| `role:list:{orgId}:{name}` | `role:list:o1:admin` | L1 + L2 | Role list entry for search (volatile TTL) |
| `perm:resource:{resource}` | `perm:resource:org` | L1 + L2 | Permission grouped by resource (volatile TTL) |
| `replay:{sessionId}:{nonce}` | `replay:s1:abc123` | Redis only | Replay nonce for payload encryption (TTL-based expiry) |
| `replay:sessions:{sessionId}` | `replay:sessions:s1` | Redis only | Session tracking set for replay nonce cleanup |
| Pub/Sub channel: `cache:invalidations` | — | Redis only | Cross-instance L1 invalidation messages |

---

## Appendix C: Benchmark Results Summary

The project includes a benchmark script (`scripts/cache-benchmark.ts`) that measures real-world performance across eight scenarios using actual database data. The script runs in both isolated and live-server modes.

### Benchmark Scenarios

| Scenario | Path Tested | Expected Latency (Local) |
|----------|-------------|-------------------------|
| A: DB Only | Prisma → PostgreSQL | 1–40ms (baseline) |
| B: Redis L2 | ioredis GET → JSON.parse | 1–5ms (network round-trip) |
| C: L1 Hit | LRUCache.get → JSON.parse | <0.1ms (memory access) |
| D: L1 Miss → L2 | Redis GET → populate L1 | 5–8ms (check + network) |
| E: Search Miss | Prisma search query | 1–30ms (search cost) |
| F: Search Hit | L1 lookup | <0.1ms (cached search) |
| G: Permission (L1 Hit) | cacheGet → L1 hit | <0.1ms (full flow, cached) |
| H: Full Hybrid (L2 Hit) | cacheGet → L1 miss, L2 hit | <0.1ms (full flow, warm) |

### Running the Profiler

```bash
# Basic usage (requires DATABASE_URL in .env)
npx tsx scripts/cache-benchmark.ts

# With L1 disabled (baseline only)
ENABLE_L1_CACHE=false npx tsx scripts/cache-benchmark.ts

# With L1 enabled (full hybrid)
ENABLE_L1_CACHE=true npx tsx scripts/cache-benchmark.ts
```

**Prerequisites:** `DATABASE_URL` configured in `.env` (required); `REDIS_URL` configured in `.env` (optional — L2 scenarios are skipped if Redis is unavailable).

**Safety features:** 5-minute timeout, warmup phase (10 iterations), graceful error handling for unavailable dependencies.

---

## Appendix D: Cross-References

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Overall system architecture, data flow, and component interactions |
| [SECURITY.md](./SECURITY.md) — Data Protection section | Payload encryption, replay cache integration with caching layer |
| [QUICK_START.md](./QUICK_START.md) | Getting started guide for developers |

---

*Last updated: 2026-08-26*
*Document owner: Engineering Team*

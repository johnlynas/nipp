# Caching Architecture Review & Upgrade History

This document tracks the evolution of caching in the Property NI Multi-Tenant Portal — from its original L2-only Redis design through the implementation of a full 5-layer caching strategy. It records issues identified, resolutions implemented, remaining open items, and the L1+L2 architecture that was built in response to these findings.

For detailed implementation specifics, see [CACHING_ARCHITECTURE.md](../../CACHING_ARCHITECTURE.md).

## Table of Contents

- [1. Architecture Evolution Timeline](#1-architecture-evolution-timeline)
  - [Phase 0: L2-Only (Original State)](#phase-0-l2-only-original-state)
  - [Phase 1: L1 In-Memory Cache](#phase-1-l1-in-memory-cache)
  - [Phase 2: Hybrid Cache Layer](#phase-2-hybrid-cache-layer)
  - [Phase 3: Cache Warming](#phase-3-cache-warming)
  - [Phase 4: Metrics & Monitoring](#phase-4-metrics--monitoring)
- [2. Issues: Resolved (7 items)](#2-issues-resolved-7-items)
  - [2.1 Issue #2: Cache Invalidation on Mutations](#21-issue-2-cache-invalidation-on-mutations)
  - [2.2 Issue #4: Redis Health Monitoring](#22-issue-4-redis-health-monitoring)
  - [2.3 Issue #5: Inconsistent Cache Key Patterns](#23-issue-5-inconsistent-cache-key-patterns)
  - [2.4 Issue #6: Deprecated gcTime Usage](#24-issue-6-deprecated-gctime-usage)
  - [2.5 Issue #7: No Cache Warming Strategy](#25-issue-7-no-cache-warming-strategy)
  - [2.6 Issue #8: Missing Redis Connection Pooling](#26-issue-8-missing-redis-connection-pooling)
  - [2.7 Issue #9: Silent Cache Corruption Handling](#27-issue-9-silent-cache-corruption-handling)
  - [2.8 Issue #10: No Cache Metrics](#28-issue-10-no-cache-metrics)
- [3. Issues: Still Open (2 items)](#3-issues-still-open-2-items)
  - [3.1 Issue #1: Redis URL Validation Bug](#31-issue-1-redis-url-validation-bug)
  - [3.2 Issue #3: Production SSE Disabled](#32-issue-3-production-sse-disabled)
- [4. L1+L2 Architecture (Now Implemented)](#4-l1l2-architecture-now-implemented)
  - [4.1 L1 In-Memory Cache](#41-l1-in-memory-cache)
  - [4.2 Hybrid Cache Layer](#42-hybrid-cache-layer)
  - [4.3 Pub/Sub Invalidation](#43-pubsub-invalidation)
  - [4.4 Cache Warming](#44-cache-warming)
  - [4.5 Replay Cache](#45-replay-cache)
- [5. Benchmark Script](#5-benchmark-script)
  - [Scenarios A through H](#scenarios-a-through-h)
  - [Running the Profiler](#running-the-profiler)
- [6. SSE Production Implementation Guide](#6-sse-production-implementation-guide)

## Appendices

- [A. Cache Key Naming Conventions](#appendix-a-cache-key-naming-conventions)
- [B. API Endpoints Reference](#appendix-b-api-endpoints-reference)
- [C. Code Examples](#appendix-c-code-examples)
- [D. Cross-References](#appendix-d-cross-references)

---

## 1. Architecture Evolution Timeline

### Phase 0: L2-Only (Original State)

The original caching architecture consisted of three layers:

| Layer | Technology | Purpose |
|-------|-----------|---------|
| ISR (edge) | Next.js `revalidate` exports | Cache API route responses at CDN edge |
| L2 (server) | Redis via `lib/redis.ts` | Permission caching for authorization checks |
| Client-side | React Query (TanStack Query) | Client data caching and optimistic updates |

Redis used a fixed 5-minute TTL with key format `perm:{userId}:{orgId}`. Cache invalidation after mutations was not wired up. SSE for real-time notifications returned 501 in production.

### Phase 1: L1 In-Memory Cache

An instance-local in-memory cache was added using `lru-cache` v12+. Implemented in `lib/cache/lru.ts`:

- **Singleton pattern:** Uses `globalThis` to ensure a single instance across all Next.js route bundles
- **Lazy initialization:** Re-checks runtime at call time so Next.js 15 dev mode (which runs instrumentation on both Edge and Node runtimes) does not lock the cache to null
- **Runtime detection:** Active on Node.js runtime; disabled on Edge (`process.env.NEXT_RUNTIME === 'edge'`)
- **Configuration:** `L1_CACHE_MAX_ENTRIES` (default 1000), `L1_CACHE_TTL_MS` (default 60s), `ENABLE_L1_CACHE` feature flag

### Phase 2: Hybrid Cache Layer

The hybrid layer in `lib/cache/hybrid.ts` orchestrates reads and writes across L1 (in-memory) and L2 (Redis):

- **Read path:** `cacheGet()` checks L1 first, falls back to Redis (L2), then calls a resolver function on miss
- **Write path:** `cacheSet()` writes through to both layers with Pub/Sub invalidation
- **Delete path:** `cacheDel()` removes from both layers and publishes an invalidation event
- **Adaptive TTL types:** `permanent` (no TTL), `stable` (1 hour), `volatile` (5 minutes), `search` (30 seconds)
- **Stampede protection:** Separate module (`lib/cache/stampede.ts`) deduplicates concurrent misses using a `Map<string, Promise>`

### Phase 3: Cache Warming

Cache warming pre-populates L1 on application startup via `lib/cache/warm.ts`:

- Loads organizations, users, roles (per org), and permissions from the database in parallel
- Each entity generates 2–4 cache entries (entity key + one or more search/list keys)
- Warmed entries use "permanent" TTL (no expiry, evicted only on explicit delete)
- Includes `invalidateEntity()` API for targeted cleanup when data changes

### Phase 4: Metrics & Monitoring

Dedicated metrics infrastructure was added:

- `lib/cache/metrics.ts` — singleton tracking L1/L2 hit/miss counters across all route bundles
- `lib/cache/health.ts` — exposes comprehensive cache metrics for monitoring dashboards
- `/api/cache/metrics` — public endpoint returning L1/L2 stats and Redis status (Super Admin auth)
- `/api/admin/cache/metrics?action=reset` — admin endpoint with optional counter reset

---

## 2. Issues: Resolved (7 items)

### 2.1 Issue #2: Cache Invalidation on Mutations

**Problem:** When permissions are updated (role changes, permission grants), the Redis cache was not invalidated automatically. The `invalidatePermissionCache` function existed but wasn't called after mutations.

**Impact:** Users could see stale permission data for up to 5 minutes, causing authorization issues.

**Resolution:** The hybrid layer's `cacheDel()` function now deletes from both L1 and L2, then publishes an invalidation event to the `cache:invalidations` Pub/Sub channel. All instances subscribe to this channel and evict the affected key from their L1 cache on receiving a message. The permissions resolver's `invalidatePermissionCache()` and `invalidateUserCache()` functions are called after mutations.

### 2.2 Issue #4: Redis Health Monitoring

**Problem:** The `getRedis()` function returned `null` when REDIS_URL was not set, but there was no health check or circuit breaker pattern. If Redis went down unexpectedly, there was no automatic reconnection strategy beyond basic retry and no fallback logging.

**Resolution:** The health endpoint (`GET /api/health`) now includes a Redis check that pings the server with a 2-second timeout. The `forceRedisReconnect()` function handles recovery from bad connection states (`close` or `end`). Health state transitions (healthy to unhealthy and back) are logged via the system-logs module.

### 2.3 Issue #5: Inconsistent Cache Key Patterns

**Problem:** Cache keys used inconsistent types — some used `as const` for type safety, others used `any`. No centralized naming convention existed.

**Resolution:** A standardized key naming convention was established (see Appendix A). All keys follow the pattern `{type}:{id}` or `{type}:{orgId}:{id}` with consistent prefixes. TypeScript types enforce key structure through the `CacheOptions` interface in the hybrid layer.

### 2.4 Issue #6: Deprecated gcTime Usage

**Problem:** React Query v5 renamed `gcTime` to `cacheTime`. The codebase still used the deprecated property.

**Resolution:** Updated all React Query configurations to use `cacheTime` instead of `gcTime`. The configuration table in CACHING_ARCHITECTURE.md reflects the current values.

### 2.5 Issue #7: No Cache Warming Strategy

**Problem:** When the application started or Redis was cleared, there was no mechanism to pre-populate frequently accessed caches. The first requests after a restart hit the database directly, causing cold-start latency spikes.

**Resolution:** `lib/cache/warm.ts` pre-populates L1 with organizations, users, roles (per organization), and permissions on startup. Each entity generates multiple cache entries including search result aggregation keys, so the first user search hits L1 immediately without a database query.

### 2.6 Issue #8: Missing Redis Connection Pooling

**Problem:** The ioredis instance lacked production-ready pool configuration — no explicit retry strategy or connection management.

**Resolution:** The Redis client now uses a retry strategy with maximum 10 retries, exponential backoff (capped at 3 seconds), and `maxRetriesPerRequest: 3`. Connection pooling is handled internally by ioredis. The client logs state changes (connect, ready, error, end) and maintains a `lastKnownState` variable to avoid duplicate log entries.

### 2.7 Issue #9: Silent Cache Corruption Handling

**Problem:** In the hybrid layer, corrupted cache values (invalid JSON from Redis) were silently ignored without logging, making debugging difficult.

**Resolution:** The hybrid layer catches JSON parse errors and falls through to the resolver (database query) without recording a miss. Cache corruption is now tracked via the metrics singleton, and health checks log state transitions when Redis connectivity changes.

### 2.8 Issue #10: No Cache Metrics

**Problem:** There was no visibility into Redis hit/miss ratios, cache memory usage, or query performance with and without caching.

**Resolution:** `lib/cache/metrics.ts` provides a singleton tracking L1 and L2 hit/miss counters. `lib/cache/health.ts` exposes comprehensive metrics including Redis connection state. Two API endpoints serve this data: `/api/cache/metrics` (public, Super Admin auth) and `/api/admin/cache/metrics?action=reset` (admin with counter reset).

---

## 3. Issues: Still Open (2 items)

### 3.1 Issue #1: Redis URL Validation Bug

**Location:** `lib/env.ts`, line 21

```typescript
REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional().default('redis://localhost:6379'),
```

**Problem:** The `.optional()` combined with a default value means Redis will always be attempted, even when not configured. This causes unnecessary connection attempts to `localhost:6379` in environments without Redis.

**Impact:** Connection errors logged on every request when Redis isn't available; potential performance degradation from failed connection attempts.

**Recommended fix:** Remove the default value so `REDIS_URL` is truly optional:

```typescript
REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional(),
```

When `undefined`, the `getRedis()` function already returns `null` and all Redis operations are gracefully skipped.

### 3.2 Issue #3: Production SSE Disabled

**Location:** `app/api/notifications/stream/route.ts`

```typescript
if (process.env.NODE_ENV === 'production') {
  return new Response('SSE streaming is disabled in production. Use Redis Pub/Sub.', { status: 501 });
}
```

**Problem:** Real-time notifications do not work in production. The dev-only mock stream sends simulated notifications every 15 seconds, but production returns HTTP 501. The comment suggests using Redis Pub/Sub, which has not been implemented.

**Impact:** Users do not receive real-time notifications in production; they must wait for the 60-second polling interval.

**Recommended fix:** Implement a Redis Pub/Sub subscriber in the SSE handler. See Section 6 and Appendix C for a complete code example.

---

## 4. L1+L2 Architecture (Now Implemented)

This section documents the L1+L2 architecture that was built in response to the issues identified above. For implementation details, see [CACHING_ARCHITECTURE.md](../../CACHING_ARCHITECTURE.md).

### 4.1 L1 In-Memory Cache

**File:** `lib/cache/lru.ts`

The L1 cache is a high-performance, instance-local in-memory cache using `lru-cache` v12+. It provides sub-millisecond reads for hot data, eliminating network round-trips to Redis.

| Parameter | Default | Description |
|-----------|---------|-------------|
| `L1_CACHE_MAX_ENTRIES` | 1000 | Maximum cache entries per instance |
| `L1_CACHE_TTL_MS` | 60,000 (60s) | Max TTL for cache entries in milliseconds |
| `ENABLE_L1_CACHE` | `true` | Feature flag to disable L1 entirely |

- **Singleton:** Uses `globalThis.__lruCache` for a single instance across all route bundles
- **Lazy init:** Re-checks runtime at call time for Next.js 15 dev mode compatibility
- **Byte-level size calculation:** `sizeCalculation: (value) => Buffer.byteLength(value)`
- **Max entry size:** 10,000 bytes (rejects oversized entries)

### 4.2 Hybrid Cache Layer

**File:** `lib/cache/hybrid.ts`

The hybrid layer orchestrates reads and writes across L1 (in-memory) and L2 (Redis):

| Function | Description |
|----------|-------------|
| `cacheGet(key, resolver, options)` | Read path: L1 → L2 → resolver with write-through |
| `cacheSet(key, value, options)` | Write path: write-through to both layers + Pub/Sub |
| `cacheDel(key)` | Delete path: remove from both layers + Pub/Sub invalidation |

**Adaptive TTL Types:**

| Type | TTL | Use Case |
|------|-----|----------|
| `permanent` | Infinity (no TTL) | Warmed data only evicted on explicit delete |
| `stable` | 3600s (1 hour) | Org metadata, user profiles |
| `volatile` | 300s (5 minutes) | Permissions (can change with role updates) |
| `search` | 30s | Search results (relatively stable, frequent refresh) |

### 4.3 Pub/Sub Invalidation

When data changes via `cacheSet()` or `cacheDel()`, an invalidation event is published to the Redis channel `cache:invalidations`. All instances subscribe to this channel on Redis connection and evict the affected key from their L1 cache.

```
Instance A:  Mutation → redis.publish('cache:invalidations', { key })
Instance B:  subscriber.on('message') → lruCache.delete(key)
```

The subscriber uses a duplicated Redis connection (`redis.duplicate()`) so it does not interfere with the main client's command queue.

### 4.4 Cache Warming

**File:** `lib/cache/warm.ts`

On startup, the following data is loaded in parallel:

| Data Type | Entity Keys | Search Aggregation Keys |
|-----------|-------------|------------------------|
| Organizations | `org:{id}` | `search:org:{name}`, `org:list:{name}` |
| Users | `user:{id}` | `search:user:{name}`, `search:user:{email}`, `user:list:{name}`, `user:list:{email}` |
| Roles (per org) | `role:{orgId}:{id}` | `search:role:{orgId}:{name}`, `role:list:{orgId}:{name}` |
| Permissions (catalog) | `perm:catalog:{key}` | `search:perm:{key}`, `perm:resource:{resource}` |

Each entity generates 2–4 cache entries (entity key + one or more search/list keys). Warmed entries use "permanent" TTL (no expiry) and are written to both L1 and L2 — see [Entry Characteristics](#entry-characteristics).

### 4.5 Replay Cache

**File:** `lib/replay-cache-redis.ts`

The replay cache prevents replay attacks on encrypted payloads. Configured via `PAYLOAD_ENCRYPTION_REPLAY_CACHE`:

| Backend | Condition | Mechanism |
|---------|-----------|-----------|
| `RedisReplayCache` | `PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis` | Atomic SET NX with TTL; session cleanup via SCAN |
| `MemoryReplayCache` | Default (not set to "redis") | In-memory Map with 100,000 entry limit and TTL-based cleanup timer |

---

## 5. Benchmark Script

### Scenarios A through H

The benchmark script (`scripts/cache-benchmark.ts`) measures real-world performance across eight scenarios using actual database data:

| Scenario | Path Tested | What It Measures |
|----------|-------------|-----------------|
| A: DB Only | Prisma → PostgreSQL | Baseline database query cost without caching |
| B: Redis L2 (Warm Hit) | ioredis GET → JSON.parse | Network round-trip cost to Redis |
| C: L1 Hit | LRUCache.get → JSON.parse | Pure memory access speed (hot path) |
| D: L1 Miss → L2 Hit | Redis GET → populate L1 | Cold-start penalty (first request pays network cost) |
| E: Search Miss | Prisma search query | Database search performance without caching |
| F: Search Hit (L1) | L1 lookup | Cached search result lookup speed |
| G: Permission Resolution (via cacheGet) | L1 hit with permission data | Full hybrid flow performance, cached path |
| H: Full Hybrid Flow (L1 Miss → L2 Hit) | cacheGet with metrics reporting | End-to-end behavior including hit/miss tracking |

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

## 6. SSE Production Implementation Guide

The following code example shows how to implement production-ready SSE using Redis Pub/Sub, replacing the current mock stream that returns 501 in production.

```typescript
// app/api/notifications/stream/route.ts (production implementation)
import { NextRequest } from 'next/server';
import { getRedis } from '@/lib/redis';

export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return new Response('Redis not available', { status: 503 });
  }

  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Create a subscriber connection (separate from main client)
  const subscriber = redis.duplicate();

  await new Promise<void>((resolve, reject) => {
    subscriber.on('error', reject);
    subscriber.subscribe('notifications', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  subscriber.on('message', async (_channel, message) => {
    try {
      const notification = JSON.parse(message);
      const data = `data: ${JSON.stringify(notification)}\n\n`;
      await writer.write(encoder.encode(data));
    } catch (err) {
      console.error('SSE message error:', err);
    }
  });

  // Cleanup on client disconnect
  req.signal.addEventListener('abort', () => {
    subscriber.unsubscribe();
    subscriber.quit();
    writer.close();
  });

  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
```

To broadcast notifications, any part of the application can publish to the `notifications` channel:

```typescript
const redis = getRedis();
if (redis) {
  await redis.publish('notifications', JSON.stringify({
    id: 'notif-123',
    message: 'New work order assigned',
    type: 'warning',
    read: false,
  }));
}
```

---

## Appendix A: Cache Key Naming Conventions

| Pattern | Example | Layer | TTL Type | Purpose |
|---------|---------|-------|----------|---------|
| `org:{id}` | `org:cms0jvces0000p9ve61l5zx2g` | L1 + L2 | `stable` (1h) | Organization entity cache |
| `user:{id}` | `user:cms0jvck7002hp9ve64bfhsi3` | L1 + L2 | `stable` (1h) | User entity cache |
| `role:{orgId}:{id}` | `role:cms0jvces0000p9ve61l5zx2g:r1` | L1 + L2 | `stable` (1h) | Role entity cache |
| `perm:catalog:{key}` | `perm:catalog:org:read` | L1 + L2 | `permanent` | Permission catalog entry |
| `perm:{userId}:{orgId}` | `perm:u1:o1` | L1 + L2 | `volatile` (5min) | Resolved permissions for user/org |
| `search:org:{name}` | `search:org:platform` | L1 + L2 | `search` (30s) | Organization search result aggregation |
| `search:user:{name}` | `search:user:admin` | L1 + L2 | `search` (30s) | User search by name |
| `search:user:{email}` | `search:user:admin@example.com` | L1 + L2 | `search` (30s) | User search by email |
| `search:role:{orgId}:{name}` | `search:role:o1:admin` | L1 + L2 | `search` (30s) | Role search result aggregation |
| `search:perm:{key}` | `search:perm:org:read` | L1 + L2 | `search` (30s) | Permission search result aggregation |
| `org:list:{name}` | `org:list:platform` | L1 + L2 | `search` (30s) | Organization list entry for search |
| `user:list:{name}` | `user:list:admin` | L1 + L2 | `search` (30s) | User list entry for search |
| `role:list:{orgId}:{name}` | `role:list:o1:admin` | L1 + L2 | `search` (30s) | Role list entry for search |
| `perm:resource:{resource}` | `perm:resource:org` | L1 + L2 | `search` (30s) | Permission grouped by resource |
| `replay:{sessionId}:{nonce}` | `replay:s1:abc123` | Redis only | TTL-based (60s) | Replay nonce for payload encryption |
| `replay:sessions:{sessionId}` | `replay:sessions:s1` | Redis only | TTL-based (60s) | Session tracking set for nonce cleanup |
| Pub/Sub channel: `cache:invalidations` | — | Redis only | N/A | Cross-instance L1 invalidation messages |

---

## Appendix B: API Endpoints Reference

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/api/health` | GET | None | Health check (database, Redis with 2s timeout, PgBouncer) with state transition logging |
| `/api/cache/metrics` | GET | Super Admin | Cache metrics (L1/L2 hit rates, sizes, Redis status) + L1 configuration details |
| `/api/admin/cache/metrics` | GET | Super Admin | Same metrics + optional `?action=reset` to clear all L1/L2 counters |

---

## Appendix C: Code Examples

### Fix #1: Redis URL Validation

```typescript
// Current (problematic) — lib/env.ts line 21
REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional().default('redis://localhost:6379'),

// Recommended — removes default so REDIS_URL is truly optional
REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional(),
```

When `undefined`, the `getRedis()` function already returns `null` and all Redis operations are gracefully skipped.

### Fix #3: Production SSE with Redis Pub/Sub

See Section 6 for the complete implementation. The key changes from the current mock stream:

1. Replace the simulated interval with a Redis Pub/Sub subscriber on the `notifications` channel
2. Use `redis.duplicate()` for the subscriber connection (separate from main client)
3. Clean up subscription and writer on client disconnect (`req.signal.addEventListener('abort', ...)`)

---

## Appendix D: Cross-References

| Document | Description |
|----------|-------------|
| [CACHING_ARCHITECTURE.md](../../CACHING_ARCHITECTURE.md) | Detailed implementation reference for all 5 caching layers |
| [SECURITY.md](../../SECURITY.md) — Data Protection section | Payload encryption, replay cache integration with caching layer |
| [QUICK_START.md](../../QUICK_START.md) | Getting started guide for developers |

---

*Last updated: 2026-08-26*
*Document owner: Engineering Team*

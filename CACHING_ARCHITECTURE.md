# Caching Architecture — Property NI Portal

## Overview

The Property NI Multi-Tenant Portal implements a **multi-layered caching strategy** combining:

1. **Next.js ISR** (Incremental Static Regeneration) for API routes
2. **L1 In-Memory LRU Cache** — Fast, instance-local cache for hot data
3. **Redis (L2)** — Distributed server-side cache for cross-instance consistency
4. **React Query** (TanStack Query) — Client-side data caching
5. **SSE** (Server-Sent Events) — Real-time notification updates

This document describes each layer, their interactions, trade-offs, and monitoring guidance.

---

## Layer 1: Next.js ISR (Server-Side)

### Purpose
Cache API route responses at the edge for a configurable duration, reducing server load.

### Configuration
| Route | Cache Duration | File |
|-------|---------------|------|
| `/api/admin/organizations` | 30 seconds revalidation | `app/api/admin/organizations/route.ts` |
| Protected routes (middleware) | `no-store` (no cache) | `middleware.ts` |

### Key Details
- Uses Next.js `revalidate` export to control cache duration
- Cached at the Edge/CDN level when deployed on Vercel
- Bypassed for authenticated routes (middleware sets `no-store`)

### Trade-offs
- **Pros:** Simple, built into Next.js, works at CDN edge
- **Cons:** Not suitable for authenticated/user-specific data; coarse-grained (entire route, not individual keys)

---

## Layer 2: L1 In-Memory LRU Cache (NEW)

### Purpose
High-performance, instance-local cache for frequently accessed data. Eliminates network round-trips for hot keys.

### Architecture
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
│  └──────┬───────┘            └─────┘│
│         │ MISS                      │
│         ▼                           │
│  ┌──────────────┐                   │
│  │ Prisma (DB)  │                   │
│  └──────────────┘                   │
│       │                             │
│       ▼ (write-through)             │
│  ┌──────────────┐    ┌──────────┐   │
│  │ L1: In-Mem   │◀───│ L2: Redis│   │
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
| `L1_CACHE_TTL_MS` | 60,000 (60s) | Max TTL for cache entries |
| `ENABLE_L1_CACHE` | `true` | Feature flag to disable L1 entirely |

### Key Details
- **Library:** `lru-cache` (v10+) with byte-level size calculation
- **Runtime Guard:** Disabled on Edge runtime (`process.env.NEXT_RUNTIME === 'edge'`)
- **Max Entry Size:** 10KB (rejects oversized entries to prevent memory issues)
- **TTL Strategy:** 60-second max TTL (shorter than Redis to limit stale data window)

### Read Path
1. **L1 Check** → `lruCache.get(key)` — if hit, return immediately (<0.1ms)
2. **L2 Check** → `redisGet(key)` — if hit, populate L1 and return (~5ms)
3. **DB Fallback** → Call resolver function (Prisma query, ~15–40ms)
4. **Write-Through** → Store result in both L2 (Redis, 5min TTL) and L1 (60s TTL)

### Write Path
1. **L2 Write** → `redisSet(key, value, 300)` — source of truth
2. **L1 Write** → `lruCache.set(key, value)` — performance optimization
3. **Pub/Sub Publish** → `redis.publish('cache:invalidations', { key })`

### Cross-Instance Invalidation
When data changes, a Pub/Sub message is published to Redis channel `cache:invalidations`. All instances subscribe to this channel and evict the affected key from their L1 cache.

```
Instance A:  Mutation → redis.publish('cache:invalidations', { key })
Instance B:  subscriber.on('message') → lruCache.delete(key)
Instance C:  subscriber.on('message') → lruCache.delete(key)
```

### Stampede Protection
When the L1 cache is cold (e.g., after restart), concurrent requests for the same key could all miss and trigger simultaneous DB queries. Stampede protection uses a `Map<string, Promise>` to deduplicate concurrent misses — only one resolver is executed per unique key.

### Trade-offs
- **Pros:** Sub-millisecond reads for hot keys; 60–80% Redis load reduction
- **Cons:** Instance-local (not shared across instances); memory usage (~5–20MB per instance)
- **Best For:** High read-to-write ratio, stable data (permissions, org metadata)

---

## Layer 3: Redis (L2 — Distributed Cache)

### Purpose
Distributed server-side cache for cross-instance consistency and persistence across restarts.

### Configuration
| Parameter | Value | Description |
|-----------|-------|-------------|
| TTL (permissions) | 300s (5 min) | Permission cache duration |
| TTL (search results) | 30s | Search result cache duration |
| Key Format | `perm:{userId}:{orgId}` | Permission cache keys |
| Key Format | `search:{resource}:{query}` | Search result cache keys |

### Current Usage
- **Permission Caching:** `lib/permissions/resolver.ts` — caches resolved permissions per user/org
- **Search Caching:** `lib/cache/hybrid.ts` — caches search results for autocomplete APIs

### Key Details
- **Client:** `ioredis` with retry strategy (max 10 retries, exponential backoff)
- **Connection Pooling:** Handled internally by ioredis
- **Invalidation:** Explicit via `cacheDel()` + Pub/Sub for cross-instance sync

### Trade-offs
- **Pros:** Distributed (shared across instances); persistent across restarts; mature ecosystem
- **Cons:** Network round-trip (~5–15ms); adds infrastructure dependency

---

## Layer 4: React Query (Client-Side)

### Purpose
Client-side data caching and synchronization for the frontend. Reduces API calls and provides optimistic updates.

### Configuration
| Hook | staleTime | cacheTime (gcTime) |
|------|-----------|-------------------|
| User profile | 15 min | 1 hour |
| User settings | 2 min | 30 min |
| Organization details | 5 min | 30 min |
| Permissions | 30 min | 1 hour |
| Notifications list | Polling: 60s | Default (5 min) |

### Key Details
- **Library:** TanStack Query v5 (uses `cacheTime` instead of deprecated `gcTime`)
- **Integration:** Injected into BetterAuth session object via session callback
- **Invalidation:** Triggered by mutations (e.g., role changes, permission updates)

### Trade-offs
- **Pros:** Reduces server load; provides optimistic UI updates; works offline
- **Cons:** Client-side only (doesn't help server performance); stale data until revalidation

---

## Layer 5: SSE (Real-Time Notifications)

### Purpose
Server-Sent Events for real-time notification delivery to the frontend.

### Current Status
- **Development:** Mock SSE stream in `app/api/notifications/stream/route.ts`
- **Production:** Disabled (returns 501) — Redis Pub/Sub implementation planned

### Key Details
- **Channel:** `notifications` (Redis Pub/Sub channel)
- **Fallback:** 60-second polling interval when SSE is unavailable

### Trade-offs
- **Pros:** Real-time updates without polling; simple protocol (HTTP-based)
- **Cons:** Not yet implemented in production; requires Redis Pub/Sub infrastructure

---

## Data Flow Diagrams

### Read Path (Permission Resolution)
```
Request → API Route
    │
    ▼
L1 Cache Check (in-memory)
    ├── HIT → Return cached value (<0.1ms)
    │
    └── MISS
        │
        ▼
    L2 Cache Check (Redis)
        ├── HIT → Populate L1, return value (~5ms)
        │
        └── MISS
            │
            ▼
        Database Query (Prisma)
            │
            ▼
        Write-Through: L2 (Redis, 5min) + L1 (60s)
            │
            ▼
        Return result (~15–40ms)
```

### Write Path (Permission Mutation)
```
Mutation → Update Database
    │
    ▼
L2 Write (Redis, 5min TTL)
    │
    ▼
L1 Write (In-Memory, 60s TTL)
    │
    ▼
Pub/Sub Publish (cache:invalidations channel)
    │
    ▼
Other Instances → Evict key from L1 cache
```

### Cross-Instance Invalidation Flow
```
┌─────────────┐     Pub/Sub      ┌─────────────┐
│  Instance A │ ───────────────▶ │  Instance B │
│             │   cache:invalid- │             │
│  Mutation   │   ations:{key}   │  L1 Evict   │
└─────────────┘                  └─────────────┘
       │                                │
       ▼                                ▼
  Redis (L2)                     L1 Cache (evicted)
```

---

## Trade-offs and Decisions

### Why L1 + L2 Architecture?
- **Performance:** Hot data (permissions checked on nearly every request) benefits from sub-millisecond L1 reads
- **Consistency:** Redis (L2) provides distributed consistency; Pub/Sub handles cross-instance sync
- **Resilience:** If Redis is down, system falls through to DB (L1 is optional optimization)

### Why 60s L1 TTL vs 5min Redis TTL?
- L1 is instance-local — stale data persists longer during invalidation windows without Pub/Sub
- 60s is a reasonable balance: limits stale data window while still providing significant hit rates
- Redis (5min) is the source of truth — longer TTL ensures consistency across restarts

### Why Not Cache Everything?
- **Write-heavy data:** Caching frequent writes causes cache thrashing and invalidation overhead
- **Large payloads:** Cache memory is limited; prioritize high-frequency, small-payload data (permissions, search results)
- **Real-time data:** Data that changes frequently (notifications) is better served by SSE/polling

### Why Not Skip L1 and Use Redis Only?
- **Network overhead:** Every cache miss requires a Redis round-trip (~5–15ms)
- **Redis load:** Under peak traffic, Redis becomes a bottleneck (connections, serialization, network)
- **Latency:** L1 provides <0.1ms reads vs ~5–15ms for Redis — 50–150x faster

---

## Monitoring and Metrics

### Key Metrics to Track
| Metric | Source | Target |
|--------|--------|--------|
| L1 Hit Rate | `lib/cache/health.ts` | >70% (varies by traffic) |
| L1 Entry Count | `lib/cache/health.ts` | <1000 (configurable) |
| L1 Memory Usage | `lib/cache/health.ts` | <20MB per instance |
| Redis Latency | `lib/redis.ts` | <5ms p99 |
| Redis Connection State | `lib/redis.ts` | Connected |

### Health Endpoint
Cache metrics are exposed via the health endpoint (`GET /api/health`):

```json
{
  "l1Hits": 1500,
  "l1Misses": 500,
  "l2Hits": 450,
  "l2Misses": 50,
  "l1Size": 850,
  "l1MemoryBytes": 4250000,
  "l1HitRate": 75.0,
  "redisConnected": true
}
```

### Alerting Thresholds
- **L1 Hit Rate < 50%:** Investigate cache key distribution or TTL settings
- **L1 Memory > 15MB:** Consider reducing `L1_CACHE_MAX_ENTRIES` or entry sizes
- **Redis Disconnected:** System falls through to DB — monitor for increased latency

---

## Known Limitations and Future Improvements

### Current Limitations
1. **L1 is instance-local:** Cache hit rates vary by deployment model (better on containers, worse on serverless)
2. **Pub/Sub is fire-and-forget:** Invalidations can be lost if Redis crashes (TTL provides fallback)
3. **Search results TTL is short (30s):** May cause frequent cache misses for popular queries

### Implemented Improvements ✅
1. **Cache warming:** Pre-populate L1 with frequently accessed data on startup (`lib/cache/warm.ts`)
   - Loads organizations, users, roles, and permissions into L1 on startup
   - Entries are marked as "permanent" (no TTL) — only evicted on explicit delete
2. **Adaptive TTLs:** Different TTLs for different data types (`lib/cache/hybrid.ts`)
   - `permanent`: No TTL (orgs, users, roles, permissions catalog)
   - `stable`: 1 hour TTL (org metadata, user profiles)
   - `volatile`: 5 minutes TTL (permissions — can change with role updates)
   - `search`: 30 seconds TTL (search results — relatively stable)
3. **Cache metrics dashboard:** Real-time visualization (`/admin/cache-metrics`)
   - L1 hit/miss rates with progress bar
   - Entry counts and memory usage
   - Redis connection status
   - Polls every 10 seconds for real-time updates

### Future Improvements
1. **SSE production implementation:** Replace polling with real-time notifications

---

## Configuration Reference

### Environment Variables
| Variable | Default | Description |
|----------|---------|-------------|
| `ENABLE_L1_CACHE` | `true` | Enable/disable L1 cache entirely |
| `L1_CACHE_MAX_ENTRIES` | `1000` | Maximum cache entries per instance |
| `L1_CACHE_TTL_MS` | `60000` | Max TTL for L1 cache entries (milliseconds) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |

### Runtime Detection
- **Node.js runtime:** L1 cache active (default for API routes)
- **Edge runtime:** L1 cache disabled (stateless per request)

---

## References
- [Cache Architecture Review](documents/feature-planning-and-development/cache-upgrades.md) — Detailed analysis of current caching issues and recommendations
- [OpenSpec: L1 Cache Layer](openspec/changes/l1-cache-layer/proposal.md) — Feature proposal and design
- [OpenSpec: Search Autocomplete](openspec/changes/search-autocomplete/proposal.md) — Search-as-you-type APIs using L1 cache

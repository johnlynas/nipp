# L1 In-Memory Cache Layer

**Status:** Proposed  
**Author:** John Lynas  
**Created:** 2026-08-01  
**Last Updated:** 2026-08-01  
**Related Issues:** Cache architecture review (`documents/feature-planning-and-development/cache-upgrades.md`)

## Summary

Introduce an L1 in-memory LRU cache layer on the server, sitting between application logic and Redis (L2). This creates a two-tier caching architecture that eliminates network round-trips for hot data, reducing read latency from ~5–15ms (Redis) to <0.1ms (memory), and cutting Redis load by 60–80% for frequently accessed keys.

## Motivation

The current caching strategy uses Redis only (L2) with a 5-minute TTL for permission resolution. This works but has limitations:

- Every cache miss requires a Redis network round-trip (~5–15ms) even for keys that are accessed repeatedly within the same server instance.
- Under load, Redis becomes a bottleneck — connection overhead, serialization/deserialization, and network latency add up.
- Permission checks run on nearly every request; eliminating the Redis hop for hot keys yields significant latency savings.
- The `cache-upgrades.md` document identifies this as a medium-priority improvement with high impact.

An L1 in-memory cache is the proven pattern used by Spring Cache, Django's LocMemCache, and many high-performance systems. It provides near-zero-latency reads for hot data while keeping Redis as the distributed source of truth.

## Scope

**In scope:**
- Core L1 cache implementation (`lib/cache/lru.ts`) using `lru-cache` library
- Hybrid read/write layer that checks L1 first, falls back to Redis (L2), then DB
- Integration with existing permission resolver (`lib/permissions/resolver.ts`)
- Cross-instance cache invalidation via Redis Pub/Sub
- Runtime detection: L1 only active on Node.js runtime, gracefully disabled on Edge
- Cache stampede protection (single-flight/deduplication) for cache misses
- L1 cache metrics (hit/miss ratios, memory usage) exposed via health endpoint
- Unit tests for all cache logic
- `CACHING_ARCHITECTURE.md` — comprehensive documentation of the caching strategy across all layers (ISR, L1 in-memory, Redis L2, React Query client-side, SSE)

**Out of scope (Non-goals):**
- Search-as-you-type APIs (covered in `search-autocomplete` proposal)
- Redis infrastructure changes (connection pooling, health monitoring — separate effort)
- Client-side caching changes (React Query is already in place)
- Next.js ISR revalidation strategy changes

## Detailed Design Overview

The L1 cache will be implemented as a singleton `LRUCache` instance in `lib/cache/lru.ts`, guarded by runtime detection (`process.env.NEXT_RUNTIME !== 'edge'`). A hybrid cache helper (`lib/cache/hybrid.ts`) will orchestrate the L1→L2→DB read path and write-through to both layers.

Permission resolution will be the first consumer, replacing direct Redis calls in `lib/permissions/resolver.ts` with the hybrid layer. Cross-instance invalidation uses Redis Pub/Sub so that when one instance deletes a key, all others receive the signal and evict it from their L1 cache.

Cache stampede protection uses a `Map<string, Promise>` to deduplicate concurrent misses on the same key — only one DB/Redis query fires per unique miss, and all waiting callers share the result.

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `lib/cache/lru.ts` | L1 in-memory LRU cache singleton |
| New | `lib/cache/hybrid.ts` | Hybrid read/write layer (L1→L2→DB) |
| New | `lib/cache/stampede.ts` | Cache stampede protection (single-flight) |
| New | `lib/cache/health.ts` | Cache metrics and health reporting |
| Modified | `lib/permissions/resolver.ts` | Use hybrid cache instead of direct Redis |
| Modified | `lib/redis.ts` | Add Pub/Sub subscriber for cross-instance invalidation |
| New | `tests/unit/cache/lru.test.ts` | Unit tests for LRU cache |
| New | `tests/unit/cache/hybrid.test.ts` | Unit tests for hybrid layer |
| New | `CACHING_ARCHITECTURE.md` | Comprehensive documentation of the caching architecture (ISR, L1, Redis L2, React Query, SSE) |

## Testing Plan

- **Unit tests:** LRU cache eviction, TTL expiry, size calculation, runtime detection
- **Unit tests:** Hybrid layer read path (L1 hit, L1 miss/L2 hit, L1 miss/L2 miss), write-through
- **Unit tests:** Stampede protection — concurrent misses on same key produce exactly one underlying query
- **Integration tests:** Cross-instance invalidation via Pub/Sub (simulated with two cache instances)
- **Manual testing:** Verify L1 is disabled on Edge runtime, metrics endpoint returns valid data

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Memory leak from unbounded cache | High | Enforce `max` entries and `sizeCalculation`; set hard TTL; monitor memory via health endpoint |
| Stale data across instances | Medium | Redis Pub/Sub invalidation + short L1 TTL (60s max); accept eventual consistency window |
| Cache stampede on cold start | Medium | Single-flight deduplication via `Map<string, Promise>` |
| Edge runtime incompatibility | Low | Runtime detection guards all L1 access; falls back to Redis-only on Edge |
| Breaking existing permission resolution | High | Feature flag (`ENABLE_L1_CACHE`); gradual rollout; comprehensive unit tests |

## Acceptance Criteria

- [ ] L1 cache singleton is created with configurable max entries, TTL, and size calculation
- [ ] Runtime detection prevents L1 from running on Edge runtime
- [ ] Hybrid read layer checks L1 first, then Redis (L2), then falls through to caller-provided resolver
- [ ] Hybrid write layer writes through to both L1 and Redis (L2)
- [ ] Permission resolver uses the hybrid layer instead of direct Redis calls
- [ ] Cross-instance invalidation via Redis Pub/Sub works (L1 key evicted on all instances)
- [ ] Cache stampede protection deduplicates concurrent misses on the same key
- [ ] L1 cache metrics (hit/miss ratio, entry count, memory bytes) are exposed
- [ ] All unit tests pass; integration tests for cross-instance invalidation pass
- [ ] `CACHING_ARCHITECTURE.md` is created with detailed documentation of all caching layers, their interactions, and trade-offs

# Tasks: L1 In-Memory Cache Layer

## Phase 1: Foundation — Core Cache Infrastructure
- [ ] **Task 1.1:** Install `lru-cache` dependency (`npm install lru-cache`)
- [ ] **Task 1.2:** Create `lib/cache/lru.ts` — LRU cache singleton with runtime detection, configurable max/TTL/sizeCalculation
- [ ] **Task 1.3:** Create `lib/cache/stampede.ts` — single-flight deduplication using `Map<string, Promise>`
- [ ] **Task 1.4:** Write unit tests for `lru.ts` — eviction, TTL expiry, size calculation, runtime guard
- [ ] **Task 1.5:** Write unit tests for `stampede.ts` — concurrent miss deduplication, promise cleanup

## Phase 2: Hybrid Layer — L1 + Redis Orchestration
- [ ] **Task 2.1:** Create `lib/cache/hybrid.ts` — cacheGet (L1→L2→resolver), cacheSet (write-through), cacheDel
- [ ] **Task 2.2:** Integrate stampede protection into `cacheGet` — wrap resolver in single-flight
- [ ] **Task 2.3:** Create `lib/cache/health.ts` — metrics collection (hits, misses, entry count, memory bytes)
- [ ] **Task 2.4:** Write unit tests for `hybrid.ts` — L1 hit path, L1 miss/L2 hit path, L1 miss/L2 miss path
- [ ] **Task 2.5:** Write unit tests for `health.ts` — metrics accuracy, hit rate calculation

## Phase 3: Redis Pub/Sub — Cross-Instance Invalidation
- [ ] **Task 3.1:** Update `lib/redis.ts` — add Pub/Sub subscriber that listens on `cache:invalidations` channel
- [ ] **Task 3.2:** On Pub/Sub message, evict the key from L1 cache via `getLruCache()?.delete(key)`
- [ ] **Task 3.3:** Add `cache:invalidations` publish call to `cacheDel` and `cacheSet` in hybrid layer
- [ ] **Task 3.4:** Write integration test for cross-instance invalidation — simulate two cache instances sharing a Redis Pub/Sub channel

## Phase 4: Permission Resolver Integration
- [ ] **Task 4.1:** Update `lib/permissions/resolver.ts` — replace direct Redis calls with hybrid layer (`cacheGet`/`cacheSet`/`cacheDel`)
- [ ] **Task 4.2:** Add `ENABLE_L1_CACHE` environment variable to `lib/env.ts` with default `true`
- [ ] **Task 4.3:** Wire runtime detection into hybrid layer — skip L1 when `ENABLE_L1_CACHE` is false or on Edge runtime
- [ ] **Task 4.4:** Verify existing permission resolution behavior is unchanged (same return values, same error handling)

## Phase 5: Health Endpoint — Cache Metrics Exposure
- [ ] **Task 5.1:** Add `GET /api/health` endpoint (or extend existing) to include cache metrics from `getCacheMetrics()`
- [ ] **Task 5.2:** Include L1 hit rate, entry count, memory bytes, and Redis connection state in health response
- [ ] **Task 5.3:** Manual test — verify metrics endpoint returns valid JSON with expected fields

## Phase 6: Caching Architecture Documentation
- [ ] **Task 6.1:** Create `CACHING_ARCHITECTURE.md` at project root with comprehensive documentation of all caching layers (ISR, L1 in-memory, Redis L2, React Query client-side, SSE)
- [ ] **Task 6.2:** Include layer overview, per-layer details (TTLs, key formats, invalidation), data flow diagrams, trade-offs, and monitoring guidance
- [ ] **Task 6.3:** Review document for accuracy against implementation; update if any discrepancies found

## Phase 7: Testing & Validation
- [ ] **Task 7.1:** Run full test suite (`npm run test:all`) — ensure no regressions
- [ ] **Task 7.2:** Run type checking (`npm run type-check`) — ensure TypeScript strict mode passes
- [ ] **Task 7.3:** Run linting (`npm run lint`) — ensure no lint errors
- [ ] **Task 7.4:** Manual integration test — start app locally with Redis, verify L1 cache is active (check metrics)
- [ ] **Task 7.5:** Manual integration test — trigger permission mutation, verify L1 invalidation across simulated instances

# Delta for Caching

## ADDED Requirements

### Requirement: L1 In-Memory Cache
The system MUST maintain an in-memory LRU cache (L1) on the server for frequently accessed data.

#### Scenario: Cache Creation
- GIVEN the application starts on a Node.js runtime (not Edge)
- AND `ENABLE_L1_CACHE` is true (default)
- WHEN the LRU cache singleton is initialized
- THEN it MUST have a maximum of 1000 entries (configurable via `L1_CACHE_MAX_ENTRIES`)
- THEN it MUST have a TTL of 60 seconds (configurable via `L1_CACHE_TTL_MS`)
- THEN it MUST calculate entry size in bytes using `Buffer.byteLength`

#### Scenario: Edge Runtime Guard
- GIVEN the application runs on an Edge runtime
- WHEN the LRU cache singleton is accessed
- THEN it MUST return `null` (cache disabled)

#### Scenario: L1 Cache Hit
- GIVEN a key exists in the L1 cache
- WHEN `cacheGet(key)` is called
- THEN it MUST return the cached value immediately without contacting Redis or the database

#### Scenario: L1 Cache Miss, L2 Hit
- GIVEN a key does NOT exist in the L1 cache
- AND the key exists in Redis (L2)
- WHEN `cacheGet(key)` is called
- THEN it MUST return the value from Redis
- THEN it MUST populate the L1 cache with the retrieved value

#### Scenario: L1 Cache Miss, L2 Miss
- GIVEN a key does NOT exist in the L1 cache
- AND the key does NOT exist in Redis (L2)
- WHEN `cacheGet(key)` is called with a resolver function
- THEN it MUST call the resolver function to fetch the value
- THEN it MUST write the result to both L1 and L2 caches

### Requirement: Hybrid Read/Write Layer
The system MUST provide a unified cache interface that orchestrates L1 and L2 access.

#### Scenario: Write-Through
- GIVEN a value is set via `cacheSet(key, value, ttlSeconds)`
- WHEN the function completes
- THEN the value MUST be stored in Redis (L2) with the specified TTL
- THEN the value MUST also be stored in L1 cache

#### Scenario: Delete Propagation
- GIVEN a key exists in both L1 and L2 caches
- WHEN `cacheDel(key)` is called
- THEN the key MUST be removed from L1 cache
- THEN the key MUST be deleted from Redis (L2)

### Requirement: Cache Stampede Protection
The system MUST prevent cache stampedes by deduplicating concurrent misses on the same key.

#### Scenario: Concurrent Miss Deduplication
- GIVEN a key is not in L1 or L2 cache
- WHEN 10 concurrent requests call `cacheGet(key)` simultaneously
- THEN the resolver function MUST be called exactly once
- THEN all 10 requests MUST receive the same resolved value

#### Scenario: Stampede Map Cleanup
- GIVEN a cache miss triggers a resolver promise
- WHEN the resolver promise resolves or rejects
- THEN the entry in the deduplication map MUST be removed

### Requirement: Cross-Instance Invalidation
The system MUST propagate cache invalidation events across all server instances.

#### Scenario: Pub/Sub Invalidation
- GIVEN multiple server instances are running with L1 caches
- WHEN `cacheDel(key)` is called on Instance A
- THEN a Pub/Sub message MUST be published to Redis channel `cache:invalidations`
- THEN Instance B, C, etc. MUST receive the message and evict the key from their L1 cache

#### Scenario: Invalidation Message Format
- GIVEN an invalidation event is published
- WHEN a subscriber receives the message
- THEN the message MUST be valid JSON with at least a `key` field

### Requirement: Cache Metrics
The system MUST expose cache performance metrics for monitoring.

#### Scenario: Metrics Collection
- WHEN `getCacheMetrics()` is called
- THEN it MUST return an object containing:
  - `l1Hits`: number of L1 cache hits
  - `l1Misses`: number of L1 cache misses
  - `l2Hits`: number of L2 (Redis) cache hits
  - `l2Misses`: number of L2 (Redis) cache misses
  - `l1Size`: current number of entries in L1 cache
  - `l1MemoryBytes`: approximate memory usage of L1 cache
  - `l1HitRate`: percentage hit rate (0–100)

#### Scenario: Metrics Accuracy
- GIVEN the cache has processed 100 read operations
- WHEN `getCacheMetrics()` is called
- THEN `l1Hits + l1Misses` MUST equal 100

### Requirement: Permission Resolver Integration
The permission resolver MUST use the hybrid cache layer instead of direct Redis calls.

#### Scenario: Permission Read Path
- GIVEN a user requests permission resolution for `(userId, orgId)`
- WHEN `resolvePermissions(userId, orgId)` is called
- THEN it MUST first check L1 cache for key `perm:{userId}:{orgId}`
- THEN if not in L1, it MUST check Redis (L2) for the same key
- THEN if not in L2, it MUST query the database via Prisma
- THEN the result MUST be written through to both L1 and L2

#### Scenario: Permission Cache Invalidation
- GIVEN a user's permissions have been updated in the database
- WHEN `invalidatePermissionCache(userId, orgId)` is called
- THEN it MUST delete the key from L1 cache
- THEN it MUST delete the key from Redis (L2)
- THEN it MUST publish an invalidation event via Pub/Sub

### Requirement: Feature Flag
The L1 cache MUST be controllable via an environment variable.

#### Scenario: Cache Disabled via Flag
- GIVEN `ENABLE_L1_CACHE` is set to `false`
- WHEN the application starts
- THEN the L1 cache MUST NOT be created (even on Node.js runtime)
- THEN all cache operations MUST fall through to Redis only

### Requirement: Caching Architecture Documentation
The system MUST include a comprehensive `CACHING_ARCHITECTURE.md` document at the project root.

#### Scenario: Document Exists
- GIVEN the L1 cache layer is implemented
- WHEN `CACHING_ARCHITECTURE.md` exists at the project root
- THEN it MUST describe all caching layers: ISR, L1 in-memory, Redis (L2), React Query client-side, and SSE

#### Scenario: Layer Details Documented
- GIVEN `CACHING_ARCHITECTURE.md` is reviewed
- THEN it MUST include per-layer details: TTLs, key formats, invalidation strategies, and failure modes
- THEN it MUST include data flow diagrams for read path, write path, and cross-instance invalidation
- THEN it MUST include trade-offs and decisions explaining why each layer exists
- THEN it MUST include monitoring guidance (metrics to track: hit rates, memory usage, Redis latency)

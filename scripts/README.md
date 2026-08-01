# Scripts

Utility scripts for the Property NI Multi-Tenant Portal.

## Cache Benchmark (`cache-benchmark.ts`)

A comprehensive profiling script that measures the performance impact of L1 (in-memory) and L2 (Redis) caching.

### What It Tests

The script benchmarks **7 different scenarios** using real data from your database:

| Scenario | Description | What It Measures |
|----------|-------------|------------------|
| **A** | Direct Database Query (Baseline) | Latency of hitting PostgreSQL directly |
| **B** | Redis L2 Cache (Warm Hit) | Latency of Redis GET + JSON.parse |
| **C** | L1+L2 Hybrid (In-Memory Hit) | Pure in-memory cache lookup speed |
| **D** | L1+L2 Hybrid (L1 Miss, L2 Hit) | Complete path: L1 miss → Redis → populate L1 |
| **E** | Search Endpoint (Cache Miss) | Direct DB search query performance |
| **F** | Search Endpoint (L1 Hit) | Cached search result lookup speed |
| **G** | Permission Resolution (via cacheGet) | Full hybrid flow with permission data |
| **H** | Full Hybrid Flow (L1 Miss → L2 Hit) | End-to-end cacheGet with metrics reporting |

### Prerequisites

- Node.js 18+ installed
- Database configured in `.env` (`DATABASE_URL`)
- Redis configured (optional, for L2 benchmarks)
- `tsx` installed (`npx tsx` will handle this)

### How to Run

```bash
# Basic usage
npx tsx scripts/cache-benchmark.ts

# With custom environment (e.g., test database)
DATABASE_URL="postgresql://test@localhost/nipp_test" npx tsx scripts/cache-benchmark.ts
```

### Configuration

Edit the constants at the top of `scripts/cache-benchmark.ts`:

```typescript
const ITERATIONS = 100;           // Requests per scenario (higher = more accurate)
const WARMUP_ITERATIONS = 10;     // Warmup iterations (not counted)
const SCRIPT_TIMEOUT_MS = 300_000; // 5 minute safety timeout
```

### Interpreting Results

#### Expected Latency Ranges (Local Development)

| Scenario | Expected Latency | What It Tells You |
|----------|-----------------|-------------------|
| A: DB Only | 15ms - 40ms | Baseline database query cost |
| B: Redis L2 | 1ms - 5ms | Network round-trip to Redis |
| C: L1 Hit | 0.01ms - 0.1ms | Pure memory access (essentially free) |
| D: L1 Miss + L2 | 5ms - 8ms | Check Map (negligible) + Redis |
| E: Search Miss | 10ms - 30ms | Database search query cost |
| F: Search Hit | 0.01ms - 0.1ms | Cached search lookup speed |
| G: Permission Resolution | Varies | Full permission resolution path |

#### Decision Matrix

- **If Scenario A > 20ms**: L1+L2 caching will likely reduce average latency by **50-70%**
- **If Scenario A < 5ms**: Database is already fast; L1 may be over-engineering
- **If Scenario B > 10ms**: Redis connection or network is slow; fix infrastructure first
- **If L1 Hit Rate < 50%**: Consider increasing cache size or adjusting TTLs

### Output Example

```
🚀 Starting Cache Performance Profiler...
   Iterations per scenario: 100
   Warmup iterations: 10

📊 Validating database connection...
   Found 42 organizations in database

🔵 Scenario A: Direct Database Query (Baseline)
   Warming up (10 iterations)...
   Running benchmark (100 iterations)...
   Avg Latency: 23.45 ms
   Total Time:  2345.67 ms
   Throughput:  42 ops/sec

🟠 Scenario B: Redis L2 Cache (Warm Hit)
   ...

✅ All benchmarks complete in 15234.56 ms

================================================================================
CACHE BENCHMARK SUMMARY
================================================================================

L1 Cache Status:
  Enabled: true
  Size: 156 entries
  Memory (estimated): 31.25 KB
  Hit Rate: 87.3%

L2 (Redis) Status:
  Connected: true
  Hits: 456
  Misses: 67
  Hit Rate: 87.2%

================================================================================
```

### Troubleshooting

#### "Redis not configured"
- Ensure `REDIS_URL` is set in your `.env` file
- Verify Redis is running: `redis-cli ping` should return `PONG`

#### "No organizations found"
- The script uses real data; populate your database first
- Run the seed script: `npm run db:seed`

#### Script hangs or times out
- Check database connectivity: `pg_isready -h localhost -p 5432`
- Increase timeout by editing `SCRIPT_TIMEOUT_MS` constant
- Reduce `ITERATIONS` for faster results

#### TypeScript errors
- Ensure you're using Node.js 18+ (required for BigInt support)
- Run `npx tsc --noEmit scripts/cache-benchmark.ts` to check for issues

### Integration with Cache System

This script tests the actual cache implementation used in production:
- **L1 Cache**: `lib/cache/lru.ts` - In-memory LRU cache
- **L2 Cache**: `lib/redis.ts` - Redis client wrapper
- **Hybrid Layer**: `lib/cache/hybrid.ts` - L1+L2 orchestration
- **Metrics**: `lib/cache/health.ts` - Hit/miss tracking

The script measures real cache hits and misses, so results reflect actual production behavior.

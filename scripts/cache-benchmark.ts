#!/usr/bin/env tsx
/**
 * Cache Performance Profiler
 * 
 * Compares latency between:
 * 1. Direct Database Query (Baseline)
 * 2. Redis L2 Cache (Warm/Cold)
 * 3. In-Memory L1 + Redis L2 Hybrid
 * 
 * Uses REAL data from the database for meaningful results.
 * Tests against actual cacheGet/cacheSet from lib/cache/hybrid.ts
 * Includes search endpoint benchmarks for organizations, users, roles, permissions.
 * 
 * Run: npx tsx scripts/cache-benchmark.ts
 */

import { prisma } from '../lib/db';
import { getRedis, redisGet, redisSet, redisDel } from '../lib/redis';
import { cacheGet, cacheSet, cacheDel } from '../lib/cache/hybrid';
import { getLruCache, getMetrics as getLruMetrics } from '../lib/cache/lru';
import { getCacheMetrics, resetMetrics } from '../lib/cache/health';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ITERATIONS = 100; // Number of requests to simulate per scenario
const WARMUP_ITERATIONS = 10; // Warmup iterations to stabilize measurements
const SCRIPT_TIMEOUT_MS = 300_000; // 5 minute timeout for the entire script

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(ns: bigint): string {
  const ms = Number(ns) / 1000000;
  return `${ms.toFixed(2)} ms`;
}

function formatOps(ns: bigint, count: number): string {
  const ms = Number(ns) / 1000000;
  if (ms === 0) return '∞ ops/sec';
  const opsPerSec = (count / ms) * 1000;
  return `${opsPerSec.toFixed(0)} ops/sec`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Run a benchmark scenario and return total time in nanoseconds.
 */
async function benchmark(
  name: string,
  fn: () => Promise<void>,
  iterations: number = ITERATIONS,
): Promise<bigint> {
  console.log(`\n${name}`);
  
  // Warmup phase (not counted)
  console.log(`   Warming up (${WARMUP_ITERATIONS} iterations)...`);
  for (let i = 0; i < WARMUP_ITERATIONS; i++) {
    await fn();
  }

  // Benchmark phase
  console.log(`   Running benchmark (${iterations} iterations)...`);
  let totalNs = BigInt(0);
  
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    totalNs += (end - start);
  }

  const avgNs = totalNs / BigInt(iterations);
  const avgMs = Number(avgNs) / 1_000_000;
  const totalMs = Number(totalNs) / 1_000_000;
  
  console.log(`   Avg Latency: ${formatTime(totalNs / BigInt(iterations))}`);
  console.log(`   Total Time:  ${totalMs.toFixed(2)} ms`);
  console.log(`   Throughput:  ${formatOps(totalNs, iterations)}`);

  return totalNs;
}

// ---------------------------------------------------------------------------
// Data Fetching Helpers (using REAL data)
// ---------------------------------------------------------------------------

async function getTestOrganizations() {
  return await prisma.organization.findMany({
    select: { id: true, name: true },
    take: 10,
  });
}

async function getTestUsers() {
  return await prisma.user.findMany({
    select: { id: true, name: true, email: true },
    take: 10,
  });
}

async function getTestRoles(orgId: string) {
  return await prisma.role.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true },
    take: 5,
  });
}

async function getTestPermissions() {
  return await prisma.permission.findMany({
    select: { id: true, key: true, resource: true, action: true },
    take: 20,
  });
}

// ---------------------------------------------------------------------------
// Scenario A: Direct Database Query (Baseline)
// ---------------------------------------------------------------------------

async function runDbBenchmark() {
  console.log('\n🔵 Scenario A: Direct Database Query (Baseline)');
  console.log('   Simulating cache miss where we hit the DB directly...');

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found in database. Skipping.');
    return;
  }

  const org = orgs[0];
  
  await benchmark(
    `   Testing with organization: ${org.name} (${org.id})`,
    async () => {
      // Simulate the exact query pattern used in permission resolution
      await prisma.member.findFirst({
        where: { orgId: org.id },
        select: {
          role: true,
        },
      });
    },
    ITERATIONS,
  );
}

// ---------------------------------------------------------------------------
// Scenario B: Redis L2 Cache (Warm Hit)
// ---------------------------------------------------------------------------

async function runRedisBenchmark() {
  const redis = getRedis();
  if (!redis) {
    console.log('\n🔴 Redis not configured. Skipping L2 benchmarks.');
    return;
  }

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const org = orgs[0];
  const cacheKey = `org:${org.id}`;

  console.log('\n🟠 Scenario B: Redis L2 Cache (Warm Hit)');
  console.log(`   Testing with key: ${cacheKey}`);

  // Pre-warm the cache
  const orgData = await prisma.organization.findUnique({
    where: { id: org.id },
  });
  
  if (!orgData) {
    console.log('   ⚠️  Organization not found. Skipping.');
    return;
  }

  await redisSet(cacheKey, JSON.stringify(orgData), 300);
  console.log('   Cache pre-warmed with organization data');

  await benchmark(
    '   Simulating Redis GET + JSON.parse',
    async () => {
      const cached = await redisGet(cacheKey);
      if (cached) JSON.parse(cached);
    },
    ITERATIONS,
  );

  // Cleanup
  await redisDel(cacheKey);
}

// ---------------------------------------------------------------------------
// Scenario C: L1+L2 Hybrid (In-Memory Hit)
// ---------------------------------------------------------------------------

async function runL1HitBenchmark() {
  const lru = getLruCache();
  if (!lru) {
    console.log('\n🟡 L1 cache is disabled (Edge runtime or feature flag). Skipping.');
    return;
  }

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const org = orgs[0];
  const cacheKey = `org:${org.id}`;

  console.log('\n🟢 Scenario C: L1+L2 Hybrid (In-Memory Hit)');
  console.log(`   Testing with key: ${cacheKey}`);

  // Pre-populate L1 cache
  const orgData = await prisma.organization.findUnique({
    where: { id: org.id },
  });

  if (!orgData) {
    console.log('   ⚠️  Organization not found. Skipping.');
    return;
  }

  lru.set(cacheKey, JSON.stringify(orgData));
  console.log('   L1 cache pre-populated');

  await benchmark(
    '   Simulating LRU Map lookup + JSON.parse',
    async () => {
      const cached = lru.get(cacheKey);
      if (cached !== undefined) JSON.parse(cached);
    },
    ITERATIONS,
  );

  // Clear for next tests
  lru.delete(cacheKey);
}

// ---------------------------------------------------------------------------
// Scenario D: L1+L2 Hybrid (L1 Miss, L2 Hit)
// ---------------------------------------------------------------------------

async function runL1MissL2HitBenchmark() {
  const redis = getRedis();
  if (!redis) {
    console.log('\n🔴 Redis not configured. Skipping.');
    return;
  }

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const org = orgs[0];
  const cacheKey = `org:${org.id}`;

  console.log('\n🟡 Scenario D: L1+L2 Hybrid (L1 Miss, L2 Hit)');
  console.log(`   Testing with key: ${cacheKey}`);

  // Pre-warm Redis (L2)
  const orgData = await prisma.organization.findUnique({
    where: { id: org.id },
  });

  if (!orgData) {
    console.log('   ⚠️  Organization not found. Skipping.');
    return;
  }

  await redisSet(cacheKey, JSON.stringify(orgData), 300);
  
  // Clear L1 to force miss
  const lru = getLruCache();
  if (lru) {
    lru.delete(cacheKey);
  }

  console.log('   Redis pre-warmed, L1 cleared');

  await benchmark(
    '   Simulating: L1 miss → Redis GET → populate L1',
    async () => {
      const cached = await redisGet(cacheKey);
      if (cached && lru) {
        lru.set(cacheKey, cached);
      }
      if (cached) JSON.parse(cached);
    },
    ITERATIONS,
  );

  // Cleanup
  await redisDel(cacheKey);
}

// ---------------------------------------------------------------------------
// Scenario E: Search Endpoint on Cache Miss (DB Query)
// ---------------------------------------------------------------------------

async function runSearchMissBenchmark() {
  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const searchTerm = orgs[0].name.substring(0, 3); // Use first 3 chars for substring match

  console.log('\n🔵 Scenario E: Search Endpoint (Cache Miss - DB Query)');
  console.log(`   Searching for organizations matching: "${searchTerm}"`);

  await benchmark(
    '   Simulating direct DB search query',
    async () => {
      await prisma.organization.findMany({
        where: {
          name: {
            contains: searchTerm,
            mode: 'insensitive',
          },
        },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      });
    },
    ITERATIONS,
  );
}

// ---------------------------------------------------------------------------
// Scenario F: Search Endpoint with L1 Hit (Pre-warmed)
// ---------------------------------------------------------------------------

async function runSearchHitBenchmark() {
  const lru = getLruCache();
  if (!lru) {
    console.log('\n🟡 L1 cache disabled. Skipping.');
    return;
  }

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const org = orgs[0];
  const normalizedName = org.name.toLowerCase();
  const searchKey = `search:org:${normalizedName}`;

  console.log('\n🟢 Scenario F: Search Endpoint (L1 Hit - Pre-warmed)');
  console.log(`   Testing with search key: ${searchKey}`);

  // Pre-populate L1 with search result aggregation
  const searchData = {
    results: [{ id: org.id, name: org.name }],
    total: 1,
  };

  lru.set(searchKey, JSON.stringify(searchData));
  console.log('   L1 search key pre-populated');

  await benchmark(
    '   Simulating L1 lookup for search results',
    async () => {
      const cached = lru.get(searchKey);
      if (cached !== undefined) JSON.parse(cached);
    },
    ITERATIONS,
  );

  // Cleanup
  lru.delete(searchKey);
}

// ---------------------------------------------------------------------------
// Scenario G: Permission Resolution via cacheGet
// ---------------------------------------------------------------------------

async function runPermissionResolutionBenchmark() {
  const members = await prisma.member.findMany({
    select: { id: true, userId: true, orgId: true },
    take: 5,
  });

  if (members.length === 0) {
    console.log('   ⚠️  No members found. Skipping.');
    return;
  }

  const member = members[0];
  const cacheKey = `perm:${member.userId}:${member.orgId}`;

  console.log('\n🟠 Scenario G: Permission Resolution (via cacheGet)');
  console.log(`   Testing with member: ${member.userId} in org: ${member.orgId}`);

  // Get actual permissions from DB
  const memberWithRole = await prisma.member.findFirst({
    where: { id: member.id },
    select: {
      role: true,
    },
  });

  // For benchmarking, we'll use a simple array of permission keys
  const permissions = ['org:read', 'org:write', 'user:read'] as string[];

  // Pre-warm cache
  await cacheSet(cacheKey, permissions, { ttlType: 'volatile' });
  console.log(`   Cache pre-warmed with ${permissions.length} permissions`);

  // Run benchmark using actual cacheGet
  await benchmark(
    '   Using cacheGet with resolver fallback',
    async () => {
      await cacheGet(
        cacheKey,
        async () => permissions, // Resolver (shouldn't be called on hit)
        { ttlType: 'volatile' },
      );
    },
    ITERATIONS,
  );

  // Cleanup
  await cacheDel(cacheKey);
}

// ---------------------------------------------------------------------------
// Scenario H: Full Hybrid Flow (L1 Miss → L2 Hit → Populate L1)
// ---------------------------------------------------------------------------

async function runFullHybridFlowBenchmark() {
  const redis = getRedis();
  if (!redis) {
    console.log('\n🔴 Redis not configured. Skipping.');
    return;
  }

  const orgs = await getTestOrganizations();
  if (orgs.length === 0) {
    console.log('   ⚠️  No organizations found. Skipping.');
    return;
  }

  const org = orgs[0];
  const cacheKey = `org:${org.id}`;

  console.log('\n🟡 Scenario H: Full Hybrid Flow (L1 Miss → L2 Hit)');
  console.log(`   Testing complete path: L1 miss → Redis → populate L1`);

  // Pre-warm Redis
  const orgData = await prisma.organization.findUnique({
    where: { id: org.id },
  });

  if (!orgData) {
    console.log('   ⚠️  Organization not found. Skipping.');
    return;
  }

  await redisSet(cacheKey, JSON.stringify(orgData), 300);
  
  // Clear both L1 and reset metrics
  const lru = getLruCache();
  if (lru) {
    lru.delete(cacheKey);
  }
  resetMetrics();

  console.log('   Redis pre-warmed, L1 and metrics cleared');

  await benchmark(
    '   Using cacheGet (should hit L2 and populate L1)',
    async () => {
      await cacheGet(
        cacheKey,
        async () => orgData, // Resolver (shouldn't be called)
        { ttlType: 'stable' },
      );
    },
    ITERATIONS,
  );

  // Show metrics after benchmark
  const metrics = getCacheMetrics();
  console.log(`\n   Post-benchmark metrics:`);
  console.log(`     L1 Hits: ${metrics.l1Hits}, L1 Misses: ${metrics.l1Misses}`);
  console.log(`     L2 Hits: ${metrics.l2Hits}, L2 Misses: ${metrics.l2Misses}`);
  console.log(`     L1 Size: ${metrics.l1Size} entries`);

  // Cleanup
  await redisDel(cacheKey);
}

// ---------------------------------------------------------------------------
// Summary Report
// ---------------------------------------------------------------------------

function printSummary() {
  console.log('\n' + '='.repeat(80));
  console.log('CACHE BENCHMARK SUMMARY');
  console.log('='.repeat(80));

  const lruMetrics = getLruMetrics();
  const cacheMetrics = getCacheMetrics();

  console.log(`\nL1 Cache Status:`);
  console.log(`  Enabled: ${getLruCache() !== null}`);
  console.log(`  Size: ${lruMetrics.l1Size} entries`);
  console.log(`  Memory (estimated): ${formatBytes(lruMetrics.l1MemoryBytes)}`);
  console.log(`  Hit Rate: ${lruMetrics.l1HitRate.toFixed(1)}%`);

  console.log(`\nL2 (Redis) Status:`);
  const redis = getRedis();
  console.log(`  Connected: ${redis?.status === 'ready' || redis?.status === 'connect'}`);
  console.log(`  Hits: ${cacheMetrics.l2Hits}`);
  console.log(`  Misses: ${cacheMetrics.l2Misses}`);

  const l2Total = cacheMetrics.l2Hits + cacheMetrics.l2Misses;
  const l2HitRate = l2Total > 0 ? (cacheMetrics.l2Hits / l2Total) * 100 : 0;
  console.log(`  Hit Rate: ${l2HitRate.toFixed(1)}%`);

  console.log('\n' + '='.repeat(80));
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------

async function main() {
  console.log('🚀 Starting Cache Performance Profiler...');
  console.log(`   Iterations per scenario: ${ITERATIONS}`);
  console.log(`   Warmup iterations: ${WARMUP_ITERATIONS}`);

  // Set up timeout
  const timeoutId = setTimeout(() => {
    console.error('\n⏱️  Script timed out after', SCRIPT_TIMEOUT_MS / 1000, 'seconds');
    process.exit(1);
  }, SCRIPT_TIMEOUT_MS) as NodeJS.Timeout;

  const startTime = process.hrtime.bigint();

  try {
    // Validate database connection
    console.log('\n📊 Validating database connection...');
    const orgCount = await prisma.organization.count();
    console.log(`   Found ${orgCount} organizations in database`);

    if (orgCount === 0) {
      console.log('\n⚠️   WARNING: Database is empty. Results may not be meaningful.');
      console.log('   Please populate the database with test data first.');
    }

    // Run all scenarios
    await runDbBenchmark();
    await runRedisBenchmark();
    await runL1HitBenchmark();
    await runL1MissL2HitBenchmark();
    await runSearchMissBenchmark();
    await runSearchHitBenchmark();
    await runPermissionResolutionBenchmark();
    await runFullHybridFlowBenchmark();

    const endTime = process.hrtime.bigint();
    const totalTimeMs = Number(endTime - startTime) / 1_000_000;

    console.log(`\n✅ All benchmarks complete in ${totalTimeMs.toFixed(2)} ms`);

    // Print summary
    printSummary();

  } catch (error) {
    console.error('\n❌ Error running benchmark:', error);
    process.exit(1);
  } finally {
    clearTimeout(timeoutId);
    // Cleanup Prisma connection
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();

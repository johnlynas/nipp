/**
 * Next.js Instrumentation Hook
 * 
 * This file is the entry point for the application lifecycle. It runs before
 * the server starts handling requests, making it the ideal place to perform
 * environment variable validation and cache warming.
 */

// Import env at the very top to trigger Zod validation immediately on startup.
// If any required environment variable is missing or malformed, the application
// will fail fast with a clear error message before accepting traffic.
import '@/lib/env';

/**
 * Node.js-only bootstrap: L1 cache warming + payload-key cleanup scheduler.
 *
 * These modules pull in Node built-ins (pg/ioredis via the Prisma client;
 * crypto via lib/crypto-server) and must NEVER load on the Edge runtime —
 * Next 16's Turbopack bundles instrumentation.ts into edge/proxy chunks, so
 * any static import here executes in proxy workers too. The dynamic imports
 * are only evaluated when NEXT_RUNTIME is 'nodejs' (the documented guard for
 * targeting one runtime), which keeps them out of the edge bundle entirely —
 * replacing the role the legacy webpack() externals block played on Next 15.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Warm the L1 cache on startup — only runs once per server process.
  const [{ warmCache }, { startKeyCleanupScheduler }] = await Promise.all([
    import('@/lib/cache/warm'),
    import('@/lib/payload-key-server'),
  ]);

  warmCache().catch((err) => {
    console.error('[Instrumentation] Cache warming failed:', err);
  });

  // Start the payload key cleanup scheduler during application bootstrap.
  startKeyCleanupScheduler();
}

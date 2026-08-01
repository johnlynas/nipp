/**
 * Cache Stampede Protection (Single-Flight Deduplication)
 *
 * Prevents cache stampedes by deduplicating concurrent misses on the same key.
 * When multiple requests miss the cache simultaneously, only one underlying
 * resolver is executed; all waiting callers share its result.
 */

// In-flight promises keyed by cache key
const inflight = new Map<string, Promise<unknown>>();

/**
 * Get a cached value or resolve it via the provided resolver.
 * If multiple callers request the same key simultaneously, only one
 * resolver invocation is executed and all callers await its result.
 *
 * @param key - The cache key
 * @param resolver - Function that resolves the value on a cache miss
 * @returns The cached or resolved value, or null if resolution fails
 */
export async function getOrSet<T>(
  key: string,
  resolver: () => Promise<T>,
): Promise<T | null> {
  // Check if there's already an in-flight promise for this key
  const existing = inflight.get(key);
  if (existing) {
    return existing as T;
  }

  // Create the resolver promise and store it
  const promise = resolver().finally(() => {
    // Clean up the in-flight entry once resolved or rejected
    inflight.delete(key);
  });

  inflight.set(key, promise);

  try {
    return await promise;
  } catch {
    // If resolution failed, the .finally() already cleaned up.
    // Return null to signal a cache miss.
    return null;
  }
}

/**
 * Get the number of currently in-flight resolutions (for testing/monitoring).
 */
export function getInflightCount(): number {
  return inflight.size;
}

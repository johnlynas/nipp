/**
 * Next.js Instrumentation Hook
 * 
 * This file is the entry point for the application lifecycle. It runs before
 * the server starts handling requests, making it the ideal place to perform
 * environment variable validation.
 */

// Import env at the very top to trigger Zod validation immediately on startup.
// If any required environment variable is missing or malformed, the application
// will fail fast with a clear error message before accepting traffic.
import '@/lib/env';

export default function instrumentation() {
  return {};
}

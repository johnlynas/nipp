/**
 * Vitest config for the DATABASE-LAYER RLS isolation suite.
 *
 * Kept separate from vitest.config.ts on purpose:
 *   - specs are named `*.spec.ts` (they exercise a real Postgres, not unit mocks)
 *   - they must NEVER run inside the mock-based unit suite (`npm test`) —
 *     so the main config excludes tests/isolation/database/**
 * Run with:  npm run test:isolation:db
 * Requires a reachable owner DSN (DATABASE_URL) + NIPP_APP_DB_PASSWORD.
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  plugins: [],
  test: {
    globals: true,
    include: ['tests/isolation/database/**/*.spec.ts'],
    // Each spec recreates its scratch DB in beforeAll — run files serially to
    // avoid concurrent drop/create of the same database name.
    fileParallelism: false,
    hookTimeout: 300_000,
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});

import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Integration tests connect to a real Postgres (nipp_dev via .env.test).
  // Vitest does not load shell env — without this, DATABASE_URL is unset and
  // lib/env.ts falls back to its bogus `test:test@localhost/test` fixture URL.
  envDir: '.',
  dotenv: { path: ['.env.test'], quiet: true },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.d.ts',
        '**/types.ts',
      ],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: [
      'tests/isolation/e2e/payload-encryption-browser.test.ts',
      // DB-layer RLS specs own their scratch DB (prepareDatabase) and need a
      // real Postgres — run them via `npm run test:isolation:db`, never as part
      // of the mock-based unit suite.
      'tests/isolation/database/**',
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
});

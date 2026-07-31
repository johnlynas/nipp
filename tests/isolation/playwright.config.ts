import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for isolation testing.
 *
 * Runs against a live Next.js server with real PostgreSQL + pgbouncer.
 */
export default defineConfig({
  testDir: './e2e',

  // Timeout per test (30s for full auth + navigation flows)
  timeout: 30_000,

  // Retry flaky tests once
  retries: 1,

  // Parallel workers
  workers: 4,

  // Reporter
  reporter: process.env.CI ? [['html', { outputFolder: 'playwright-report' }]] : [['list']],

  use: {
    baseURL: 'http://localhost:3000',

    // Collect trace on failure
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Use Chromium (fastest for E2E)
    browserName: 'chromium',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Global setup/teardown hooks for DB management
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
});

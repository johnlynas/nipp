/**
 * Global teardown for Playwright isolation tests.
 */

import * as fs from 'fs';
import * as path from 'path';

export default async function globalTeardown() {
  // Kill the dev server if we started it
  const child = (globalThis as unknown as Record<string, unknown>).__testServerProcess;
  if (child && typeof child === 'object' && 'kill' in child) {
    (child as import('child_process').ChildProcess).kill();
  }

  // Restore .env if we renamed it during setup
  // __dirname is tests/isolation/e2e → go up 3 levels to project root
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const envBackupPath = path.join(projectRoot, '.env.backup');
  const envPathReal = path.join(projectRoot, '.env');
  if (fs.existsSync(envBackupPath)) {
    fs.renameSync(envBackupPath, envPathReal);
  }
}

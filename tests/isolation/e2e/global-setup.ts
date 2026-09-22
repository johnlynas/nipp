/**
 * Global setup for Playwright isolation tests.
 *
 * Ensures the Next.js dev server is running with .env.test before tests execute.
 */

import { spawn } from 'child_process';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const MAX_WAIT_MS = 120_000; // 2 minutes max for server startup
const POLL_INTERVAL_MS = 2_000;

/**
 * Parse a .env file into an object of key-value pairs.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Remove surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/**
 * Expand ${VAR} references — .env.test is shell-style (sourced by
 * setup-test-env.sh) so its DSNs reference POSTGRES_PORT etc. The Playwright
 * path never sources the file, so expand against the file's own vars plus
 * process.env.
 */
function resolveEnvVars(env: Record<string, string>): void {
  for (const key of Object.keys(env)) {
    let value = env[key];
    // Bounded loop guards against self-referential expansion loops.
    for (let i = 0; i < 5 && /\$\{[^}]+\}/.test(value); i++) {
      value = value.replace(/\$\{([^}]+)\}/g, (_, name: string) => env[name] ?? process.env[name] ?? '');
    }
    env[key] = value;
  }
}

/**
 * Wait for the Next.js dev server to become reachable.
 */
async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(url, (res) => {
          res.destroy();
          if (res.statusCode === 200 || res.statusCode === 307) {
            resolve();
          } else {
            reject(new Error(`Unexpected status: ${res.statusCode}`));
          }
        });
        req.on('error', reject);
        req.setTimeout(3000, () => {
          req.destroy();
          reject(new Error('Connection timeout'));
        });
      });

      console.log(`✅ Next.js server is reachable at ${url}`);
      return;
    } catch {
      // Server not ready yet — keep polling
    }

    if (Date.now() - startTime > timeoutMs) {
      throw new Error(
        `Timed out waiting for server at ${url} after ${timeoutMs / 1000}s`
      );
    }

    console.log(`⏳ Waiting for server at ${url}...`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`Server at ${url} did not become ready in time`);
}

export default async function globalSetup() {
  // Always start a fresh server with .env.test for test isolation.
  // Only kill existing Next.js if it's not already using .env.test
  const { execSync } = await import('child_process');
  try {
    // Check if any next dev process is running
    const psOutput = execSync('ps aux | grep "next dev" | grep -v grep', { encoding: 'utf-8' }).trim();
    if (psOutput) {
      // Kill it so we can start fresh with .env.test
      execSync('pkill -f "next dev"', { stdio: 'ignore' });
      await new Promise((r) => setTimeout(r, 2000)); // Wait for port to free up
    }
  } catch {
    // No existing process — fine
  }

  console.log('⚠️  Starting Next.js dev server with .env.test...');

  // __dirname is tests/isolation/e2e → go up 3 levels to project root
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  const envPath = path.join(projectRoot, '.env.test');

  // Load .env.test values (and expand its ${VAR} references, since this path
  // does not source the file through a shell).
  const envVars = fs.existsSync(envPath) ? parseEnvFile(envPath) : {};
  resolveEnvVars(envVars);

  // Seed the test database before starting the dev server.
  // This ensures tenant users and super admin exist with correct credentials.
  console.log('🌱 Seeding test database...');
  try {
    execSync(`npx tsx prisma/seed.ts`, {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: envVars.DATABASE_URL || process.env.DATABASE_URL,
        // The seed performs DDL (RLS bootstrap) — it MUST connect as owner.
        // SEED_RLS_DSN carries the owner DSN (see .env.test comments); NIPP_APP_DB_PASSWORD
        // is what the bootstrap sets on the nipp_app role, so the app DSN works after.
        SEED_RLS_DSN: envVars.SEED_RLS_DSN || process.env.SEED_RLS_DSN,
        NIPP_APP_DB_PASSWORD: envVars.NIPP_APP_DB_PASSWORD || process.env.NIPP_APP_DB_PASSWORD || '',
        ADMIN_EMAIL: envVars.ADMIN_EMAIL || envVars.TEST_ADMIN_EMAIL || '',
        ADMIN_PASSWORD: envVars.ADMIN_PASSWORD || envVars.TEST_ADMIN_PASSWORD || '',
        TEST_ADMIN_EMAIL: envVars.TEST_ADMIN_EMAIL || '',
        TEST_ADMIN_PASSWORD: envVars.TEST_ADMIN_PASSWORD || '',
        TEST_TENANT_A_EMAIL: envVars.TEST_TENANT_A_EMAIL || '',
        TEST_TENANT_A_PASSWORD: envVars.TEST_TENANT_A_PASSWORD || '',
        TEST_TENANT_B_EMAIL: envVars.TEST_TENANT_B_EMAIL || '',
        TEST_TENANT_B_PASSWORD: envVars.TEST_TENANT_B_PASSWORD || '',
      },
    });
  } catch (seedError) {
    console.warn('⚠️  Seed failed (continuing anyway):', seedError);
  }

  // The seed persists the just-created Platform org id into .env (see
  // persistPlatformOrgIdToEnv in prisma/seed.ts). RLS platform-admin gating is
  // fail-closed without it, so hand it to the spawned dev server.
  let platformOrgId: string | null = null;
  try {
    const dotEnv = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8');
    const m = dotEnv.match(/^PLATFORM_ORGANIZATION_ID=["']?([^"'\s]+)/m);
    if (m) platformOrgId = m[1];
  } catch { /* no .env — env var must come from the environment */ }

  // Rename .env temporarily so Next.js only loads .env.test (which has test DB URL)
  // Next.js loads env files in order: .env.local, .env.test.local, .env.test, .env
  // So .env would override .env.test — we rename it to prevent that.
  const envBackupPath = path.join(projectRoot, '.env.backup');
  const envPathReal = path.join(projectRoot, '.env');

  console.log(`📂 Project root: ${projectRoot}`);
  console.log(`📂 .env exists: ${fs.existsSync(envPathReal)}`);
  if (fs.existsSync(envPathReal)) {
    fs.renameSync(envPathReal, envBackupPath);
  }

  // Start via npx next dev directly (not npm run dev which adds overhead)
  const child = spawn('npx', ['next', 'dev'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      ...envVars,
      ...(platformOrgId ? { PLATFORM_ORGANIZATION_ID: platformOrgId } : {}),
    },
  });

  child.stdout?.on('data', (data) => {
    process.stderr.write(`  ${data}`);
  });
  child.stderr?.on('data', (data) => {
    process.stderr.write(`  ${data}`);
  });

  // Wait for server to become reachable (with timeout)
  await waitForServer(BASE_URL, MAX_WAIT_MS);

  // Store child process reference for teardown
  (globalThis as unknown as Record<string, unknown>).__testServerProcess = child;
}

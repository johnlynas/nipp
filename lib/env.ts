import { envSchema, type Env } from './env-schema';

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    const issues = result.error.issues || [];
    issues.forEach((err) => {
      console.error(`   - ${err.path.join('.')}: ${err.message}`);
    });
    console.error('\n📝 Copy .env.example to .env and fill in the required values.');

    // Unconditionally throw to halt the build and satisfy TypeScript.
    // (This function is only called when NODE_ENV !== 'test' anyway)
    throw new Error('Environment validation failed');
  }

  return result.data;
}

function testEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (result.success) return result.data;

  return envSchema.parse({
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    PGBOUNCER_PASSWORD: 'test',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    PII_ENCRYPTION_KEY: 'a'.repeat(64),
    NODE_ENV: 'test',
    PAYLOAD_ENCRYPTION_MODE: 'disabled',
    PAYLOAD_ENCRYPTION_MAX_BYTES: '65536',
    PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS: '300',
    PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: '30',
    PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS: '60',
    PAYLOAD_ENCRYPTION_REPLAY_CACHE: 'redis',
    PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: 'false',
    PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: '10',
    // RLS Phase 3: platform ops are fail-closed without a platform org id.
    // Deterministic test fixture (cuid-shaped); individual tests that need a
    // specific value mock lib/platform-db directly.
    PLATFORM_ORGANIZATION_ID: 'ctestplatformorg000000000',
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ),
  });
}

export const env: Env = process.env.NODE_ENV === 'test'
  ? testEnv()
  : validateEnv();

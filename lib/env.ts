import { z } from 'zod';

/**
 * Zod-based environment variable validation.
 *
 * Validates all required environment variables at application startup (fail-fast).
 * Missing or malformed variables cause the application to exit immediately.
 */

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  // BetterAuth
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  // Google OIDC
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required when using Google OIDC'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required when using Google OIDC'),

  // PII Encryption
  PII_ENCRYPTION_KEY: z.string().min(64, 'PII_ENCRYPTION_KEY must be a 32-byte hex string (64 chars)'),

  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // URLs
  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL must be a valid URL').default('http://localhost:3000'),
});

/**
 * Validate environment variables and return typed config.
 * Exits the process with a clear error message if validation fails.
 */
export function validateEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Environment validation failed:');
    // Zod v4 uses 'issues' instead of 'errors'
    const issues = (result.error as any).issues || [];
    issues.forEach((err: { path: string[]; message: string }) => {
      // eslint-disable-next-line no-console
      console.error(`   - ${err.path.join('.')}: ${err.message}`);
    });
    // eslint-disable-next-line no-console
    console.error('\n📝 Copy .env.example to .env and fill in the required values.');
    process.exit(1);
  }

  return result.data;
}

// Validate immediately on import (fail-fast at startup)
export const env = validateEnv();

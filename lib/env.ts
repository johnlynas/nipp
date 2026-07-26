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
  PGBOUNCER_PASSWORD: z.string().min(1, 'PGBOUNCER_PASSWORD is required when using PgBouncer'),

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

  // Redis — optional, used for permission caching
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional().default('redis://localhost:6379'),

  // Platform Organization — optional, generated on first seed
  PLATFORM_ORGANIZATION_ID: z.string().cuid().optional(),

  // SMTP — Email notifications for extreme events
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@nipp.gov.uk'),

  // Super Admin fallback email (used only if DB lookup fails)
  SUPER_ADMIN_EMAIL: z.string().optional(),

  // Trusted proxy CIDRs for BetterAuth IP resolution (S2+S3)
  // When set, BetterAuth strips these IPs from the x-forwarded-for chain
  // to find the real client IP behind a reverse proxy/load balancer.
  TRUSTED_PROXY_CIDRS: z.string().optional(),
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
    
    // Only exit the process if we are NOT in a testing environment
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
  }

  return result.data;
}

// Validate immediately on import (fail-fast)
// In test mode, we skip immediate validation to allow tests to run without a full .env
export const env = process.env.NODE_ENV === 'test' 
  ? (process.env as any) 
  : validateEnv();

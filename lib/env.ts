import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),
  PGBOUNCER_PASSWORD: z.string().min(1, 'PGBOUNCER_PASSWORD is required when using PgBouncer'),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID is required when using Google OIDC'),
  GOOGLE_CLIENT_SECRET: z.string().min(1, 'GOOGLE_CLIENT_SECRET is required when using Google OIDC'),

  PII_ENCRYPTION_KEY: z.string().min(64, 'PII_ENCRYPTION_KEY must be a 32-byte hex string (64 chars)'),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  FRONTEND_URL: z.string().url('FRONTEND_URL must be a valid URL').default('http://localhost:3000'),
  NEXT_PUBLIC_API_URL: z.string().url('NEXT_PUBLIC_API_URL must be a valid URL').default('http://localhost:3000'),

  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string').optional().default('redis://localhost:6379'),

  PLATFORM_ORGANIZATION_ID: z.string().cuid().optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@nipp.gov.uk'),

  SUPER_ADMIN_EMAIL: z.string().optional(),

  TRUSTED_PROXY_CIDRS: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Environment validation failed:');
    const issues = (result.error as { issues?: Array<{ path: string[]; message: string }> }).issues || [];
    issues.forEach((err: { path: string[]; message: string }) => {
      console.error(`   - ${err.path.join('.')}: ${err.message}`);
    });
    console.error('\n📝 Copy .env.example to .env and fill in the required values.');

    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }

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
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined)
    ),
  });
}

export const env: Env = process.env.NODE_ENV === 'test'
  ? testEnv()
  : validateEnv();
import { z } from 'zod';

export const envSchema = z.object({
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

  // L1 Cache Configuration
  ENABLE_L1_CACHE: z.enum(['true', 'false']).default('true'),
  L1_CACHE_MAX_ENTRIES: z.string().regex(/^\d+$/).optional(),
  L1_CACHE_TTL_MS: z.string().regex(/^\d+$/).optional(),

  PLATFORM_ORGANIZATION_ID: z.string().cuid().optional(),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@nipp.gov.uk'),

  SUPER_ADMIN_EMAIL: z.string().optional(),

  TRUSTED_PROXY_CIDRS: z.string().optional(),

  INACTIVITY_TIMEOUT_MINS: z.string().regex(/^\d+$/).default('15').transform(Number),

  // Payload Encryption Configuration
  PAYLOAD_ENCRYPTION_MODE: z.enum(['disabled', 'permissive', 'enforce']).default('disabled'),
  PAYLOAD_ENCRYPTION_MAX_BYTES: z.string().regex(/^\d+$/).default('65536').transform(Number),
  PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS: z.string().regex(/^\d+$/).default('300').transform(Number),
  PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: z.string().regex(/^\d+$/).default('30').transform(Number),
  PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS: z.string().regex(/^\d+$/).default('60').transform(Number),

  // Replay cache backend selection: 'memory' or 'redis'
  PAYLOAD_ENCRYPTION_REPLAY_CACHE: z.enum(['memory', 'redis']).default('redis'),

  // Fail closed if replay cache is unavailable (enforce mode only)
  PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: z.enum(['true', 'false']).default('false'),

  // Maximum number of active payload keys per session (enforces eviction)
  PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: z.string().regex(/^\d+$/).default('10').transform(Number),

  // ---------------------------------------------------------------------------
  // Rate Limiting Configuration
  // All values are optional — sensible defaults apply when not set.
  // ---------------------------------------------------------------------------

  /** Payload key issuance: max requests per window (default 30). */
  RATE_LIMIT_PAYLOAD_KEY_MAX: z.string().regex(/^\d+$/).optional(),

  /** Payload key issuance: window duration in seconds (default 60). */
  RATE_LIMIT_PAYLOAD_KEY_WINDOW: z.string().regex(/^\d+$/).optional(),

  /** Payload key revocation: max requests per window (default 5). */
  RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX: z.string().regex(/^\d+$/).optional(),

  /** Payload key revocation: window duration in seconds (default 60). */
  RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW: z.string().regex(/^\d+$/).optional(),

  /** Notification dispatcher: max notifications per event type/recipient/window (default 5). */
  RATE_LIMIT_NOTIFICATION_MAX: z.string().regex(/^\d+$/).optional(),

  /** Notification dispatcher: window duration in hours (default 24). */
  RATE_LIMIT_NOTIFICATION_WINDOW_HOURS: z.string().regex(/^\d+$/).optional(),

  // ---------------------------------------------------------------------------
  // Auth endpoint rate limiting (by IP address, stricter)
  // ---------------------------------------------------------------------------

  /** Login/register: max requests per window (default 5). */
  RATE_LIMIT_AUTH_MAX: z.string().regex(/^\d+$/).optional(),

  /** Login/register: window duration in seconds (default 60). */
  RATE_LIMIT_AUTH_WINDOW: z.string().regex(/^\d+$/).optional(),

  // ---------------------------------------------------------------------------
  // Admin write rate limiting (by session ID)
  // ---------------------------------------------------------------------------

  /** Admin POST/PATCH/DELETE: max requests per window (default 30). */
  RATE_LIMIT_ADMIN_MAX: z.string().regex(/^\d+$/).optional(),

  /** Admin POST/PATCH/DELETE: window duration in seconds (default 60). */
  RATE_LIMIT_ADMIN_WINDOW: z.string().regex(/^\d+$/).optional(),

  // ---------------------------------------------------------------------------
  // Calendar CRUD rate limiting (by session ID)
  // ---------------------------------------------------------------------------

  /** Calendar POST/PATCH/DELETE: max requests per window (default 30). */
  RATE_LIMIT_CALENDAR_MAX: z.string().regex(/^\d+$/).optional(),

  /** Calendar POST/PATCH/DELETE: window duration in seconds (default 60). */
  RATE_LIMIT_CALENDAR_WINDOW: z.string().regex(/^\d+$/).optional(),

   // ---------------------------------------------------------------------------
   // Background Job Scheduler (job-scheduler-service / Bree — platform-org only)
   // ---------------------------------------------------------------------------

   /** Master on/off for the job scheduler engine. */
  JOB_SCHEDULER_ENABLED: z.enum(['true', 'false']).default('true'),

   /** Default IANA timezone for schedules (default 'Europe/London'). */
  JOB_SCHEDULER_TIMEZONE: z.string().default('Europe/London'),

   /**
    * Runtime circuit-breaker cap on simultaneous job runs (default 5). Consumed by
    * `lib/job-scheduler-concurrency.ts`: the global semaphore is sized at
    * `max(MAX_CONCURRENT, DB_CONCURRENCY, 1)`, so this bounds live runs / forked
    * workers. A tick with N due jobs enqueues N runs and releases one slot per
    * completed run.
    */
   JOB_SCHEDULER_MAX_CONCURRENT: z.string().regex(/^\d+$/).default('5'),

   /**
    * Connection-pool ceiling — sized BELOW PgBouncer `max_client_conn` so the
    * scheduler coexists with other app connections (default 100). The breaker uses
    * it as a floor the runtime cap may not undercut: with DEFAULT (100) >
    * MAX_CONCURRENT (5) the pool ceiling is the binding bound in the usual case,
    * keeping concurrent in-process Prisma clients well under capacity.
    */
   JOB_SCHEDULER_DB_CONCURRENCY: z.string().regex(/^\d+$/).default('100'),

   /** Per-job default concurrency limit (default 1). */
  JOB_SCHEDULER_DEFAULT_CONCURRENCY: z.string().regex(/^\d+$/).default('1'),

   /** Per-job default wall-clock cap in ms (default 300000 = 5 min). */
  JOB_SCHEDULER_DEFAULT_TIMEOUT_MS: z.string().regex(/^\d+$/).default('300000'),

   /** Load enabled jobs from the DB at boot (default true). */
  JOB_SCHEDULER_BOOT_REGISTRY: z.enum(['true', 'false']).default('true'),

   /** New jobs default to dry-run until approved (Phase 2; default false). */
   JOB_SCHEDULER_DRYRUN_DEFAULT: z.enum(['true', 'false']).default('false'),

   /**
    * Execution path for due jobs: `worker` = Bree fork-per-run (Phase 2,
    * worker isolation for untrusted-script readiness); `inline` = main-thread
    * scanner runs runJob directly (Phase 1 fallback/rollback). Default:
    * worker.
    */
   JOB_SCHEDULER_BREE_MODE: z.enum(['worker', 'inline']).default('worker'),
   });

export type Env = z.infer<typeof envSchema>;

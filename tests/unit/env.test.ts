/**
 * Comprehensive unit tests for environment validation (lib/env.ts)
 */

import { describe, it, expect } from 'vitest';
import { envSchema } from '../../lib/env-schema';
import type { Env } from '../../lib/env-schema';

describe('Environment Schema Validation', () => {
  const validBaseEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    PGBOUNCER_PASSWORD: 'password123',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
    PII_ENCRYPTION_KEY: 'a'.repeat(64),
  };

  describe('Required Fields', () => {
    it('should accept a valid environment with all required fields', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
    });

    it('should reject missing DATABASE_URL', () => {
      const env = { ...validBaseEnv };
      delete (env as any).DATABASE_URL;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('DATABASE_URL'))).toBe(true);
      }
    });

    it('should reject invalid DATABASE_URL (not a URL)', () => {
      const env = { ...validBaseEnv, DATABASE_URL: 'not-a-url' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('DATABASE_URL'))).toBe(true);
      }
    });

    it('should accept valid PostgreSQL connection string', () => {
      const env = { ...validBaseEnv, DATABASE_URL: 'postgres://user:pass@host:5432/db' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should reject missing PGBOUNCER_PASSWORD', () => {
      const env = { ...validBaseEnv };
      delete (env as any).PGBOUNCER_PASSWORD;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('PGBOUNCER_PASSWORD'))).toBe(true);
      }
    });

    it('should reject empty PGBOUNCER_PASSWORD', () => {
      const env = { ...validBaseEnv, PGBOUNCER_PASSWORD: '' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject missing BETTER_AUTH_SECRET', () => {
      const env = { ...validBaseEnv };
      delete (env as any).BETTER_AUTH_SECRET;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('BETTER_AUTH_SECRET'))).toBe(true);
      }
    });

    it('should reject BETTER_AUTH_SECRET shorter than 32 characters', () => {
      const env = { ...validBaseEnv, BETTER_AUTH_SECRET: 'a'.repeat(31) };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should accept BETTER_AUTH_SECRET with exactly 32 characters', () => {
      const env = { ...validBaseEnv, BETTER_AUTH_SECRET: 'a'.repeat(32) };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should reject missing GOOGLE_CLIENT_ID', () => {
      const env = { ...validBaseEnv };
      delete (env as any).GOOGLE_CLIENT_ID;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('GOOGLE_CLIENT_ID'))).toBe(true);
      }
    });

    it('should reject empty GOOGLE_CLIENT_ID', () => {
      const env = { ...validBaseEnv, GOOGLE_CLIENT_ID: '' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject missing GOOGLE_CLIENT_SECRET', () => {
      const env = { ...validBaseEnv };
      delete (env as any).GOOGLE_CLIENT_SECRET;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('GOOGLE_CLIENT_SECRET'))).toBe(true);
      }
    });

    it('should reject missing PII_ENCRYPTION_KEY', () => {
      const env = { ...validBaseEnv };
      delete (env as any).PII_ENCRYPTION_KEY;
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(issue => issue.path.includes('PII_ENCRYPTION_KEY'))).toBe(true);
      }
    });

    it('should reject PII_ENCRYPTION_KEY shorter than 64 characters', () => {
      const env = { ...validBaseEnv, PII_ENCRYPTION_KEY: 'a'.repeat(63) };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should accept PII_ENCRYPTION_KEY with exactly 64 characters', () => {
      const env = { ...validBaseEnv, PII_ENCRYPTION_KEY: 'a'.repeat(64) };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });
  });

  describe('NODE_ENV', () => {
    it('should default to "development" when not provided', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
      }
    });

    it('should accept "development"', () => {
      const env = { ...validBaseEnv, NODE_ENV: 'development' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('development');
      }
    });

    it('should accept "production"', () => {
      const env = { ...validBaseEnv, NODE_ENV: 'production' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('production');
      }
    });

    it('should accept "test"', () => {
      const env = { ...validBaseEnv, NODE_ENV: 'test' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('test');
      }
    });

    it('should reject invalid NODE_ENV values', () => {
      const env = { ...validBaseEnv, NODE_ENV: 'staging' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('LOG_LEVEL', () => {
    it('should default to "info" when not provided', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_LEVEL).toBe('info');
      }
    });

    it('should accept "debug"', () => {
      const env = { ...validBaseEnv, LOG_LEVEL: 'debug' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_LEVEL).toBe('debug');
      }
    });

    it('should accept "warn"', () => {
      const env = { ...validBaseEnv, LOG_LEVEL: 'warn' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_LEVEL).toBe('warn');
      }
    });

    it('should accept "error"', () => {
      const env = { ...validBaseEnv, LOG_LEVEL: 'error' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.LOG_LEVEL).toBe('error');
      }
    });

    it('should reject invalid LOG_LEVEL values', () => {
      const env = { ...validBaseEnv, LOG_LEVEL: 'verbose' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('URL Fields', () => {
    it('should accept valid FRONTEND_URL', () => {
      const env = { ...validBaseEnv, FRONTEND_URL: 'https://example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.FRONTEND_URL).toBe('https://example.com');
      }
    });

    it('should default FRONTEND_URL to "http://localhost:3000"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.FRONTEND_URL).toBe('http://localhost:3000');
      }
    });

    it('should reject invalid FRONTEND_URL', () => {
      const env = { ...validBaseEnv, FRONTEND_URL: 'not-a-url' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should accept valid NEXT_PUBLIC_API_URL', () => {
      const env = { ...validBaseEnv, NEXT_PUBLIC_API_URL: 'https://api.example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should default NEXT_PUBLIC_API_URL to "http://localhost:3000"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000');
      }
    });

    it('should accept valid REDIS_URL', () => {
      const env = { ...validBaseEnv, REDIS_URL: 'redis://localhost:6379' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
      }
    });

    it('should default REDIS_URL to "redis://localhost:6379"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
      }
    });

    it('should reject invalid REDIS_URL', () => {
      const env = { ...validBaseEnv, REDIS_URL: 'not-a-redis-url' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('L1 Cache Configuration', () => {
    it('should default ENABLE_L1_CACHE to "true"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ENABLE_L1_CACHE).toBe('true');
      }
    });

    it('should accept ENABLE_L1_CACHE as "false"', () => {
      const env = { ...validBaseEnv, ENABLE_L1_CACHE: 'false' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ENABLE_L1_CACHE).toBe('false');
      }
    });

    it('should reject invalid ENABLE_L1_CACHE values', () => {
      const env = { ...validBaseEnv, ENABLE_L1_CACHE: 'yes' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should accept numeric string for L1_CACHE_MAX_ENTRIES', () => {
      const env = { ...validBaseEnv, L1_CACHE_MAX_ENTRIES: '1000' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.L1_CACHE_MAX_ENTRIES).toBe('1000');
      }
    });

    it('should reject non-numeric L1_CACHE_MAX_ENTRIES', () => {
      const env = { ...validBaseEnv, L1_CACHE_MAX_ENTRIES: 'abc' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should allow L1_CACHE_MAX_ENTRIES to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.L1_CACHE_MAX_ENTRIES).toBeUndefined();
      }
    });

    it('should accept numeric string for L1_CACHE_TTL_MS', () => {
      const env = { ...validBaseEnv, L1_CACHE_TTL_MS: '60000' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.L1_CACHE_TTL_MS).toBe('60000');
      }
    });

    it('should reject non-numeric L1_CACHE_TTL_MS', () => {
      const env = { ...validBaseEnv, L1_CACHE_TTL_MS: 'one-minute' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('PLATFORM_ORGANIZATION_ID', () => {
    it('should accept valid CUID', () => {
      const env = { ...validBaseEnv, PLATFORM_ORGANIZATION_ID: 'cuid123456789012345' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should reject invalid CUID format', () => {
      const env = { ...validBaseEnv, PLATFORM_ORGANIZATION_ID: 'not-a-cuid!' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should allow PLATFORM_ORGANIZATION_ID to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PLATFORM_ORGANIZATION_ID).toBeUndefined();
      }
    });
  });

  describe('SMTP Configuration', () => {
    it('should default SMTP_HOST to "localhost"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_HOST).toBe('localhost');
      }
    });

    it('should accept custom SMTP_HOST', () => {
      const env = { ...validBaseEnv, SMTP_HOST: 'smtp.example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_HOST).toBe('smtp.example.com');
      }
    });

    it('should default SMTP_PORT to 587', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_PORT).toBe(587);
      }
    });

    it('should accept custom SMTP_PORT and coerce to number', () => {
      const env = { ...validBaseEnv, SMTP_PORT: '465' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_PORT).toBe(465);
        expect(typeof result.data.SMTP_PORT).toBe('number');
      }
    });

    it('should default SMTP_FROM to "noreply@nipp.gov.uk"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_FROM).toBe('noreply@nipp.gov.uk');
      }
    });

    it('should accept custom SMTP_FROM', () => {
      const env = { ...validBaseEnv, SMTP_FROM: 'noreply@example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_FROM).toBe('noreply@example.com');
      }
    });

    it('should allow SMTP_USER to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_USER).toBeUndefined();
      }
    });

    it('should accept SMTP_USER when provided', () => {
      const env = { ...validBaseEnv, SMTP_USER: 'user@example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_USER).toBe('user@example.com');
      }
    });

    it('should allow SMTP_PASS to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_PASS).toBeUndefined();
      }
    });

    it('should accept SMTP_PASS when provided', () => {
      const env = { ...validBaseEnv, SMTP_PASS: 'secret' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_PASS).toBe('secret');
      }
    });
  });

  describe('Optional Fields', () => {
    it('should allow SUPER_ADMIN_EMAIL to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SUPER_ADMIN_EMAIL).toBeUndefined();
      }
    });

    it('should accept SUPER_ADMIN_EMAIL when provided', () => {
      const env = { ...validBaseEnv, SUPER_ADMIN_EMAIL: 'admin@example.com' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SUPER_ADMIN_EMAIL).toBe('admin@example.com');
      }
    });

    it('should allow TRUSTED_PROXY_CIDRS to be optional', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRUSTED_PROXY_CIDRS).toBeUndefined();
      }
    });

    it('should accept TRUSTED_PROXY_CIDRS when provided', () => {
      const env = { ...validBaseEnv, TRUSTED_PROXY_CIDRS: '10.0.0.0/8' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.TRUSTED_PROXY_CIDRS).toBe('10.0.0.0/8');
      }
    });
  });

  describe('Payload Encryption Configuration', () => {
    it('should default PAYLOAD_ENCRYPTION_MODE to "disabled"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MODE).toBe('disabled');
      }
    });

    it('should accept "permissive" mode', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MODE: 'permissive' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MODE).toBe('permissive');
      }
    });

    it('should accept "enforce" mode', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MODE: 'enforce' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MODE).toBe('enforce');
      }
    });

    it('should reject invalid PAYLOAD_ENCRYPTION_MODE', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MODE: 'strict' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should default PAYLOAD_ENCRYPTION_MAX_BYTES to 65536 and transform to number', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MAX_BYTES).toBe(65536);
        expect(typeof result.data.PAYLOAD_ENCRYPTION_MAX_BYTES).toBe('number');
      }
    });

    it('should accept custom PAYLOAD_ENCRYPTION_MAX_BYTES and transform to number', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MAX_BYTES: '131072' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MAX_BYTES).toBe(131072);
      }
    });

    it('should reject non-numeric PAYLOAD_ENCRYPTION_MAX_BYTES', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MAX_BYTES: 'large' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should default PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS to 300 and transform to number', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS).toBe(300);
        expect(typeof result.data.PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS).toBe('number');
      }
    });

    it('should default PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS to 30 and transform to number', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS).toBe(30);
        expect(typeof result.data.PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS).toBe('number');
      }
    });

    it('should default PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS to 60 and transform to number', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS).toBe(60);
        expect(typeof result.data.PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS).toBe('number');
      }
    });

    it('should default PAYLOAD_ENCRYPTION_REPLAY_CACHE to "redis"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_REPLAY_CACHE).toBe('redis');
      }
    });

    it('should accept "memory" for PAYLOAD_ENCRYPTION_REPLAY_CACHE', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_REPLAY_CACHE: 'memory' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_REPLAY_CACHE).toBe('memory');
      }
    });

    it('should reject invalid PAYLOAD_ENCRYPTION_REPLAY_CACHE', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_REPLAY_CACHE: 'database' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should default PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE to "false"', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE).toBe('false');
      }
    });

    it('should accept "true" for PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: 'true' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE).toBe('true');
      }
    });

    it('should reject invalid PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: 'yes' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should default PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION to 10 and transform to number', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION).toBe(10);
        expect(typeof result.data.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION).toBe('number');
      }
    });

    it('should accept custom PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION and transform to number', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: '25' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION).toBe(25);
      }
    });

    it('should reject non-numeric PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION', () => {
      const env = { ...validBaseEnv, PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: 'many' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('INACTIVITY_TIMEOUT_MINS', () => {
    it('should default to 15 when no value is provided', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.INACTIVITY_TIMEOUT_MINS).toBe(15);
      }
    });

    it('should accept "0" and transform to number 0', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: '0' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.INACTIVITY_TIMEOUT_MINS).toBe(0);
      }
    });

    it('should accept "30" and transform to number 30', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: '30' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.INACTIVITY_TIMEOUT_MINS).toBe(30);
      }
    });

    it('should reject non-numeric values', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: 'fifteen' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject negative numbers', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: '-5' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should reject decimal numbers', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: '15.5' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });

    it('should transform to number type', () => {
      const env = { ...validBaseEnv, INACTIVITY_TIMEOUT_MINS: '45' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.INACTIVITY_TIMEOUT_MINS).toBe('number');
      }
    });
  });

  describe('Multiple Validation Errors', () => {
    it('should report all validation errors when multiple fields are invalid', () => {
      const env = {
        DATABASE_URL: 'not-a-url',
        BETTER_AUTH_SECRET: 'short',
        PII_ENCRYPTION_KEY: 'short',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map(issue => issue.path[0]);
        expect(paths).toContain('DATABASE_URL');
        expect(paths).toContain('BETTER_AUTH_SECRET');
        expect(paths).toContain('PII_ENCRYPTION_KEY');
      }
    });

    it('should handle empty environment object', () => {
      const result = envSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Type Coercion and Transformation', () => {
    it('should coerce SMTP_PORT from string to number', () => {
      const env = { ...validBaseEnv, SMTP_PORT: '25' };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.SMTP_PORT).toBe(25);
        expect(typeof result.data.SMTP_PORT).toBe('number');
      }
    });

    it('should transform numeric strings to numbers for timeout fields', () => {
      const env = {
        ...validBaseEnv,
        INACTIVITY_TIMEOUT_MINS: '20',
        PAYLOAD_ENCRYPTION_MAX_BYTES: '131072',
        PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS: '600',
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: '60',
        PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS: '120',
        PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: '50',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(typeof result.data.INACTIVITY_TIMEOUT_MINS).toBe('number');
        expect(typeof result.data.PAYLOAD_ENCRYPTION_MAX_BYTES).toBe('number');
        expect(typeof result.data.PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS).toBe('number');
        expect(typeof result.data.PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS).toBe('number');
        expect(typeof result.data.PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS).toBe('number');
        expect(typeof result.data.PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION).toBe('number');
      }
    });
  });

  describe('Edge Cases', () => {
    it('should accept very long strings for text fields', () => {
      const env = {
        ...validBaseEnv,
        BETTER_AUTH_SECRET: 'a'.repeat(1000),
        PII_ENCRYPTION_KEY: 'a'.repeat(1000),
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should accept special characters in strings where allowed', () => {
      const env = {
        ...validBaseEnv,
        PGBOUNCER_PASSWORD: 'p@ssw0rd!#$%',
        SMTP_USER: 'user+tag@example.com',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 192.168.0.0/16',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should handle null values for optional fields', () => {
      const env = {
        ...validBaseEnv,
        SUPER_ADMIN_EMAIL: null,
        SMTP_USER: null,
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false); // Zod treats null as invalid for optional strings
    });

    it('should reject undefined for required fields', () => {
      const env = {
        ...validBaseEnv,
        DATABASE_URL: undefined,
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(false);
    });
  });

  describe('Type Safety', () => {
    it('should infer correct TypeScript types from schema', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        const env: Env = result.data;
        // These type checks ensure the Env type is correctly inferred
        expect(typeof env.NODE_ENV).toBe('string');
        expect(typeof env.DATABASE_URL).toBe('string');
        expect(typeof env.SMTP_PORT).toBe('number');
        expect(typeof env.INACTIVITY_TIMEOUT_MINS).toBe('number');
        expect(typeof env.PAYLOAD_ENCRYPTION_MAX_BYTES).toBe('number');
      }
    });

    it('should properly type optional fields as potentially undefined', () => {
      const result = envSchema.safeParse(validBaseEnv);
      expect(result.success).toBe(true);
      if (result.success) {
        const env: Env = result.data;
        // Optional fields should be undefined when not provided
        expect(env.SUPER_ADMIN_EMAIL).toBeUndefined();
        expect(env.SMTP_USER).toBeUndefined();
        expect(env.SMTP_PASS).toBeUndefined();
        expect(env.L1_CACHE_MAX_ENTRIES).toBeUndefined();
        expect(env.L1_CACHE_TTL_MS).toBeUndefined();
        expect(env.PLATFORM_ORGANIZATION_ID).toBeUndefined();
        expect(env.TRUSTED_PROXY_CIDRS).toBeUndefined();
      }
    });
  });

  describe('Real-world Scenarios', () => {
    it('should accept a complete production-like environment', () => {
      const env = {
        ...validBaseEnv,
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://produser:prodpass@prod-db.example.com:5432/proddb',
        BETTER_AUTH_SECRET: 'super-secret-production-key-that-is-at-least-32-chars-long',
        GOOGLE_CLIENT_ID: '123456789.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-production-secret',
        PII_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        LOG_LEVEL: 'warn',
        FRONTEND_URL: 'https://app.example.com',
        NEXT_PUBLIC_API_URL: 'https://api.example.com',
        REDIS_URL: 'redis://redis.example.com:6379',
        ENABLE_L1_CACHE: 'true',
        L1_CACHE_MAX_ENTRIES: '5000',
        L1_CACHE_TTL_MS: '300000',
        PLATFORM_ORGANIZATION_ID: 'cuid12345678901234567',
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_PORT: '587',
        SMTP_USER: 'apikey',
        SMTP_PASS: 'SG.production-api-key',
        SMTP_FROM: 'noreply@example.com',
        SUPER_ADMIN_EMAIL: 'admin@example.com',
        TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
        INACTIVITY_TIMEOUT_MINS: '30',
        PAYLOAD_ENCRYPTION_MODE: 'enforce',
        PAYLOAD_ENCRYPTION_MAX_BYTES: '131072',
        PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS: '600',
        PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS: '60',
        PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS: '120',
        PAYLOAD_ENCRYPTION_REPLAY_CACHE: 'redis',
        PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE: 'true',
        PAYLOAD_ENCRYPTION_MAX_KEYS_PER_SESSION: '25',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
    });

    it('should accept a minimal development environment', () => {
      const env = {
        ...validBaseEnv,
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        // Verify defaults are applied
        expect(result.data.NODE_ENV).toBe('development');
        expect(result.data.LOG_LEVEL).toBe('debug');
        expect(result.data.FRONTEND_URL).toBe('http://localhost:3000');
        expect(result.data.NEXT_PUBLIC_API_URL).toBe('http://localhost:3000');
        expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
        expect(result.data.ENABLE_L1_CACHE).toBe('true');
        expect(result.data.SMTP_HOST).toBe('localhost');
        expect(result.data.SMTP_PORT).toBe(587);
        expect(result.data.SMTP_FROM).toBe('noreply@nipp.gov.uk');
        expect(result.data.INACTIVITY_TIMEOUT_MINS).toBe(15);
        expect(result.data.PAYLOAD_ENCRYPTION_MODE).toBe('disabled');
        expect(result.data.PAYLOAD_ENCRYPTION_REPLAY_CACHE).toBe('redis');
      }
    });

    it('should accept a test environment with test-specific defaults', () => {
      const env = {
        ...validBaseEnv,
        NODE_ENV: 'test',
      };
      const result = envSchema.safeParse(env);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.NODE_ENV).toBe('test');
      }
    });
  });
});

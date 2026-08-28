/**
 * Unit tests for lib/logger.ts — pino configuration, child loggers, and
 * redactLogObject PII redaction.
 *
 * pino / pino-pretty / env are mocked so we can assert the exact config the
 * logger module passes to pino() and re-import the module under different
 * NODE_ENV/LOG_LEVEL combinations (config is captured at module load).
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — built with vi.hoisted so the mock instances are initialized at the
// very top of the file (before imports evaluate), which is required because
// vi.mock factories reference them and module-graph evaluation happens
// during import resolution.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Default implementation returns a plausible logger object so every module
  // graph (including the one created by the static import below) gets a
  // usable base logger. Individual tests override via mockReturnValue().
  const mockPino = vi.fn(
    (..._args: unknown[]) => ({ child: vi.fn() }),
  );
  const mockPrettyInstance = { prettyStream: true };
  const mockPretty = vi.fn(() => mockPrettyInstance);
  // Mutable env — the mock factory returns this object by reference so tests
  // can flip fields between re-imports.
  const mockEnvState: { NODE_ENV?: string; LOG_LEVEL?: string } = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
  };
  return { mockPino, mockPretty, mockPrettyInstance, mockEnvState };
});
const { mockPino, mockPretty, mockPrettyInstance, mockEnvState } = mocks;

vi.mock('pino', () => ({ default: mocks.mockPino }));
vi.mock('pino-pretty', () => ({ default: mocks.mockPretty }));
vi.mock('@/lib/env', () => ({ env: mocks.mockEnvState }));

// Static import of the unit under test. The module initializes with the
// mocked pino/pretty/env at the default test env values above.
import { createChildLogger, redactLogObject } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LoadedLogger {
  mod: typeof import('@/lib/logger');
  baseLogger: { child: ReturnType<typeof vi.fn> };
}

async function loadLogger(envOverrides: Record<string, string | undefined> = {}): Promise<LoadedLogger> {
  Object.assign(mockEnvState, { NODE_ENV: 'test', LOG_LEVEL: 'info' }, envOverrides);
  vi.resetModules();
  const baseLogger = { child: vi.fn(() => ({ __isChildLogger: true })) };
  mockPino.mockClear().mockReturnValue(baseLogger as never);
  mockPretty.mockClear();
  const mod = await import('@/lib/logger');
  return { mod, baseLogger: baseLogger as { child: ReturnType<typeof vi.fn> } };
}

function pinoArgs() {
  const call = mockPino.mock.calls[mockPino.mock.calls.length - 1] as unknown[];
  return { options: call[0] as Record<string, unknown>, stream: call[1] };
}

// ---------------------------------------------------------------------------
// Module initialization (pino config)
// ---------------------------------------------------------------------------

describe('logger module initialization', () => {
  it('defaults to debug level in non-production when LOG_LEVEL is unset', async () => {
    await loadLogger({ NODE_ENV: 'development', LOG_LEVEL: undefined });

    expect(pinoArgs().options.level).toBe('debug');
  });

  it('explicit LOG_LEVEL overrides the environment default', async () => {
    await loadLogger({ NODE_ENV: 'development', LOG_LEVEL: 'warn' });

    expect(pinoArgs().options.level).toBe('warn');
  });

  it('defaults to info level in production when LOG_LEVEL is unset', async () => {
    await loadLogger({ NODE_ENV: 'production', LOG_LEVEL: undefined });

    expect(pinoArgs().options.level).toBe('info');
  });

  it('passes a pino-pretty stream in non-production environments', async () => {
    await loadLogger({ NODE_ENV: 'development' });

    expect(mockPretty).toHaveBeenCalledWith({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'hostname,pid',
    });
    expect(pinoArgs().stream).toBe(mockPrettyInstance);
  });

  it('passes no stream in production (raw JSON to stdout)', async () => {
    await loadLogger({ NODE_ENV: 'production' });

    expect(mockPretty).not.toHaveBeenCalled();
    expect(pinoArgs().stream).toBeUndefined();
  });

  it('configures PII redaction for every sensitive field', async () => {
    await loadLogger();

    const redact = pinoArgs().options.redact as { paths: string[]; censor: string };
    expect(redact.censor).toBe('***REDACTED***');

    const expectedFields = [
      'password',
      'passwordHash',
      'sessionToken',
      'betterAuthSessionToken',
      'cookie',
      'cookies',
      'authorization',
      'email',
      'phone',
      'ssn',
      'passportNumber',
      'creditCard',
      'apiKey',
      'secret',
      'token',
      'keyMaterial',
      'payloadKey',
      'requestBody',
      'responseBody',
      'body',
      'ciphertext',
      'plaintext',
    ];
    for (const field of expectedFields) {
      expect(redact.paths, `expected redaction path for "${field}"`).toContain(`*.${field}`);
    }
    // Exactly the PII list — no accidental extra redactions.
    expect(redact.paths).toHaveLength(expectedFields.length);
  });

  it('formats the level as a labeled object', async () => {
    await loadLogger();

    const formatters = pinoArgs().options.formatters as { level: (label: string) => unknown };
    expect(formatters.level('info')).toEqual({ level: 'info' });
  });

  it('exposes the logger created by the pino constructor', async () => {
    const { mod, baseLogger } = await loadLogger();

    expect(mod.logger).toBe(baseLogger);
  });
});

// ---------------------------------------------------------------------------
// createChildLogger
// ---------------------------------------------------------------------------

describe('createChildLogger', () => {
  it('returns a child logger bound with the given context', async () => {
    const { mod, baseLogger } = await loadLogger();

    const ctx = { service: 'calendar', requestId: 'req-1' };
    const child = mod.createChildLogger(ctx);

    expect(baseLogger.child).toHaveBeenCalledWith(ctx);
    expect(child).toEqual({ __isChildLogger: true });
  });

  it('works with an empty context object', async () => {
    const { mod, baseLogger } = await loadLogger();

    void mod.createChildLogger({});
    expect(baseLogger.child).toHaveBeenCalledWith({});
  });

  it('static import and re-imported version are the same implementation shape', async () => {
    // Sanity check: the top-level static import is callable and returns
    // whatever the base logger's child() produces.
    void createChildLogger({ a: 'b' });
    expect(typeof createChildLogger).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// redactLogObject (statically imported real implementation)
// ---------------------------------------------------------------------------

const REDACTED = '***REDACTED***';

describe('redactLogObject', () => {
  it.each([null, undefined, 42, 'text', true, false])(
    'passes through %p unchanged',
    (value) => {
      expect(redactLogObject(value)).toBe(value);
    },
  );

  it('passes NaN through as NaN', () => {
    expect(Number.isNaN(redactLogObject(NaN) as number)).toBe(true);
  });

  it('redacts top-level PII fields and keeps others', () => {
    const out = redactLogObject({
      password: 'hunter2',
      email: 'a@b.c',
      apiKey: 'sk-live-123',
      name: 'kept',
      count: 7,
    }) as Record<string, unknown>;

    expect(out.password).toBe(REDACTED);
    expect(out.email).toBe(REDACTED);
    expect(out.apiKey).toBe(REDACTED);
    expect(out.name).toBe('kept');
    expect(out.count).toBe(7);
  });

  it('redacts PII fields at any nesting depth', () => {
    const out = redactLogObject({
      outer: { inner: [{ user: { email: 'a@b.c', phone: '555' } }] },
      top: 'ok',
    }) as Record<string, unknown>;

    const deep = (out.outer as Record<string, { user: Record<string, unknown> }[]>).inner[0].user;
    expect(deep.email).toBe(REDACTED);
    expect(deep.phone).toBe(REDACTED);
    expect(out.top).toBe('ok');
  });

  it('keeps non-PII keys at nesting depth intact', () => {
    const out = redactLogObject({ meta: { requestId: 'r1', orgId: 'o2' } }) as Record<string, unknown>;

    expect(out).toEqual({ meta: { requestId: 'r1', orgId: 'o2' } });
  });

  it('replaces the whole value for a redacted key even when it is a nested object', () => {
    const out = redactLogObject({ keyMaterial: { a: 1, b: [2, 3] } }) as Record<string, unknown>;

    expect(out.keyMaterial).toBe(REDACTED);
  });

  it('preserves null values inside objects untouched', () => {
    const out = redactLogObject({ a: null, b: { c: null }, text: 'x' }) as Record<string, unknown>;

    expect(out).toEqual({ a: null, b: { c: null }, text: 'x' });
  });

  it('recurses into arrays and redacts PII inside them', () => {
    const out = redactLogObject([1, { token: 't-1' }, ['nested', { secret: 's' }]]) as unknown[];

    expect(out[0]).toBe(1);
    expect((out[1] as Record<string, unknown>).token).toBe(REDACTED);
    const nested = (out[2] as [string, Record<string, unknown>])[1];
    expect(nested.secret).toBe(REDACTED);
  });

  it('handles Error objects: name/message kept, user paths redacted from stack', () => {
    const err = new TypeError('boom');
    // Node stack traces include absolute file paths.
    err.stack =
      'TypeError: boom\n    at foo (/Users/alice/proj/src/app.ts:10:5)\n    at bar (/etc/other.js:1:1)';

    const out = redactLogObject(err) as Record<string, unknown>;

    expect(out.name).toBe('TypeError');
    expect(out.message).toBe('boom');
    expect(String(out.stack)).toContain('/Users/[REDACTED]');
    expect(String(out.stack)).not.toContain('/Users/alice');
    // Non-user paths are preserved.
    expect(String(out.stack)).toContain('/etc/other.js');
  });

  it('handles errors without a stack (no crash, no stack key)', () => {
    const err = new Error('no stack');
    err.stack = undefined;

    const out = redactLogObject(err) as Record<string, unknown>;

    expect(out).toEqual({ name: 'Error', message: 'no stack' });
  });
});

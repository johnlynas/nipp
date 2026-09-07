import pino from 'pino';
import pretty from 'pino-pretty';
import { env } from '@/lib/env';

const isProduction = env.NODE_ENV === 'production';
const logLevel = env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// PII fields that should be redacted from log output
const piiFields = [
  // Authentication & session
  'password',
  'passwordHash',
  'sessionToken',
  'betterAuthSessionToken',
  'cookie',
  'cookies',
  'authorization',

  // Personal data
  'email',
  'phone',
  'ssn',
  'passportNumber',
  'creditCard',

  // API keys & secrets
  'apiKey',
  'secret',
  'token',

  // Payload encryption fields — never log these
  'keyMaterial',
  'payloadKey',

  // Request/response bodies — never log full payloads
  'requestBody',
  'responseBody',
  'body',

  // Cryptographic material
  'ciphertext',
  'plaintext',
];

// Create pretty stream directly - NO transport config
const stream = isProduction
  ? undefined // In production, output raw JSON to stdout
  : pretty({
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'hostname,pid',
    });

export const logger = pino(
  {
    level: logLevel,
    customLevels: {
      critical: 55, // Custom level between error (50) and fatal (60); used for rate-limit alerts
    },
    redact: {
      paths: piiFields.map((field) => `*.${field}`),
      censor: '***REDACTED***',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
  },
  stream // Pass stream directly as second argument
);

/**
 * Create a child logger with additional context.
 */
export function createChildLogger(context: Record<string, string>) {
  return logger.child(context);
}

/**
 * Safely serialize an object for logging, redacting PII fields at any depth.
 * This is useful for error objects and nested payloads that may contain PII.
 */
export function redactLogObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  // Handle Error objects specially
  if (obj instanceof Error) {
    const errorObj: Record<string, unknown> = {
      name: obj.name,
      message: obj.message,
    };

    // Redact stack trace (may contain sensitive paths)
    if (obj.stack) {
      errorObj.stack = obj.stack.replace(/\/Users\/[^/]+/g, '/Users/[REDACTED]');
    }

    return errorObj;
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) => redactLogObject(item));
  }

  // Handle plain objects
  if (typeof obj === 'object') {
    const redacted: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Redact known PII fields at any depth
      if (piiFields.includes(key)) {
        redacted[key] = '***REDACTED***';
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = redactLogObject(value);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  // Primitive values pass through
  return obj;
}

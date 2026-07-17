import pino from 'pino';
import pretty from 'pino-pretty';
import { env } from '@/lib/env';

const isProduction = env.NODE_ENV === 'production';
const logLevel = env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

// PII fields that should be redacted from log output
const piiFields = [
  'password',
  'passwordHash',
  'email',
  'phone',
  'ssn',
  'passportNumber',
  'creditCard',
  'apiKey',
  'secret',
  'token',
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
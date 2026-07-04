import pino from 'pino';

/**
 * Pino-based structured logging.
 *
 * Environment-aware log levels:
 * - Development: debug (verbose)
 * - Production: info (concise)
 *
 * PII redaction rules prevent sensitive data from being logged.
 */

const isProduction = process.env.NODE_ENV === 'production';

const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

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

export const logger = pino({
  level: logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'hostname,pid',
          },
        }
      : undefined,
  redact: {
    paths: piiFields.map((field) => `*.${field}`),
    censor: '***REDACTED***',
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
});

/**
 * Create a child logger with additional context.
 */
export function createChildLogger(context: Record<string, string>) {
  return logger.child(context);
}

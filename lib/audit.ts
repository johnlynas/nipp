import { logger } from './logger';

/**
 * Audit event types for cross-tenant access attempts and security events.
 */
export const AuditEventType = {
  CROSS_TENANT_ACCESS_ATTEMPT: 'CROSS_TENANT_ACCESS_ATTEMPT',
  AUTH_FAILURE: 'AUTH_FAILURE',
  AUTH_SUCCESS: 'AUTH_SUCCESS',
  ROLE_CHANGE: 'ROLE_CHANGE',
  DATA_EXPORT: 'DATA_EXPORT',
} as const;

export type AuditEventType = (typeof AuditEventType)[keyof typeof AuditEventType];

/**
 * Audit event payload.
 */
export interface AuditEvent {
  eventType: AuditEventType;
  userId?: string;
  attemptedOrgId?: string;
  actualOrgId?: string;
  resource: string;
  resourceId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

/**
 * Log an audit event with structured logging.
 * Integrates with `lib/logger.ts` for JSON-formatted output.
 */
export function logAuditEvent(event: Omit<AuditEvent, 'timestamp'>): void {
  const fullEvent: AuditEvent = {
    ...event,
    timestamp: new Date().toISOString(),
  };

  logger.warn({
    event: 'audit',
    ...fullEvent,
  }, 'Audit event');

  // TODO: Persist audit events to database or external service
  // This will be implemented in a future proposal when audit log storage is defined
}

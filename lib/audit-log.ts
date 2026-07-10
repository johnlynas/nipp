/**
 * Audit logging infrastructure.
 *
 * Records security-relevant admin actions to the AuditLog model in PostgreSQL.
 */

import globalDb from '@/lib/global-db';

/**
 * Audit log entry payload.
 */
export interface AuditLogPayload {
  userId?: string | null;
  userName?: string | null;
  action: string;        // e.g., "organization.created", "role.deleted"
  resourceType: string;  // e.g., "Organization", "Role", "Permission"
  resourceId?: string | null;
  organizationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Record an audit log entry in the database.
 */
export async function recordAuditLog(payload: AuditLogPayload): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await globalDb.auditLog.create({
      data: {
        userId: payload.userId,
        userName: payload.userName,
        action: payload.action,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId,
        organizationId: payload.organizationId,
        ipAddress: payload.ipAddress,
        userAgent: payload.userAgent,
        success: payload.success,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        metadata: payload.metadata as any,
      },
    });
  } catch (error) {
    // Log but don't fail the calling operation if audit logging fails
    console.error('[AuditLog] Failed to record audit entry:', error);
  }
}

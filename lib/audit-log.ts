/**
 * Audit logging infrastructure.
 *
 * Records security-relevant admin actions to the AuditLog model in PostgreSQL.
 */

// AuditLog is NOT in tenantDb's TENANT_SCOPED_MODELS, so this pass-through swap
// changes no query behavior (RLS plan Phase 3: remove the unscoped-client bypass).
import tenantDb from '@/lib/tenant-db';
import { Prisma } from '@prisma/client';

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
    await tenantDb.auditLog.create({
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
        metadata: payload.metadata as Prisma.InputJsonValue | undefined
      },
    });
  } catch (error) {
    // Log but don't fail the calling operation if audit logging fails
    console.error('[AuditLog] Failed to record audit entry:', error);
  }
}

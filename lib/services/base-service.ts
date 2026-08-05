/**
 * Authorization helper functions for the service layer.
 *
 * Pure utility functions (not a class) used by all CRUD services to enforce
 * role-based authorization. Throws typed errors on denial.
 */

import { ServiceContext, ForbiddenError } from './types';
import { logger } from '@/lib/logger';

/**
 * Throws ForbiddenError if ctx.role !== 'PLATFORM_ADMIN'.
 */
export function requirePlatformAdmin(ctx: ServiceContext): void {
  if (ctx.role !== 'PLATFORM_ADMIN') {
    logFailedAuth(ctx, 'requirePlatformAdmin');
    throw new ForbiddenError('Platform Admin access required');
  }
}

/**
 * Throws ForbiddenError if:
 * - ctx.role !== 'TENANT_ADMIN' (also denies PLATFORM_ADMIN and MEMBER)
 * - targetOrgId !== ctx.organizationId (cross-org access for Tenant Admins)
 */
export function requireTenantAdmin(ctx: ServiceContext, targetOrgId: string): void {
  if (ctx.role === 'MEMBER') {
    logFailedAuth(ctx, 'requireTenantAdmin');
    throw new ForbiddenError('Member access denied — admin role required');
  }

  if (ctx.role !== 'TENANT_ADMIN') {
    logFailedAuth(ctx, 'requireTenantAdmin');
    throw new ForbiddenError('Tenant Admin access required');
  }

  if (targetOrgId !== ctx.organizationId) {
    logFailedAuth(ctx, 'requireTenantAdmin');
    throw new ForbiddenError('Cannot access resources outside your organization');
  }
}

/**
 * Throws ForbiddenError if ctx.role === 'MEMBER'.
 * Allows both PLATFORM_ADMIN and TENANT_ADMIN through.
 */
export function requireAnyAdmin(ctx: ServiceContext): void {
  if (ctx.role === 'MEMBER') {
    logFailedAuth(ctx, 'requireAnyAdmin');
    throw new ForbiddenError('Member access denied — admin role required');
  }
}

/**
 * Resolves the effective target org ID based on context and explicit parameter.
 * Returns targetOrgId if provided, otherwise falls back to ctx.organizationId.
 */
export function resolveOrgScope(ctx: ServiceContext, targetOrgId?: string): string | undefined {
  if (targetOrgId) return targetOrgId;
  return ctx.organizationId;
}

/**
 * Logs a failed authorization attempt for security observability.
 */
export function logFailedAuth(ctx: ServiceContext, action: string): void {
  logger.warn(
    { userId: ctx.userId, role: ctx.role, action },
    `Authorization denied: ${action}`,
  );
}

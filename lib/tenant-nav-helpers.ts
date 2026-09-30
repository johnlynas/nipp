/**
 * Shared helpers for the role-scoped dashboards under /dashboard.
 */

import type { UserRole } from './dashboard-router';

/**
 * Roles whose dashboard is the read-only tenant workspace
 * (`/dashboard/tenant`): calendar + org chart of their own organization
 * only, no platform navigation.
 */
export const TENANT_VIEW_ROLES: UserRole[] = ['tenant', 'owner', 'manager', 'member'];

export function isTenantViewRole(role: UserRole | null | undefined): boolean {
  return !!role && (TENANT_VIEW_ROLES as string[]).includes(role);
}

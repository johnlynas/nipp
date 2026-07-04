/**
 * Tenant-related permissions.
 */

export const TENANT_PERMISSIONS = {
  'tenants:view': 'View tenants',
  'tenants:create': 'Create tenants',
  'tenants:update': 'Update tenant details',
  'tenants:delete': 'Delete tenants',
  'tenants:manage': 'Full tenant management',
} as const;

export type TenantPermission = keyof typeof TENANT_PERMISSIONS;

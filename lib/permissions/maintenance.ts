/**
 * Maintenance-related permissions.
 */

export const MAINTENANCE_PERMISSIONS = {
  'maintenance:view': 'View maintenance requests',
  'maintenance:create': 'Create maintenance requests',
  'maintenance:manage': 'Manage maintenance requests',
  'workOrders:view': 'View work orders',
  'workOrders:create': 'Create work orders',
  'workOrders:assign': 'Assign work orders',
  'workOrders:update': 'Update work orders',
} as const;

export type MaintenancePermission = keyof typeof MAINTENANCE_PERMISSIONS;

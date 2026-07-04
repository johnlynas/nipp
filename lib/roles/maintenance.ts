/**
 * Maintenance role templates.
 */

export const MAINTENANCE_ROLES = {
  maintenanceManager: {
    name: 'Maintenance Manager',
    permissions: [
      'workOrders:view',
      'workOrders:create',
      'workOrders:assign',
      'properties:view',
      'contractors:manage',
    ],
  },
  maintenanceStaff: {
    name: 'Maintenance Staff',
    permissions: [
      'workOrders:view',
      'workOrders:update',
      'properties:view',
    ],
  },
} as const;

export type MaintenanceRole = keyof typeof MAINTENANCE_ROLES;

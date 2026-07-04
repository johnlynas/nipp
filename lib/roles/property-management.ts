/**
 * Property management role templates.
 *
 * Defines role structures with placeholder permission arrays
 * for the property management industry organizational structure.
 */

export const PROPERTY_MANAGEMENT_ROLES = {
  director: {
    name: 'Director',
    permissions: ['*'], // Full access
  },
  regionalManager: {
    name: 'Regional Manager',
    permissions: [
      'properties:view',
      'properties:create',
      'properties:update',
      'tenants:view',
      'tenants:create',
      'maintenance:view',
      'financial:report',
    ],
  },
  propertyManager: {
    name: 'Property Manager',
    permissions: [
      'properties:view',
      'properties:update',
      'tenants:view',
      'tenants:create',
      'maintenance:manage',
      'financial:report',
    ],
  },
  lettingAgent: {
    name: 'Letting Agent',
    permissions: [
      'properties:view',
      'tenants:view',
      'tenants:create',
      'viewings:manage',
      'applications:review',
    ],
  },
} as const;

export type PropertyManagementRole = keyof typeof PROPERTY_MANAGEMENT_ROLES;

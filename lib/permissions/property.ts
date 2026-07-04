/**
 * Property-related permissions.
 */

export const PROPERTY_PERMISSIONS = {
  'properties:view': 'View properties',
  'properties:create': 'Create properties',
  'properties:update': 'Update properties',
  'properties:delete': 'Delete properties',
  'properties:manage': 'Full property management',
} as const;

export type PropertyPermission = keyof typeof PROPERTY_PERMISSIONS;

/**
 * Letting agent role templates.
 */

export const LETTING_ROLES = {
  seniorAgent: {
    name: 'Senior Letting Agent',
    permissions: [
      'properties:view',
      'properties:create',
      'tenants:view',
      'viewings:manage',
      'applications:approve',
      'contracts:create',
    ],
  },
  lettingAgent: {
    name: 'Letting Agent',
    permissions: [
      'properties:view',
      'viewings:manage',
      'applications:review',
    ],
  },
} as const;

export type LettingRole = keyof typeof LETTING_ROLES;

/**
 * Contractor-related permissions — scaffolding only.
 *
 * Full implementation is deferred to a future OpenSpec proposal.
 */

export const CONTRACTOR_PERMISSIONS = {
  // Placeholder — full permission set to be defined in future proposal
  'jobs:view': 'View available jobs',
  'quotes:create': 'Submit quotes',
  'workOrders:update': 'Update work order status',
} as const;

export type ContractorPermission = keyof typeof CONTRACTOR_PERMISSIONS;

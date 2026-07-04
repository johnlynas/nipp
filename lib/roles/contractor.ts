/**
 * Contractor role template — scaffolding only.
 *
 * Full implementation is deferred to a future OpenSpec proposal.
 * Planned functionality: quoting, job scheduling, work order management,
 * site access, invoicing, and communication with management.
 */

export const CONTRACTOR_ROLES = {
  contractor: {
    name: 'Contractor',
    permissions: [
      // Placeholder — full permission set to be defined in future proposal
      'jobs:view',
      'quotes:create',
      'workOrders:update',
    ],
  },
} as const;

export type ContractorRole = keyof typeof CONTRACTOR_ROLES;

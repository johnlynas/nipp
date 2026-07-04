/**
 * Sample organization data fixtures.
 */

export const testOrganizations = {
  smallLandlord: {
    name: 'Small Landlord Ltd',
    slug: 'small-landlord',
    metadata: {
      type: 'individual' as const,
      size: 'small',
    },
  },
  largeAgency: {
    name: 'National Property Agency',
    slug: 'national-agency',
    metadata: {
      type: 'agency' as const,
      size: 'large',
    },
  },
  housingAssociation: {
    name: 'Community Housing Association',
    slug: 'community-housing',
    metadata: {
      type: 'association' as const,
      size: 'medium',
    },
  },
} as const;

export type TestOrgType = keyof typeof testOrganizations;

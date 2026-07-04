/**
 * Sample user data fixtures for different roles.
 */

export const testUsers = {
  owner: {
    name: 'Property Owner',
    email: 'owner@example.com',
    passwordHash: null, // BetterAuth handles hashing
  },
  manager: {
    name: 'Property Manager',
    email: 'manager@example.com',
    passwordHash: null,
  },
  agent: {
    name: 'Letting Agent',
    email: 'agent@example.com',
    passwordHash: null,
  },
  maintenance: {
    name: 'Maintenance Staff',
    email: 'maintenance@example.com',
    passwordHash: null,
  },
  tenant: {
    name: 'Tenant',
    email: 'tenant@example.com',
    passwordHash: null,
  },
  accountant: {
    name: 'Accountant',
    email: 'accountant@example.com',
    passwordHash: null,
  },
  contractor: {
    name: 'Contractor',
    email: 'contractor@example.com',
    passwordHash: null,
  },
} as const;

export type TestUserRole = keyof typeof testUsers;

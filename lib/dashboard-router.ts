/**
 * Role-based dashboard routing boilerplate.
 *
 * Determines which dashboard to show based on user role.
 */

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'owner'
  | 'manager'
  | 'agent'
  | 'maintenance'
  | 'tenant'
  | 'accountant'
  | 'contractor'
  | 'member';

/**
 * Mapping of user roles to their dashboard paths.
 */
const ROLE_DASHBOARD_MAP: Record<UserRole, string> = {
  super_admin: '/dashboard/admin',
  admin: '/dashboard/admin',
  owner: '/dashboard/tenant',
  manager: '/dashboard/tenant',
  agent: '/dashboard/tenant',
  maintenance: '/dashboard/tenant',
  tenant: '/dashboard/tenant',
  accountant: '/dashboard/tenant',
  contractor: '/dashboard/contractor', // Placeholder — full implementation deferred to future OpenSpec proposal
  member: '/dashboard/tenant',
};

/**
 * Get the dashboard path for a given user role.
 * @param role - The user's role
 * @returns The dashboard path, or null if the role is not recognized
 */
export function getDashboardPath(role: UserRole): string | null {
  return ROLE_DASHBOARD_MAP[role] ?? null;
}

/**
 * Determine the primary role for a user.
 * In production, this would read from the user's session/organization membership.
 */
export function getUserPrimaryRole(roles: UserRole[]): UserRole {
  // Return the highest-priority role
  const priorityOrder: UserRole[] = [
    'super_admin',
    'admin',
    'manager',
    'owner',
    'agent',
    'maintenance',
    'accountant',
    'contractor',
    'tenant',
    'member',
  ];

  for (const role of priorityOrder) {
    if (roles.includes(role)) return role;
  }

  return 'member';
}

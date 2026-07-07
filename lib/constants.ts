/**
 * Application-wide constants.
 */

/**
 * The Platform Organization ID.
 *
 * This special organization houses Super Admins and support staff.
 * It is configured via the PLATFORM_ORGANIZATION_ID environment variable.
 * During seeding (prisma/seed.ts), this value is generated and persisted.
 * At runtime, it must be read from the database — see `getPlatformOrgId()` below.
 *
 * IMPORTANT: Never hardcode a real value in source code. During development,
 * if the env var is not set, this returns null and callers must use
 * `getPlatformOrgId()` to fetch from the database.
 */
export const PLATFORM_ORGANIZATION_ID_ENV =
  process.env.PLATFORM_ORGANIZATION_ID || null;

/**
 * Default permissions assigned to each bootstrapped role.
 * These are the 7 default roles defined in the authorization spec.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  // Organization Admin — full access to everything in the organization
  'Organization Admin': [
    'properties:view',
    'properties:create',
    'properties:update',
    'properties:delete',
    'properties:manage',
    'tenants:view',
    'tenants:create',
    'tenants:update',
    'tenants:delete',
    'tenants:manage',
    'financials:view',
    'financials:create',
    'financials:update',
    'financials:delete',
    'financials:export',
    'financials:manage',
    'maintenance:view',
    'maintenance:create',
    'maintenance:update',
    'maintenance:delete',
    'maintenance:manage',
    'contractors:view',
    'contractors:create',
    'contractors:update',
    'contractors:delete',
    'contractors:manage',
    'roles:view',
    'roles:create',
    'roles:update',
    'roles:delete',
    'roles:manage',
    'members:view',
    'members:invite',
    'members:update',
    'members:delete',
    'members:manage',
  ],

  // Property Manager — manage properties and tenants
  'Property Manager': [
    'properties:view',
    'properties:create',
    'properties:update',
    'tenants:view',
    'tenants:create',
    'tenants:update',
    'maintenance:view',
    'maintenance:create',
    'maintenance:update',
    'financials:view',
    'financials:report',
  ],

  // Letting Agent — manage viewings and applications
  'Letting Agent': [
    'properties:view',
    'tenants:view',
    'tenants:create',
    'viewings:manage',
    'applications:review',
  ],

  // Accountant — financial reporting and management
  'Accountant': [
    'financials:view',
    'financials:create',
    'financials:update',
    'financials:export',
    'properties:view',
    'tenants:view',
  ],

  // Maintenance Staff — view and manage maintenance requests
  'Maintenance Staff': [
    'maintenance:view',
    'maintenance:create',
    'maintenance:update',
    'properties:view',
  ],

  // Tenant — view-only access to their own data
  'Tenant': [
    'properties:view',
    'maintenance:create',
    'maintenance:view',
  ],

  // Contractor — limited access for maintenance work
  'Contractor': [
    'maintenance:view',
    'maintenance:update',
    'properties:view',
  ],
};

/**
 * The 7 default role names.
 */
export const DEFAULT_ROLE_NAMES = Object.keys(DEFAULT_ROLE_PERMISSIONS) as string[];

/**
 * Permission categories (resources) used in the catalog.
 */
export const PERMISSION_RESOURCES = [
  'properties',
  'tenants',
  'financials',
  'maintenance',
  'contractors',
  'roles',
  'members',
  'viewings',
  'applications',
] as const;

/**
 * Common actions used across resources.
 */
export const PERMISSION_ACTIONS = [
  'view',
  'create',
  'update',
  'delete',
  'manage',
  'report',
  'export',
  'invite',
] as const;

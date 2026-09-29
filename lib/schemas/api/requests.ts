import { z } from 'zod';
import { calendarEventType, notificationPriority, orgStatus, recurrenceFrequency } from './common';

/**
 * Request body schemas for API docs — mirror what each route actually
 * destructure-parses from the (optionally decrypted) JSON body. Not used
 * for runtime validation today; documenting first so the spec is accurate.
 */

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const createOrganizationBody = z
  .object({
    name: z.string().min(1).describe('Organization name'),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional()
      .describe('URL slug (auto-generated from name when omitted)'),
    adminEmail: z.string().email().optional().describe('Bootstrap an admin user for this org'),
  })
  .meta({ id: 'CreateOrganizationBody' });

/** Dashboard org create — no adminEmail (the route only forwards name/slug/description). */
export const dashboardCreateOrganizationBody = z
  .object({
    name: z.string().min(1).describe('Organization name (required)'),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional()
      .describe('URL slug (auto-generated, with collision suffix, when omitted)'),
    description: z.string().nullable().optional(),
  })
  .meta({ id: 'DashboardCreateOrganizationBody' });

export const updateOrganizationBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    description: z.string().nullable().optional(),
    status: orgStatus.optional(),
  })
  .meta({ id: 'UpdateOrganizationBody' });

export const changeOrganizationStatusBody = z
  .object({
    status: orgStatus.describe('New status (valid transitions only)'),
  })
  .meta({ id: 'ChangeOrganizationStatusBody' });

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export const addMemberBody = z
  .object({
    email: z.string().email(),
    role: z.enum(['admin', 'manager', 'member']).optional().describe("Defaults to 'member'"),
  })
  .meta({ id: 'AddMemberBody' });

export const updateMemberRoleBody = z
  .object({
    role: z.enum(['admin', 'manager', 'member']),
  })
  .meta({ id: 'UpdateMemberRoleBody' });

// ---------------------------------------------------------------------------
// Roles / permissions (RBAC)
// ---------------------------------------------------------------------------

export const createRoleBody = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    organizationId: z.string().optional().describe('Target org (required when creating a tenant role)'),
  })
  .meta({ id: 'CreateRoleBody' });

export const updateRoleBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
    // Admin role PATCH also accepts the target org from the body (platform admins targeting tenant orgs).
    organizationId: z.string().optional().describe('Target org when updating a tenant role'),
  })
  .meta({ id: 'UpdateRoleBody' });

/** Dashboard role create — target org is mandatory in the body (400 when missing). */
export const dashboardCreateRoleBody = z
  .object({
    name: z.string().min(1).describe('Role name (unique within the organization)'),
    description: z.string().optional(),
    isDefault: z.boolean().optional().default(false),
    organizationId: z.string().describe('Target org (required on this surface — no platform fallback)'),
  })
  .meta({ id: 'DashboardCreateRoleBody' });

/** Dashboard role update — the target org comes from ?organizationId, not the body. */
export const updateDashboardRoleBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: 'UpdateDashboardRoleBody' });

/** Org-scoped tenant role endpoints — target org is in the path, body has no orgId. */
export const orgCreateRoleBody = z
  .object({
    name: z.string().min(1).describe('Role name (unique within the organization)'),
    description: z.string().optional(),
  })
  .meta({ id: 'OrgCreateRoleBody' });

export const orgUpdateRoleBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
  })
  .meta({ id: 'OrgUpdateRoleBody' });

/** POST /api/roles — top-level tenant role create; organizationId is mandatory (no platform fallback). */
export const createTopLevelRoleBody = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    organizationId: z.string().describe('Organization to create the role in (required)'),
  })
  .meta({ id: 'CreateTopLevelRoleBody' });

/** PATCH /api/admin/organizations/[orgId] and [orgId]/settings — accepts name/slug/status (state machine enforced). */
export const orgUpdateOrganizationBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional()
      .describe('New URL slug (409 when already in use)'),
    status: orgStatus.optional().describe(
      'State machine transitions enforced server-side (ARCHIVED is terminal)',
    ),
  })
  .meta({ id: 'OrgUpdateOrganizationBody' });

export const createPermissionBody = z
  .object({
    key: z.string().describe('e.g. "properties:view"'),
    resource: z.string().describe('Resource segment, e.g. "properties"'),
    action: z.string().describe('Action segment, e.g. "view"'),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: 'CreatePermissionBody' });

export const updatePermissionBody = z
  .object({
    key: z.string().optional(),
    resource: z.string().optional(),
    action: z.string().optional(),
    description: z.string().optional(),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: 'UpdatePermissionBody' });

/** POST /api/dashboard/admin/resources — create a platform resource; roles may be assigned in the same call. */
export const createResourceBody = z
  .object({
    name: z.string().min(1).describe('Resource name (unique, case-insensitive)'),
    description: z.string().optional(),
    roleIds: z.array(z.string()).optional().describe('Role IDs to assign to the resource at creation'),
  })
  .meta({ id: 'CreateResourceBody' });

/** PATCH /api/dashboard/admin/resources/{id} — name/description update; providing roleIds REPLACES all assignments. */
export const updateResourceBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    roleIds: z.array(z.string()).optional().describe('Full replacement of role assignments (empty array clears them)'),
  })
  .meta({ id: 'UpdateResourceBody' });

export const assignRolePermissionBody = z
  .object({ permissionId: z.string() })
  .meta({ id: 'AssignRolePermissionBody' });

/** POST /api/roles/{roleId}/permissions — bulk key assignment for a role. */
export const assignRolePermissionsBody = z
  .object({ permissionKeys: z.array(z.string()).describe('Permission keys, e.g. ["properties:view"]') })
  .meta({ id: 'AssignRolePermissionsBody' });

export const batchAssignPermissionsBody = z
  .object({
    assignments: z.array(
      z.object({
        roleId: z.string(),
        permissionKey: z.string().describe('Permission key, e.g. "properties:view"'),
        assign: z.boolean().describe('true grants, false revokes'),
      }),
    ),
  })
  .meta({ id: 'BatchAssignPermissionsBody' });

// ---------------------------------------------------------------------------
// Users (admin)
// ---------------------------------------------------------------------------

export const createUserBody = z
  .object({
    name: z.string(),
    email: z.string().email(),
    password: z.string().optional(),
    organizationId: z.string().optional().describe('Membership to create alongside the user'),
  })
  .meta({ id: 'CreateUserBody' });

export const updateUserBody = z
  .object({
    name: z.string().optional(),
    email: z.string().email().optional(),
  })
  .meta({ id: 'UpdateUserBody' });

export const banUserBody = z
  .object({
    banned: z.boolean().optional().describe('Defaults to the opposite of the current state'),
    banReason: z.string().nullable().optional(),
    banExpires: z.string().nullable().optional().describe('ISO-8601 expiry; null = permanent (default when banning)'),
  })
  .meta({ id: 'BanUserBody' });

/** POST /api/dashboard/admin/users — organizationId is required here (400 when absent), unlike the admin surface. */
export const dashboardCreateUserBody = z
  .object({
    name: z.string().min(1).describe('User display name (required)'),
    email: z.string().email().describe('Required; must be globally unique (409 on clash)'),
    password: z.string().optional().describe('When given, a BetterAuth credential account is created alongside the user'),
    organizationId: z.string().describe('Target org — membership + Members-team enrollment happen in this org'),
  })
  .meta({ id: 'DashboardCreateUserBody' });

// ---------------------------------------------------------------------------
// Notifications (admin)
// ---------------------------------------------------------------------------

export const sendNotificationBody = z
  .object({
    title: z.string().min(1),
    message: z.string().min(1),
    scope: z.enum(['global', 'org']),
    organizationId: z.string().describe('Required for both scopes (broadcast source org when global)'),
    priority: notificationPriority.optional().describe("Defaults to INFO; CALENDAR/JOB are emitted by the system"),
  })
  .meta({ id: 'SendNotificationBody' });

// ---------------------------------------------------------------------------
// Teams (org-scoped)
// ---------------------------------------------------------------------------

export const createTeamBody = z
  .object({
    name: z.string().min(1),
    slug: z.string().optional().describe('Auto-generated from name when omitted'),
    description: z.string().optional(),
  })
  .meta({ id: 'CreateTeamBody' });

/** Dashboard team create — adds the target organization (org is in the body, not the path). */
export const dashboardCreateTeamBody = createTeamBody
  .extend({ organizationId: z.string().describe('Organization to create the team in') })
  .meta({ id: 'DashboardCreateTeamBody' });

export const updateTeamBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().optional(),
    description: z.string().optional(),
  })
  .meta({ id: 'UpdateTeamBody' });

/** PATCH /api/dashboard/admin/teams/{id} — handler reads only name/description (slug is NOT consumed here, unlike the org-scoped sibling). */
export const dashboardUpdateTeamBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().nullable().optional(),
  })
  .meta({ id: 'DashboardUpdateTeamBody' });

export const addTeamMemberBody = z.object({ userId: z.string() }).meta({ id: 'AddTeamMemberBody' });

/** POST /api/roles/{roleId}/members — assign a user to a role. */
export const addRoleMemberBody = z.object({ userId: z.string().describe('User to attach to the role') }).meta({
  id: 'AddRoleMemberBody',
});
export const assignTeamRoleBody = z.object({ roleId: z.string() }).meta({ id: 'AssignTeamRoleBody' });

// ---------------------------------------------------------------------------
// Calendars + events (org-scoped)
// ---------------------------------------------------------------------------

export const createCalendarBody = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    // Handler only reads name/description — color is auto-assigned from a palette,
    // isDefault is hardcoded false on create.
  })
  .meta({ id: 'CreateCalendarBody' });

export const updateCalendarBody = createCalendarBody
  .partial()
  .extend({
    color: z.string().optional().describe('Color theme, e.g. "#1B2A4A"'),
  })
  .meta({ id: 'UpdateCalendarBody' });

const eventRecurrence = z
  .object({
    frequency: recurrenceFrequency,
    interval: z.number().int().positive().optional(),
    endDate: z.string().optional().describe('Recurrence end (YYYY-MM-DD)'),
    count: z.number().int().positive().optional(),
    byDay: z.string().nullable().optional().describe('e.g. "MO,WE"'),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
    excludedDates: z.array(z.string()).optional().describe('Occurrence dates to exclude (YYYY-MM-DD)'),
  })
  .meta({ id: 'EventRecurrence' });

export const createCalendarEventBody = z
  .object({
    title: z.string().min(1),
    startDate: z.string().describe('ISO 8601 local datetime'),
    endDate: z.string().describe('ISO 8601 local datetime, >= startDate'),
    calendarId: z.string(),
    description: z.string().nullable().optional(),
    eventType: calendarEventType.optional(),
    color: z.string().nullable().optional(),
    propertyId: z.string().nullable().optional(),
    recurrence: eventRecurrence.nullable().optional(),
  })
  .meta({ id: 'CreateCalendarEventBody' });

export const updateCalendarEventBody = createCalendarEventBody
  .partial()
  .extend({
    editScope: z.enum(['this', 'following', 'all']).optional().describe('Recurring events only — which occurrences to update'),
    clickedDate: z.string().optional().describe('Occurrence being edited (YYYY-MM-DD), with editScope "following"'),
    excludedDate: z.string().optional().describe('Single date to exclude from recurrence expansion (YYYY-MM-DD)'),
  })
  .meta({ id: 'UpdateCalendarEventBody' });

// ---------------------------------------------------------------------------
// Job scheduler (platform)
// ---------------------------------------------------------------------------

export const createJobBody = z
  .object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    handlerKey: z.string().describe('Handler registry key — built-in handler or stored script'),
    scheduleExpr: z.string().describe("Schedule JSON string, e.g. { kind: 'cron', cron: '* * * * *' }"),
    timezone: z.string().optional().describe('IANA timezone; defaults to JOB_SCHEDULER_TIMEZONE'),
    timeoutMs: z.number().int().positive().optional(),
    concurrencyLimit: z.number().int().positive().optional(),
    enabled: z.boolean().optional(),
    code: z.string().nullable().optional().describe('Operator script source (Phase 2); never eval server-side'),
  })
  .meta({ id: 'CreateJobBody' });

export const updateJobBody = createJobBody.partial().meta({ id: 'UpdateJobBody' });

export const jobControlActionBody = z
  .object({
    action: z.enum(['approve', 'reject']).optional().describe("Defaults to 'approve'"),
    note: z.string().optional(),
  })
  .meta({ id: 'JobControlActionBody' });

export const jobRunBody = z
  .object({
    input: z.unknown().optional().describe('Free-form operator input passed to the handler'),
  })
  .meta({ id: 'JobRunBody' });

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

/** CSP violation report body (W3C report format). */
export const cspViolationReportBody = z
  .object({
    'document-uri': z.string().optional(),
    referrer: z.string().optional(),
    'violated-directive': z.string().optional(),
    'effective-directive': z.string().optional(),
    'blocked-uri': z.string().optional(),
    status: z.number().optional(),
    disposition: z.string().optional(),
  })
  .meta({ id: 'CspViolationReportBody' });

/** Dashboard client-side error reporter (POST /api/dashboard/admin/errors). */
export const logErrorBody = z
  .object({
    message: z.string(),
    page: z.string().optional().describe('Page/component where the error occurred'),
    action: z.string().nullable().optional().describe('User action in progress'),
  })
  .meta({ id: 'LogErrorBody' });

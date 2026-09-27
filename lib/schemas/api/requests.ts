import { z } from 'zod';
import { calendarEventType, notificationPriority, orgStatus } from './common';

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

export const updateOrganizationBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
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
    organizationId: z.string().optional().describe('Target org (required when creating a tenant role)'),
  })
  .meta({ id: 'CreateRoleBody' });

export const updateRoleBody = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
  })
  .meta({ id: 'UpdateRoleBody' });

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

export const assignRolePermissionBody = z
  .object({ permissionId: z.string() })
  .meta({ id: 'AssignRolePermissionBody' });

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
  })
  .meta({ id: 'BanUserBody' });

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

export const updateTeamBody = z
  .object({
    name: z.string().min(1).optional(),
    slug: z.string().optional(),
    description: z.string().optional(),
  })
  .meta({ id: 'UpdateTeamBody' });

export const addTeamMemberBody = z.object({ userId: z.string() }).meta({ id: 'AddTeamMemberBody' });
export const assignTeamRoleBody = z.object({ roleId: z.string() }).meta({ id: 'AssignTeamRoleBody' });

// ---------------------------------------------------------------------------
// Calendars + events (org-scoped)
// ---------------------------------------------------------------------------

export const createCalendarBody = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    color: z.string().optional().describe('Color theme, e.g. "#1B2A4A"'),
    isDefault: z.boolean().optional(),
  })
  .meta({ id: 'CreateCalendarBody' });

export const updateCalendarBody = createCalendarBody.partial().meta({ id: 'UpdateCalendarBody' });

const eventRecurrence = z
  .object({
    frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY']),
    interval: z.number().int().positive().optional(),
    endDate: z.string().optional().describe('Recurrence end (YYYY-MM-DD)'),
    count: z.number().int().positive().optional(),
    byDay: z.string().nullable().optional().describe('e.g. "MO,WE"'),
    byMonthDay: z.number().int().min(1).max(31).nullable().optional(),
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

/** Dashboard client-side error reporter. */
export const logErrorBody = z
  .object({
    message: z.string(),
    name: z.string().optional(),
    stack: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
  })
  .meta({ id: 'LogErrorBody' });

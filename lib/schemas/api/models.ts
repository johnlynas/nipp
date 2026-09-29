import { z } from 'zod';
import {
  calendarEventType,
  idField,
  listEnvelope,
  notificationPriority,
  notificationScope,
  orgStatus,
  recurrenceFrequency,
  ts,
} from './common';

/**
 * Shared domain models for API docs — response/request shapes that recur
 * across multiple route files. Field sets mirror prisma/schema.prisma;
 * relations are flattened to the scalar subset the routes actually emit.
 */

// ---------------------------------------------------------------------------
// Users / Members
// ---------------------------------------------------------------------------

export const user = z
  .object({
    id: idField('User ID (cuid)'),
    name: z.string(),
    email: z.string().email(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    role: z.string().describe("BetterAuth membership role, e.g. 'member', 'admin'"),
    banned: z.boolean().nullable(),
    banReason: z.string().nullable(),
    banExpires: ts.nullable(),
    createdAt: ts,
    updatedAt: ts,
    // Present on some listings (dashboard admin users), omitted on others — optional keeps both honest.
    activeOrganizationId: z.string().nullable().optional(),
  })
  .meta({ id: 'User' });

export const member = z
  .object({
    id: idField('Membership ID (cuid)'),
    role: z.string().describe("Member role, e.g. 'admin', 'manager', 'member'"),
    userId: idField('User ID'),
    orgId: idField('Organization ID'),
    teamId: z.string().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Member' });

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export const organization = z
  .object({
    id: idField('Organization ID (cuid)'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    status: orgStatus,
    metadata: z.unknown().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Organization' });

/** GET /api/admin/organizations/[orgId] — adds rollup counts. */
export const organizationDetail = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    slug: z.string().nullable(),
    status: orgStatus,
    metadata: z.unknown().nullable(),
    createdAt: ts,
    updatedAt: ts,
    memberCount: z.number(),
    customRoleCount: z.number(),
  })
  .meta({ id: 'OrganizationDetail' });

/** Organization row as emitted by getPaginatedOrganizations (counts projected). */
export const organizationListItem = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    memberCount: z.number(),
    teamCount: z.number(),
    _count: z.object({ members: z.number() }),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'OrganizationListItem' });

/** GET /api/admin/organizations & dashboard orgs list — orgs + pagination + global dash stats. */
export const paginatedOrganizations = z
  .object({
    organizations: z.array(organizationListItem),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    globalTotal: z.number().describe('All orgs regardless of filters (dashboard stat cards)'),
    statusCounts: z.object({ ACTIVE: z.number(), PENDING: z.number(), SUSPENDED: z.number(), ARCHIVED: z.number() }),
  })
  .meta({ id: 'PaginatedOrganizations' });

/** Org list option rows (GET /api/admin/organizations/list). */
export const organizationOption = z
  .object({
    id: idField('Organization ID'),
    name: z.string(),
    isPlatform: z.boolean().optional().describe('Present on the synthetic Platform entry'),
    status: orgStatus.optional(),
  })
  .meta({ id: 'OrganizationOption' });

export const organizationListOptions = z
  .object({ organizations: z.array(organizationOption) })
  .meta({ id: 'OrganizationListOptions' });

// ---------------------------------------------------------------------------
// Teams (org-scoped)
// ---------------------------------------------------------------------------

export const team = z
  .object({
    id: idField('Team ID (cuid)'),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Team' });

/** Team row as returned by TeamService.getTeamsByOrg (member count included). */
export const teamWithMemberCount = team
  .extend({ _count: z.object({ members: z.number() }).describe('Number of team members') })
  .meta({ id: 'TeamWithMemberCount' });

/** TeamMember row as emitted by TeamService.addTeamMember. */
export const teamMember = z
  .object({
    id: idField('TeamMember ID (cuid)'),
    teamId: idField('Team ID'),
    userId: idField('User ID'),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'TeamMember' });

/** Team member row as emitted by getTeamById (user select folded in, roles on sibling array). */
export const teamDetailMember = z
  .object({
    id: idField('TeamMember ID'),
    userId: idField('User ID'),
    user: z.object({ name: z.string(), email: z.string().email() }),
    createdAt: ts,
  })
  .meta({ id: 'TeamDetailMember' });

/** Compact role row used by getTeamById's separate role query (id is the ROLE id). */
export const teamRoleRef = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'TeamRoleRef' });

/** Team-role assignment row as emitted by getTeamRoles (id is the junction row). */
export const teamRoleAssignment = z
  .object({
    id: idField('TeamRole ID'),
    roleId: idField('Role ID'),
    name: z.string().describe('Assigned role name'),
    description: z.string().nullable(),
  })
  .meta({ id: 'TeamRoleAssignment' });

/** Roles array envelope as emitted by GET /api/organizations/{orgId}/teams/{teamId}/roles (flattened junction rows, unlike the bare-role TeamRolesList). */
export const teamRoleAssignmentsList = z
  .object({ roles: z.array(teamRoleAssignment) })
  .meta({ id: 'TeamRoleAssignmentsList' });

// ---------------------------------------------------------------------------
// Roles / permissions (RBAC)
// ---------------------------------------------------------------------------

export const permission = z
  .object({
    id: idField('Permission ID (cuid)'),
    key: z.string().describe('Permission key, e.g. "properties:view"'),
    resource: z.string().describe('Resource segment of the key, e.g. "properties"'),
    action: z.string().describe('Action segment of the key, e.g. "view"'),
    description: z.string().nullable(),
    isDefault: z.boolean().describe('true = bootstrapped permission'),
    createdAt: ts,
  })
  .meta({ id: 'Permission' });

export const role = z
  .object({
    id: idField('Role ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'Role' });

/** Team detail (GET /teams/[teamId]) — members and roles included. */
export const teamDetailRole = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'TeamDetailRole' });

export const teamWithDetails = team.extend({
  members: z.array(teamDetailMember),
  roles: z.array(teamDetailRole).describe('Roles assigned to this team'),
}).meta({ id: 'TeamWithDetails' });



/** Platform-scope role row (GET /api/admin/roles) — org membership optional. */
export const platformRole = z
  .object({
    id: idField('Role ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    organizationId: z.string().nullable().describe('null for roles with no tenant org'),
    permissions: z.array(z.string()).optional().describe('Permission keys granted through this role (some listings)'),
    createdAt: ts,
  })
  .meta({ id: 'PlatformRole' });

/** Role row as emitted by RoleService.list (member count projected). */
export const roleListItem = role
  .extend({ _count: z.object({ memberRoles: z.number() }) })
  .meta({ id: 'RoleListItem' });

export const paginatedOrgRoles = listEnvelope(roleListItem, 'OrgRoles');

/** Roles-list extras returned by some list endpoints (e.g. dashboard/admin/roles). */
export const roleListCounts = z.object({
  defaultCount: z.number(),
  customCount: z.number(),
  rolesInUseCount: z.number(),
}).meta({ id: 'RoleListCounts' });

/** Permission grid row for the org permissions matrix (GET /api/admin/organizations/[orgId]/permissions). */
export const permissionGridRow = z
  .object({
    roleId: idField('Role ID'),
    roleName: z.string(),
    isDefault: z.boolean(),
    permissions: z.array(
      z.object({
        key: z.string(),
        resource: z.string(),
        action: z.string(),
        assigned: z.boolean(),
      }),
    ),
  })
  .meta({ id: 'PermissionGridRow' });

export const permissionsMatrix = z
  .object({
    roles: z.array(permissionGridRow),
    allPermissions: z.array(permission),
  })
  .meta({ id: 'PermissionsMatrix' });

/** Role-permission junction row (dashboard role permission assignments). */
export const rolePermissionAssignment = z
  .object({
    id: idField('RolePermission ID'),
    roleId: idField('Role ID'),
    permissionId: idField('Permission ID'),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'RolePermissionAssignment' });

export const rolePermissionsList = z.object({ permissions: z.array(rolePermissionAssignment) }).meta({
  id: 'RolePermissionsList',
});

/** Compact role row used by /api/roles/search cache + responses. */
export const roleSearchResult = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
  })
  .meta({ id: 'RoleSearchResult' });

/** User row as returned by UserService — memberships + team memberships included. */
export const userDetailRow = user.extend({
  members: z.array(
    z.object({ id: idField('Membership ID'), orgId: idField('Organization ID'), organization: z.object({ id: idField('Organization ID'), name: z.string() }) }),
  ).optional(),
  teamMembers: z.array(teamMember.extend({ team: z.object({ id: idField('Team ID'), name: z.string() }).optional(), organization: z.object({ id: idField('Organization ID'), name: z.string() }).optional() })).optional(),
}).meta({ id: 'UserDetailRow' });

// ---------------------------------------------------------------------------
// List envelopes (service PaginatedResult)
// ---------------------------------------------------------------------------

/** Platform-role row for the super-admin catalog (GET /api/admin/roles) — organization folded in. */
const adminRoleListRow = roleListItem
  .extend({ organization: z.object({ id: idField('Organization ID'), name: z.string() }) })
  .meta({ id: 'AdminRoleListRow' });

export const paginatedPlatformRoles = listEnvelope(platformRole, 'PlatformRoles');
export const paginatedPermissions = listEnvelope(permission, 'Permissions');
export const adminPlatformRolesList = listEnvelope(adminRoleListRow, 'AdminPlatformRoles');

/** Users list rows carry the member count projection from UserService.list (which also
 * folds in membership + team-membership includes). */
const userListRow = userDetailRow.extend({ _count: z.object({ members: z.number() }) }).meta({ id: 'UserListRow' });
export const paginatedUsers = listEnvelope(userListRow, 'Users');

/** Dashboard admin roles list — items + pagination + counts extras. */
export const dashboardAdminRolesList = z
  .object({
    items: z.array(roleListItem),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    counts: roleListCounts,
  })
  .meta({ id: 'DashboardAdminRolesList' });

/** Dashboard admin users list — items + pagination + count breakdown. */
export const dashboardAdminUsersList = z
  .object({
    items: z.array(userListRow),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
    counts: z.object({
      emailVerifiedCount: z.number(),
      bannedCount: z.number(),
      activeCount: z.number(),
    }),
  })
  .meta({ id: 'DashboardAdminUsersList' });

/** Dashboard admin teams list — { teams: [...] } + pagination. */
export const dashboardAdminTeamsList = z
  .object({
    teams: z.array(teamWithMemberCount),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
  })
  .meta({ id: 'DashboardAdminTeamsList' });

// ---------------------------------------------------------------------------
// Notifications (in-app)
// ---------------------------------------------------------------------------

export const notification = z
  .object({
    id: idField('Notification ID (cuid)'),
    title: z.string(),
    message: z.string(),
    priority: notificationPriority,
    scope: notificationScope,
    organizationId: z.string().nullable(),
    source: z.string().nullable().describe('e.g. "admin:message", "health-check:database"'),
    acknowledged: z.boolean(),
    createdAt: ts,
  })
  .meta({ id: 'Notification' });

/** Admin notifications listing row — adds resolved organization name. */
export const notificationAdmin = notification
  .extend({ organizationName: z.string().nullable() })
  .meta({ id: 'NotificationAdmin' });

/** Per-recipient outcome of send-today calendar notifications. */
export const sendNotificationResult = z
  .object({
    status: z.enum(['SENT', 'FAILED', 'RATE_LIMITED']),
    email: z.string().describe('Recipient email (the service row field is "email")'),
    error: z.string().optional().describe('Present on FAILED rows, e.g. "Email delivery failed"'),
  })
  .meta({ id: 'SendNotificationResult' });

export const sendTodayNotificationsResponse = z
  .object({
    results: z.array(sendNotificationResult),
    summary: z.object({ sent: z.number(), rateLimited: z.number(), failed: z.number() }),
  })
  .meta({ id: 'SendTodayNotificationsResponse' });

// ---------------------------------------------------------------------------
// Calendar (org-scoped)
// ---------------------------------------------------------------------------

/** CalendarService row shape — note: organizationId is deliberately NOT in the
 * returned object, so the wire row omits it. */
export const calendar = z
  .object({
    id: idField('Calendar ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    color: z.string().describe('Auto-assigned palette color theme, e.g. "#1B2A4A"'),
    isDefault: z.boolean(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Calendar' });

/** Recurrence details mapped from the stored rrule (present when the event repeats). */
export const eventRecurrenceDetails = z
  .object({
    frequency: recurrenceFrequency,
    interval: z.number().int(),
    endDate: ts.nullable().describe('Recurrence end (ISO), null when count-bounded or unlimited'),
    count: z.number().int().nullable().describe('Occurrence cap, null when date-bounded or unlimited'),
    byDay: z.string().nullable().describe('e.g. "MO,WE" — ISO day abbreviations'),
    byMonthDay: z.number().int().min(1).max(31).nullable().describe('Day-of-month filter (single value)'),
    excludedDates: z.array(z.string()).describe('Always [] — exdates live on the event row itself'),
  })
  .meta({ id: 'EventRecurrenceDetails' });

const calendarEventBase = z
  .object({
    id: idField('Event ID (cuid)'),
    title: z.string(),
    description: z.string().nullable(),
    startDate: ts,
    endDate: ts,
    eventType: calendarEventType,
    color: z.string().nullable(),
    calendarId: idField('Calendar ID'),
    // Service-mapped rows carry the parsed rule; raw-Prisma findFirst responses
    // (recurring PATCH with editScope) don't — hence optional.
    recurrence: eventRecurrenceDetails.nullable().optional(),
    rrule: z.unknown().nullable().describe('RFC 5545 recurrence rule (JSON) for recurring events'),
    exdates: z.array(z.string()).nullable().optional().describe('Excluded occurrence dates (YYYY-MM-DD)'),
    propertyId: z.string().nullable(),
    // Only on raw-Prisma findFirst responses (recurring PATCH with editScope).
    organizationId: idField('Organization ID').optional(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'CalendarEvent' });

export const calendarEvent = calendarEventBase;
export const calendarEventList = z.array(calendarEvent).meta({ id: 'CalendarEventList' });

/** Recurring-edit envelope returned by PATCH /calendar-events/[id] — editScope is
 * absent for non-recurring events (plain { event } payload). */
export const calendarEventUpdateResult = z
  .object({
    event: calendarEvent,
    editScope: z.enum(['this', 'following', 'all']).optional().describe('Recurring events only — which occurrences the update applied to'),
  })
  .meta({ id: 'CalendarEventUpdateResult' });

/** Recurring-edit envelope returned by PATCH /calendar-events/[id]. */
export const calendarEventWithEditScope = z
  .object({
    event: calendarEvent,
    editScope: z.enum(['this', 'following', 'all']).describe('Which occurrences the update applied to'),
  })
  .meta({ id: 'CalendarEventWithEditScope' });

// ---------------------------------------------------------------------------
// Job scheduler (platform)
// ---------------------------------------------------------------------------

export const jobDefinition = z
  .object({
    id: idField('Job ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    handlerKey: z.string(),
    scheduleExpr: z.string().describe("Schedule JSON string, e.g. { kind: 'cron', cron: '* * * * *' }"),
    timezone: z.string().nullable(),
    timeoutMs: z.number().nullable(),
    concurrencyLimit: z.number(),
    enabled: z.boolean(),
    approved: z.boolean(),
    approvedBy: z.string().nullable(),
    approvalNote: z.string().nullable(),
    lastRunAt: ts.nullable(),
    lastRunStatus: z.string().nullable(),
    platformOrgId: idField('Platform organization ID'),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'JobDefinition' });

export const jobExecution = z
  .object({
    id: idField('Execution ID (cuid)'),
    jobDefinitionId: idField('Job ID'),
    startedAt: ts,
    finishedAt: ts.nullable(),
    status: z.string().describe('PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED'),
    trigger: z.string().describe('SCHEDULE | MANUAL'),
    actorId: z.string().nullable(),
    error: z.string().nullable(),
    resultJson: z.unknown().nullable(),
    source: z.literal('job-scheduler:execution'),
    createdAt: ts,
  })
  .meta({ id: 'JobExecution' });

/** Platform jobs list (GET /api/admin/jobs & dashboard scripts) — paginated. */
export const paginatedJobs = z
  .object({
    items: z.array(jobDefinition),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
  })
  .meta({ id: 'PaginatedJobs' });

/** Dashboard scripts list — paginated jobs (listJobsPaginated) + stat-card counts.
 * Note: pagination here is { page, pageSize, total } only — no totalPages (clients derive it). */
export const dashboardScriptsList = z
  .object({
    items: z.array(jobDefinition),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
    counts: z.object({
      totalCount: z.number(),
      approvedCount: z.number(),
      unapprovedCount: z.number(),
      enabledCount: z.number(),
      disabledCount: z.number(),
    }),
  })
  .meta({ id: 'DashboardScriptsList' });

/** Script detail (dashboard) — definition + recent executions. */
export const scriptDetailResponse = z
  .object({
    job: jobDefinition,
    executions: z.array(jobExecution),
  })
  .meta({ id: 'ScriptDetailResponse' });

// ---------------------------------------------------------------------------
// Org chart (lib/org-chart.ts ChartTree)
// ---------------------------------------------------------------------------

export const orgChartRole = z.object({
  id: idField('Role ID'),
  name: z.string(),
  permissionCount: z.number(),
  permissions: z.array(z.string()).describe('Permission keys (resource:action)'),
}).meta({ id: 'OrgChartRole' });

export const orgChartMember = z
  .object({
    userId: idField('User ID'),
    name: z.string(),
    email: z.string().email(),
    image: z.string().nullable(),
    memberRole: z.string(),
    assignedRoles: z.array(orgChartRole),
    teams: z.array(z.string()).describe('Team slugs, primary first'),
  })
  .meta({ id: 'OrgChartMember' });

export const orgChartTeam = z
  .object({
    id: idField('Team ID'),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    members: z.array(orgChartMember),
  })
  .meta({ id: 'OrgChartTeam' });

export const orgChartTree = z
  .object({
    organization: z.object({
      id: idField('Organization ID'),
      name: z.string(),
      description: z.string().nullable(),
      status: orgStatus,
    }),
    teams: z.array(orgChartTeam),
    unassigned: z.array(orgChartMember).describe('Org members with no team membership'),
    viewerCanEdit: z.boolean(),
  })
  .meta({ id: 'OrgChartTree' });

// ---------------------------------------------------------------------------
// Health / metrics
// ---------------------------------------------------------------------------

const healthCheck = z
  .object({
    status: z.string().describe('healthy | unhealthy | degraded'),
    latency_ms: z.number().optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'HealthCheck' });

export const healthResponse = z
  .object({
    status: z.string().describe('healthy | unhealthy (drives HTTP 200 vs 503)'),
    timestamp: ts,
    uptime: z.number().describe('Process uptime in seconds'),
    checks: z.record(z.string(), healthCheck),
  })
  .meta({ id: 'HealthResponse' });

export const cacheMetricsResponse = z
  .object({
    l1: z.object({
      hits: z.number(),
      misses: z.number(),
      hitRate: z.number().describe('Percentage 0–100'),
      size: z.number().describe('Entries in the L1 cache'),
      memoryBytes: z.number(),
      memoryMB: z.number(),
    }),
    l2: z.object({
      hits: z.number(),
      misses: z.number(),
      hitRate: z.number().describe('Percentage 0–100 (Redis)'),
    }),
    redisConnected: z.boolean(),
  })
  .meta({ id: 'CacheMetricsResponse' });

export const cacheMetricsDetailResponse = z
  .object({
    success: z.literal(true),
    data: z.object({
      metrics: z.record(z.string(), z.number()),
      l1Details: z.object({ enabled: z.boolean(), maxSize: z.number(), maxEntrySize: z.number() }),
      timestamp: ts,
    }),
  })
  .meta({ id: 'CacheMetricsDetailResponse' });

export const payloadEncryptionMetrics = z
  .object({
    encryptedRequestCount: z.number(),
    encryptedResponseCount: z.number(),
    decryptionFailures: z.number(),
    unknownKeyIds: z.number(),
    expiredKeys: z.number(),
    replayDetections: z.number(),
    staleTimestamps: z.number(),
    payloadTooLarge: z.number(),
    replayCacheUnavailable: z.number(),
    plaintextPermissive: z.number(),
    keyIssuanceCount: z.number(),
    keyRateLimited: z.number(),
    responseEncryptionFailures: z.number(),
  })
  .meta({ id: 'PayloadEncryptionMetrics' });

// ---------------------------------------------------------------------------
// Session / permission context (auth)
// ---------------------------------------------------------------------------

export const sessionUserResponse = z
  .object({
    userId: idField('User ID'),
    email: z.string().email(),
    name: z.string(),
    activeOrganizationId: z.string().nullable(),
    organizationName: z.string(),
  })
  .meta({ id: 'SessionUserResponse' });

export const permissionContextResponse = z
  .object({
    userId: idField('User ID'),
    activeOrganizationId: z.string().nullable(),
    platformOrgId: z.string().nullable(),
    isSuperAdmin: z.boolean(),
    permissions: z.array(z.string()).describe("Permission keys, or ['*'] for super admin"),
  })
  .meta({ id: 'PermissionContextResponse' });

export const permissionListResponse = z.object({ permissions: z.array(permission) }).meta({
  id: 'PermissionListResponse',
});

// ---------------------------------------------------------------------------
// Resources (global catalog)
// ---------------------------------------------------------------------------

/** Resource row (global feature-module catalog). */
export const resourceRow = z
  .object({
    id: idField('Resource ID (cuid)'),
    name: z.string(),
    description: z.string().nullable(),
    createdAt: ts,
    updatedAt: ts,
  })
  .meta({ id: 'Resource' });

export const resourceList = z.object({ resources: z.array(resourceRow) }).meta({ id: 'ResourceList' });
export const paginatedResources = listEnvelope(resourceRow, 'Resources');

// ---------------------------------------------------------------------------
// Audit / notification logs
// ---------------------------------------------------------------------------

/** Audit log row (GET /api/admin/audit-logs). */
export const auditLogRow = z
  .object({
    id: idField('Audit log ID (cuid)'),
    timestamp: ts,
    userId: z.string().nullable(),
    userName: z.string().nullable(),
    action: z.string().describe('e.g. "organization.created", "role.deleted"'),
    resourceType: z.string().describe('e.g. "Organization", "Role", "Permission"'),
    resourceId: z.string().nullable(),
    organizationId: z.string().nullable(),
    success: z.boolean(),
  })
  .meta({ id: 'AuditLogRow' });

/** Audit log listing (GET /api/admin/audit-logs). */
export const auditLogList = z
  .object({
    auditLogs: z.array(auditLogRow),
    total: z.number(),
  })
  .meta({ id: 'AuditLogList' });

/** Notification log row (calendar-notifications/history). */
export const calendarNotificationLog = z
  .object({
    id: idField('Notification log ID (cuid)'),
    recipientEmail: z.string().email(),
    eventType: z.string(),
    message: z.string().nullable(),
    status: z.enum(['SENT', 'FAILED']).describe('Delivery status'),
    timestamp: ts,
  })
  .meta({ id: 'CalendarNotificationLog' });

/** Calendar notification history envelope. */
export const calendarNotificationHistory = z
  .object({
    logs: z.array(calendarNotificationLog),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
  })
  .meta({ id: 'CalendarNotificationHistory' });

// ---------------------------------------------------------------------------
// Search envelopes — { results, total } returned by /search endpoints
// ---------------------------------------------------------------------------

export function searchEnvelope<T extends z.ZodType>(item: T, idSuffix: string) {
  return z
    .object({
      results: z.array(item),
      total: z.number(),
    })
    .meta({ id: `Search${idSuffix}` });
}

export const searchOrganizationsResults = searchEnvelope(organization, 'Organizations');
export const searchUsersResults = searchEnvelope(user, 'Users');
export const searchPermissionsResults = searchEnvelope(permission, 'Permissions');

/** Compact catalog entry from GET /api/roles/permissions (select: key/resource/action/description only). */
const rolePermissionOption = z
  .object({
    key: z.string().describe('e.g. "properties:view"'),
    resource: z.string().describe('Resource segment, e.g. "properties"'),
    action: z.string().describe('Action segment, e.g. "view"'),
    description: z.string().nullable(),
  })
  .meta({ id: 'RolePermissionOption' });

export const rolePermissionsCatalog = z
  .object({ permissions: z.array(rolePermissionOption).describe('Master catalog, sorted by resource') })
  .meta({ id: 'RolePermissionsCatalog' });

/** Distinct resource types from the permission catalog (GET /api/admin/permissions/resources). */
export const permissionResourcesList = z
  .object({ resources: z.array(z.string()).describe('Sorted unique resource segments, e.g. "properties"') })
  .meta({ id: 'PermissionResourcesList' });
export const searchRolesResults = searchEnvelope(roleSearchResult, 'Roles');

// ---------------------------------------------------------------------------
// Payload encryption / session keys
// ---------------------------------------------------------------------------

/** Payload key issued by POST /api/security/payload-key. */
export const payloadKeyResponse = z
  .object({
    keyId: z.string(),
    algorithm: z.string(),
    expiresAt: ts,
    key: z.string().describe('Key material — treat as secret'),
    sessionId: z.string(),
  })
  .meta({ id: 'PayloadKeyResponse' });

// ---------------------------------------------------------------------------
// Role members (dashboard)
// ---------------------------------------------------------------------------

export const roleMembersList = z
  .object({
    members: z.array(
      z.object({
        id: idField('MemberRole ID'),
        member: user,
        roleId: idField('Role ID'),
        createdAt: ts,
      }),
    ),
  })
  .meta({ id: 'RoleMembersList' });

// ---------------------------------------------------------------------------
// Single-resource wrappers — the routes wrap created/updated rows in an
// object named after the resource
// ---------------------------------------------------------------------------

export const singleOrganization = z.object({ organization: organization }).meta({ id: 'SingleOrganization' });
export const singleUser = z.object({ user: user }).meta({ id: 'SingleUser' });
export const singleRole = z.object({ role: role }).meta({ id: 'SingleRole' });
export const singlePermission = z.object({ permission: permission }).meta({ id: 'SinglePermission' });
export const singleTeam = z.object({ team: teamWithDetails }).meta({ id: 'SingleTeam' });
export const singleCalendar = z.object({ calendar: calendar }).meta({ id: 'SingleCalendar' });
export const singleCalendarEvent = z.object({ event: calendarEvent }).meta({ id: 'SingleCalendarEvent' });
export const singleJob = z.object({ job: jobDefinition }).meta({ id: 'SingleJob' });
export const singleResource = z.object({ resource: resourceRow }).meta({ id: 'SingleResource' });

// ---------------------------------------------------------------------------
// Org members (admin org-scoped)
// ---------------------------------------------------------------------------

/** Member row with folded-in user (admin org member endpoints). */
export const memberWithUser = member.extend({
  user: z.object({ name: z.string(), email: z.string().email() }),
}).meta({ id: 'MemberWithUser' });

/** Org member list (GET /api/admin/organizations/[orgId]/members). */
export const orgMemberList = z.object({ members: z.array(member) }).meta({ id: 'OrgMemberList' });

export const addedMember = z.object({ message: z.string(), member: memberWithUser }).meta({ id: 'AddedMember' });
export const updatedMember = z.object({ message: z.string(), member: memberWithUser }).meta({ id: 'UpdatedMember' });

/** { success: true, message } — confirmation envelope (roles DELETE etc). */
export const successAcknowledgement = z
  .object({ success: z.literal(true), message: z.string() })
  .meta({ id: 'SuccessAcknowledgement' });

// ---------------------------------------------------------------------------
// Message confirmations with resource payloads
// ---------------------------------------------------------------------------

export const createdRole = z
  .object({
    message: z.string().describe('e.g. "Role created successfully"'),
    role: role,
  })
  .meta({ id: 'CreatedRole' });

/** Org-roles list — flat { roles } envelope (admin org-scoped GET). */
export const orgRolesList = z.object({ roles: z.array(roleListItem) }).meta({ id: 'OrgRolesList' });

/** DELETE /api/roles/{id} — success confirmation with message. */
export const roleDeletedResponse = z
  .object({
    success: z.literal(true),
    message: z.literal('Role deleted'),
  })
  .meta({ id: 'RoleDeletedResponse' });

/** Role-update acknowledgement (PATCH /api/admin/organizations/[orgId]/roles/[roleId]). */
export const updatedRole = z
  .object({
    message: z.string().describe('e.g. "Role updated"'),
    role,
  })
  .meta({ id: 'UpdatedRole' });

/** Organization update acknowledgement (PATCH /api/admin/organizations/[orgId] and [orgId]/settings). */
export const organizationUpdated = z
  .object({ message: z.literal('Organization updated'), organization })
  .meta({ id: 'OrganizationUpdated' });

/** Org status change response (PATCH .../{id}/status) — row limited to id/name/status. */
export const orgStatusChangeResponse = z
  .object({
    organization: z.object({ id: idField('Organization ID'), name: z.string(), status: orgStatus }),
  })
  .meta({ id: 'OrgStatusChangeResponse' });

/** Per-assignment outcome of a bulk permission assignment (PATCH [orgId]/permissions). */
export const permissionAssignmentResult = z
  .object({
    roleId: idField('Role ID'),
    permissionKey: z.string(),
    action: z.enum(['assigned', 'revoked']),
    success: z.boolean().describe('false when the role/permission does not exist in this org'),
  })
  .meta({ id: 'PermissionAssignmentResult' });

/** Bulk permission-batch acknowledgement (PATCH /api/admin/organizations/[orgId]/permissions). */
export const permissionsUpdateResponse = z
  .object({
    message: z.literal('Permissions updated'),
    results: z.array(permissionAssignmentResult),
  })
  .meta({ id: 'PermissionsUpdateResponse' });

/** Org switcher rows (GET /api/admin/organizations/list) — Platform entry first. */
export const organizationSwitcherList = z
  .object({ organizations: z.array(organizationOption) })
  .meta({ id: 'OrganizationSwitcherList' });

/** Team role list (GET /teams/[teamId]/roles). */
export const teamRolesList = z
  .object({ roles: z.array(role.describe('Role assigned to this team')) })
  .meta({ id: 'TeamRolesList' });

/** Dashboard admin stats (GET /api/dashboard/admin). */
export const dashboardAdminStats = z
  .object({
    users: z.object({ total: z.number() }),
    organizations: z.object({ total: z.number() }),
    teams: z.object({ total: z.number() }),
    roles: z.object({ total: z.number() }),
    permissions: z.object({ total: z.number() }),
  })
  .meta({ id: 'DashboardAdminStats' });

// ---------------------------------------------------------------------------
// Admin org detail — member rows as emitted by GET /api/admin/organizations/[orgId]
// (the unstable_cache include) and the members sub-resource. The route handler
// is responsible for the JSON serialisation of any non-serialisable values.
// ---------------------------------------------------------------------------

/** Member row inside admin org details (GET /api/admin/organizations/[orgId]). */
export const orgDetailMemberRow = z
  .object({
    id: idField('Membership ID'),
    userId: idField('User ID'),
    role: z.string(),
    user: z.object({ name: z.string(), email: z.string().email() }),
  })
  .meta({ id: 'OrgDetailMemberRow' });

/** Member row as emitted by tenantDb.member.findMany with memberRoles included. */
export const adminOrgMemberRow = memberWithUser.extend({
  memberRoles: z.array(
    z.object({
      id: idField('MemberRole ID'),
      roleId: idField('Role ID'),
      role: z.object({ name: z.string(), isDefault: z.boolean() }),
    }),
  ),
}).meta({ id: 'AdminOrgMemberRow' });

/** Org member list (cross-tenant, admin) — { members } envelope. */
export const adminOrgMemberList = z.object({ members: z.array(adminOrgMemberRow) }).meta({
  id: 'AdminOrgMemberList',
});

// ---------------------------------------------------------------------------
// Job scheduler extras
// ---------------------------------------------------------------------------

/** Platform jobs list (GET /api/admin/jobs) — { jobs } envelope, limit-bounded. */
export const jobDefinitionList = z.object({ jobs: z.array(jobDefinition) }).meta({ id: 'JobDefinitionList' });

/** Executions list for one job (GET /api/admin/jobs/{jobId}/history). */
export const jobExecutionList = z.object({ executions: z.array(jobExecution) }).meta({
  id: 'JobExecutionList',
});

/** RunResult — outcome of trigger/dry-run (job-scheduler-service.ts). */
export const runJobResult = z
  .object({
    jobDefinitionId: idField('Job ID'),
    executionId: z.string().optional(),
    status: z.enum(['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED']),
    claimed: z.boolean().describe('false → another tick already claimed this instant'),
    error: z.string().optional().describe('Present when status is FAILED'),
  })
  .meta({ id: 'RunJobResult' });

/** { result } wrapper returned by trigger/dry-run endpoints (HTTP 202). */
export const runJobResponse = z.object({ result: runJobResult }).meta({ id: 'RunJobResponse' });

/** approve/reject outcome (POST /api/admin/jobs/{jobId}/approvals). */
export const jobApprovalResponse = z
  .object({ job: jobDefinition, action: z.enum(['approve', 'reject']) })
  .meta({ id: 'JobApprovalResponse' });

/** disposeJob ack (DELETE /api/admin/jobs/{jobId}). */
export const jobDisposedResponse = z
  .object({ id: idField('Job ID'), deleted: z.literal(true) })
  .meta({ id: 'JobDisposedResponse' });

// ---------------------------------------------------------------------------
// Logs / metrics extras
// ---------------------------------------------------------------------------

/** System log list — placeholder endpoint (logs not wired yet). */
export const systemLogList = z.object({ logs: z.array(z.unknown()) }).meta({ id: 'SystemLogList' });

/** Audit log listing as returned by GET /api/admin/audit-logs. */
export const auditLogPage = z
  .object({
    auditLogs: z.array(auditLogRow),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number() }),
  })
  .meta({ id: 'AuditLogPage' });

// ---------------------------------------------------------------------------
// Single-resource wrappers — dashboard variants (bare rows, not enveloped)
// ---------------------------------------------------------------------------

/** Role row with permissions and member count (RoleService.getById). */
export const roleDetail = z
  .object({
    id: idField('Role ID'),
    name: z.string(),
    description: z.string().nullable(),
    isDefault: z.boolean(),
    organizationId: idField('Organization ID'),
    createdAt: ts,
    updatedAt: ts,
    permissions: z.array(
      z.object({
        id: idField('RolePermission ID'),
        permission: permission,
      }),
    ),
    _count: z.object({ memberRoles: z.number() }).optional(),
  })
  .meta({ id: 'RoleDetail' });

/** Role list item with org + nested member count (GET /api/admin/roles). */
export const platformRoleListItem = platformRole.extend({
  organization: z.object({ id: idField('Organization ID'), name: z.string() }).optional(),
  _count: z.object({ memberRoles: z.number() }).optional(),
}).meta({ id: 'PlatformRoleListItem' });

export const adminRolesPage = listEnvelope(platformRoleListItem, 'Roles');

/** Admin user list row — _count only (admin/users and dashboard variants). */
export const adminUserListRow = user.extend({ _count: z.object({ members: z.number() }) }).meta({
  id: 'AdminUserListRow',
});

export const adminUsersPage = listEnvelope(adminUserListRow, 'AdminUsers');

/** Resource row as returned by ResourceService list/getById — assigned roles included. */
export const resourceWithRoles = resourceRow.extend({
  resourceRoles: z.array(
    z.object({ id: idField('ResourceRole ID'), roleId: idField('Role ID'), role: role.optional() }),
  ),
}).meta({ id: 'ResourceWithRoles' });

/** Dashboard resource catalog list — items include assigned roles. */
export const paginatedResourcesWithRoles = listEnvelope(resourceWithRoles, 'ResourcesWithRoles');

/** Team member row as returned by TeamService.listTeamMembers — roles resolved separately. */
export const teamMemberRow = z
  .object({
    id: idField('TeamMember ID'),
    userId: idField('User ID'),
    user: z.object({ name: z.string(), email: z.string().email() }),
    createdAt: ts,
    roles: z.array(z.object({ id: idField('Role ID'), name: z.string() })),
  })
  .meta({ id: 'TeamMemberRow' });

export const teamMembersPage = z
  .object({
    members: z.array(teamMemberRow),
    pagination: z.object({ page: z.number(), pageSize: z.number(), total: z.number(), totalPages: z.number() }),
  })
  .meta({ id: 'TeamMembersPage' });

/** TeamRole row (team-role assignment junction). */
export const teamRole = z
  .object({
    id: idField('TeamRole ID'),
    teamId: idField('Team ID'),
    roleId: idField('Role ID'),
    organizationId: idField('Organization ID'),
    role: role.optional(),
    createdAt: ts,
  })
  .meta({ id: 'TeamRole' });

/** TeamRole junction row as returned by assignTeamRole (no role include). */
const createdTeamRole = z
  .object({
    id: idField('TeamRole ID'),
    teamId: idField('Team ID'),
    roleId: idField('Role ID'),
    organizationId: idField('Organization ID'),
    createdAt: ts,
  })
  .meta({ id: 'CreatedTeamRole' });

/** Single-resource wrappers for the org-scoped team surface (this surface envelopes rows, unlike the dashboard one). */
export const singleTeamMember = z.object({ teamMember: teamMember }).meta({ id: 'SingleTeamMember' });
export const singleTeamRole = z.object({ teamRole: createdTeamRole }).meta({ id: 'SingleTeamRole' });

/** Role member summary row (GET /api/dashboard/admin/roles/{id}/members). */
export const roleMemberSummary = z
  .object({
    memberId: idField('Membership ID'),
    userId: idField('User ID'),
    userName: z.string(),
    userEmail: z.string().email(),
  })
  .meta({ id: 'RoleMemberSummary' });

/** Role permissions list — flat permission rows (dashboard role detail). */
export const rolePermissionsFlat = z.object({ permissions: z.array(permission) }).meta({
  id: 'RolePermissionsFlat',
});

/** Permissions assigned to a user (GET /api/roles/permissions). */
export const permissionKeysList = z.object({ permissions: z.array(z.string()) }).meta({
  id: 'PermissionKeysList',
});

// ---------------------------------------------------------------------------
// Calendars — envelope wrappers
// ---------------------------------------------------------------------------

/** Calendar list endpoint returns a bare array (GET /…/calendar). */
export const calendarListBare = z.array(calendar).meta({ id: 'CalendarListBare' });

/** Calendar event list endpoints return a bare array (events / upcoming / today). */
export const calendarEventsBare = z.array(calendarEvent).meta({ id: 'CalendarEventsBare' });

/** Send today notification request body (calendar-notifications/send-today). */
export const sendTodayNotificationBody = z
  .object({
    userId: z.string().optional().describe('Notify this single user; omit for organization-wide (all members)'),
    eventIds: z.array(z.string()).optional(),
    notifyType: z.literal('TODAY_EVENTS').optional().describe("Default when omitted"),
  })
  .meta({ id: 'SendTodayNotificationBody' });

/** Today's-event row (calendar-notifications/today) — the notification-purposes subset. */
export const todayCalendarEvent = z
  .object({
    id: idField('Event ID (cuid)'),
    title: z.string(),
    description: z.string().nullable(),
    startDate: ts,
    endDate: ts,
    eventType: calendarEventType,
    color: z.string().nullable(),
  })
  .meta({ id: 'TodayCalendarEvent' });

export const todayCalendarEventsBare = z.array(todayCalendarEvent).meta({ id: 'TodayCalendarEventsBare' });

// ---------------------------------------------------------------------------
// Search results (bare row variants — the search endpoints emit { results, total })
// ---------------------------------------------------------------------------

/** Org search result row (id + name + slug only). */
export const orgSearchRow = z
  .object({ id: idField('Organization ID'), name: z.string(), slug: z.string().nullable() })
  .meta({ id: 'OrgSearchRow' });

export const orgSearchResults = searchEnvelope(orgSearchRow, 'OrganizationRows');

/** User search result row (id + name + email only). */
export const userSearchRow = z
  .object({ id: idField('User ID'), name: z.string(), email: z.string().email() })
  .meta({ id: 'UserSearchRow' });

export const userSearchResults = searchEnvelope(userSearchRow, 'UserRows');

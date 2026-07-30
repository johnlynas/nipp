# Design: Super Admin Tenant Management

## Technical Approach
- **API Routes:** Next.js App Router API routes under `/api/admin/organizations/[orgId]/...`
- **Auth Guard:** All new routes use `requireSuperAdmin()` inline guard (consistent with existing `/api/admin/permissions` pattern)
- **DB Access:** Use `globalDb` for cross-org lookups (e.g., verifying the target org exists); use `tenantDb` within `runWithTenant(orgId, ...)` for operations on that org's scoped data
- **UI:** Next.js App Router server components for data fetching, client components for forms/interactions. Property NI Navy & Amber design tokens.
- **Audit Logging:** All mutations logged via `recordAuditLog()` with `resourceType` indicating the specific sub-resource (e.g., "Organization.Member", "Organization.Role")

## Architecture Decisions

### Decision: Inline `requireSuperAdmin()` Guard on All New Routes
Use the inline `requireSuperAdmin()` pattern (as seen in `/api/admin/permissions/route.ts`) rather than the `withSuperAdmin()` middleware wrapper.
*Why:* Consistent with existing admin route patterns in the codebase, and each endpoint has slightly different input validation needs.

### Decision: Dual DB Client Pattern for Tenant Operations
When a Super Admin operates on a tenant org:
1. Use `globalDb` for cross-org queries (e.g., verify the target org exists, check Super Admin membership)
2. Use `tenantDb` within a `runWithTenant(orgId, ...)` context for operations on that specific org's scoped data (members, roles, permissions)
*Why:* This preserves the defense-in-depth tenant isolation. Even though Super Admins have global access, operations on a specific org's data go through the tenant-scoped client, ensuring RLS policies still apply.

### Decision: Reuse Existing Member/Role/Permission Models
Do not create new Prisma models. Operate on the existing `Member`, `Role`, `RolePermission`, and `Organization` models.
*Why:* These models already exist and are well-tested. The Super Admin tenant management feature is about access, not new data structures.

### Decision: Form-Based UI with Server Components
Use Next.js server components for initial data loading (fetch members, roles, permissions) and client components for interactive forms.
*Why:* Follows the established pattern in existing admin pages (`/admin/organizations/page.tsx`). Server components reduce client-side JS and enable direct DB access.

### Decision: Confirmation Dialogs for Destructive Actions
Require confirmation before deleting members, roles, or changing org status to SUSPENDED/ARCHIVED.
*Why:* Super Admins have root-level access; accidental deletions could be catastrophic. Confirmation dialogs provide a safety net.

### Decision: Audit Log Every Mutation
Every POST, PATCH, DELETE on tenant org data must be logged via `recordAuditLog()` with structured metadata including the Super Admin's userId, the target orgId, and the specific action.
*Why:* Full audit trail for compliance and debugging. Super Admin actions must be as traceable as tenant admin actions.

### Decision: Property NI Design System for All UI
All new UI components use the established Property NI Navy (`#1B2A4A`) and Amber (`#F5A623`) tokens via Tailwind CSS.
*Why:* Consistent user experience across the entire admin dashboard.

## UI Layout Structure

### Tenant Org Detail — Members Tab (`/admin/organizations/[orgId]/members`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Property NI Admin [Logout]                                           │
├──────────────────────────────────────────────────────────────────────┤
│ [Organizations] Permissions Audit Log                                │
├──────────────────────────────────────────────────────────────────────┤
│ ← Back to Organizations                                              │
│                                                                      │
│ Acme Properties Ltd — Members                                        │
│ Manage members of this organization                                  │
│                                                                      │
│ [+ Add Member]                                                       │
│                                                                      │
│ ────────────────────────────────────────────────────────────────    │
│ │ Name          │ Email              │ Role      │ Actions         │ │
│ ├───────────────┼────────────────────┼───────────┼─────────────────┤ │
│ │ John Doe      │ john@acme.com      │ [Member]  │ ✎ ✕             │ │
│ │ Jane Smith    │ jane@acme.com      │ [PM]      │ ✎ ✕             │ │
│ └───────────────────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tenant Org Detail — Roles Tab (`/admin/organizations/[orgId]/roles`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Property NI Admin [Logout]                                           │
├──────────────────────────────────────────────────────────────────────┤
│ [Organizations] Permissions Audit Log                                │
├──────────────────────────────────────────────────────────────────────┤
│ ← Back to Organizations                                              │
│                                                                      │
│ Acme Properties Ltd — Roles                                          │
│ Manage roles and permissions                                         │
│                                                                      │
│ [+ Create Role]                                                      │
│                                                                      │
│ ────────────────────────────────────────────────────────────────    │
│ │ Role Name       │ Default │ Members │ Permissions │ Actions       │ │
│ ├─────────────────┼─────────┼─────────┼─────────────┼───────────────┤ │
│ │ Member          │ ✓       │ 5       │ view        │ ✕ (protected) │ │
│ │ Property Manager│ ✓       │ 2       │ view,edit   │ ✎ ✕           │ │
│ │ Custom Viewer   │         │ 1       │ view        │ ✎ ✕           │ │
│ └───────────────────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tenant Org Detail — Permissions Tab (`/admin/organizations/[orgId]/permissions`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Property NI Admin [Logout]                                           │
├──────────────────────────────────────────────────────────────────────┤
│ [Organizations] Permissions Audit Log                                │
├──────────────────────────────────────────────────────────────────────┤
│ ← Back to Organizations                                              │
│                                                                      │
│ Acme Properties Ltd — Permissions                                    │
│ Assign permissions to roles                                          │
│                                                                      │
│ ────────────────────────────────────────────────────────────────    │
│ │ Role          │ Properties │ Tenants │ Maintenance │ Financial  │ │
│ ├───────────────┼────────────┼─────────┼─────────────┼────────────┤ │
│ │ Member        │ ☐          │ ☐       │ ☐           │ ☐          │ │
│ │ Property Mgr  │ ✓          │ ✓       │ ✓           │ ☐          │ │
│ │ Custom Viewer │ ☐          │ ☐       │ ☐           │ ☐          │ │
│ └───────────────────────────────────────────────────────────────    │
└──────────────────────────────────────────────────────────────────────┘
```

### Tenant Org Detail — Settings Tab (`/admin/organizations/[orgId]/settings`)

```
┌──────────────────────────────────────────────────────────────────────┐
│ Property NI Admin [Logout]                                           │
├──────────────────────────────────────────────────────────────────────┤
│ [Organizations] Permissions Audit Log                                │
├──────────────────────────────────────────────────────────────────────┤
│ ← Back to Organizations                                              │
│                                                                      │
│ Acme Properties Ltd — Settings                                       │
│ Modify organization configuration                                    │
│                                                                      │
│ Name:    [Acme Properties Ltd        ]                               │
│ Slug:    [acme-properties-ltd        ]                               │
│ Status:  [Active ▼]                                                  │
│                                                                      │
│ [Save Changes]                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Super Admin Lists Tenant Members (GET)
```
Browser → GET /api/admin/organizations/[orgId]/members
  ↓
Middleware: validate session cookie, extract userId
  ↓
Route handler: requireSuperAdmin(userId) → verify Platform Org membership
  ↓
superAdminStorage.run(true, async () => {
  // Verify target org exists (globalDb)
  const org = await globalDb.organization.findUnique({ where: { id: orgId } });
  
  // Fetch members within tenant context (tenantDb)
  const members = await runWithTenant(orgId, async () => {
    return tenantDb.member.findMany({
      include: { user: true },
    });
  });
  
  return members;
});
```

### Super Admin Adds Tenant Member (POST)
```
Browser → POST /api/admin/organizations/[orgId]/members { email, role }
  ↓
Middleware: validate session cookie, extract userId
  ↓
Route handler: requireSuperAdmin(userId) → verify Platform Org membership
  ↓
superAdminStorage.run(true, async () => {
  // Verify target org exists (globalDb)
  const org = await globalDb.organization.findUnique({ where: { id: orgId } });
  
  // Find or create user, add member within tenant context (tenantDb)
  const member = await runWithTenant(orgId, async () => {
    return tenantDb.member.create({ data: { userId: existingUserId, role } });
  });
  
  // Audit log (globalDb)
  await globalDb.auditLog.create({ data: { userId, action: 'member.created', resourceType: 'Organization.Member', resourceId: member.id, organizationId: orgId } });
  
  return member;
});
```

## Property NI Design System Reference

### Brand Colors (MANDATORY)
- **Navy Blue:** `#1B2A4A` (Headers, navigation bars, primary text)
- **Amber/Gold:** `#F5A623` (Primary buttons, CTAs, active states, focus rings)

### Component Patterns
- Tables: Use existing `DataTable` component pattern from `/admin/organizations/page.tsx`
- Forms: Use existing form patterns with `zod` validation + React Hook Form
- Buttons: Navy background for secondary actions, Amber for primary CTAs
- Badges: Green for Active, Amber for Pending, Red for Suspended

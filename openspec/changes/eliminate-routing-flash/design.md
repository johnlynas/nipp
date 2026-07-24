# Design: Server-Side Interception for Super Admin Routing

## 1. Architecture Decision: Server Component vs. Middleware
Next.js Middleware runs in the Edge runtime, which restricts the use of Node.js APIs and often complicates session decoding for authentication libraries like BetterAuth. 

Therefore, we will use a **Root Server Component** approach instead of Middleware. Server Components run in the Node.js runtime, allowing us to safely call `await auth.api.getSession()` and use Next.js's server-side `redirect()` function before the React tree is hydrated on the client.

## 2. Server-Side Redirect Flow
1. **Request Interception:** When a user navigates to the root path (`/`) or the default tenant dashboard path, the Server Component executes.
2. **Session Retrieval:** The component calls `auth.api.getSession({ headers })` to retrieve the current user's session.
3. **Role Evaluation:** The component checks the `role` field on the user object (e.g., `session.user.role === 'super_admin'`). 
4. **Execution:** If the user is a Super Admin, the Server Component calls `redirect('/admin/organizations')`. The HTTP response is a 307/308 redirect, and the tenant page is never painted.

## 3. Database Security Context (RLS Policies)
Our application relies on strict PostgreSQL Row Level Security (RLS) to enforce multi-tenancy. The database uses session variables (`app.current_user_id`, `app.current_org_id`, `app.platform_org_id`) to evaluate access. 

The current RLS policies in the database are:

| Table | Policy Name | Logic / Bypass Condition |
| :--- | :--- | :--- |
| **AuditLog** | `super_admin_bypass_audit_log_select` | Allows access if `organizationId` is NULL, matches current org, OR user is a member of the Platform org. |
| **AuditLog** | `super_admin_insert_audit_log` | Allows Super Admins to insert globally. |
| **Member** | `member_org_isolation` | Restricts to `orgId = current_org_id` OR user is a member of the Platform org. |
| **Organization** | `super_admin_bypass_organization` | Restricts to `id = current_org_id` OR user is a member of the Platform org. |
| **Permission** | `permission_read_all` | Global read access (`true`) for all authenticated users. |
| **Role** | `role_org_isolation` | Restricts to `organizationId = current_org_id`, `IS NULL`, OR user is a member of the Platform org. |

### Alignment with Routing
By routing Super Admins to `/admin` at the server level *before* the client renders, we prevent the application from accidentally triggering tenant-scoped Prisma queries (which would hit the `member_org_isolation` or `super_admin_bypass_organization` policies unnecessarily). This ensures the application flow perfectly mirrors our database security model.

## 4. Client-Side Hook Refactoring — Loading State Fix

### The Problem
The `RequireSuperAdmin` component currently evaluates `isSuperAdmin` before the async permission check completes. Since `isSuperAdmin` defaults to `false` or `undefined` during the fetch, the component immediately renders `<AccessDenied />`, creating a visible flash before the server-side redirect can take effect.

### The Solution
Refactor `RequireSuperAdmin` to implement a three-state evaluation:

```text
if (isLoading) → Render loading spinner (prevent any decision)
if (!isLoading && !isSuperAdmin) → Render <AccessDenied />
if (isSuperAdmin) → Render children
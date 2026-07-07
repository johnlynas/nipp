# Proposal: Authorization & Role-Based Access Control (RBAC)

## Intent
Implement a comprehensive, multi-tenant Role-Based Access Control (RBAC) system for the Property NI Portal. This proposal establishes the authorization engine, defining how permissions are stored, resolved, cached, and enforced across both the backend API and frontend UI.

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:
- **`project-initialization`**: Core architecture, tenant isolation, and BetterAuth setup.
- **`authentication-ui`**: Login flow, session management, and logout mechanics.

**Mandatory Rules from `project-initialization` enforced in this proposal:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed by authorization logic.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables (e.g., Redis URL).
- **Design System:** Property NI Navy & Amber tokens for any new UI components.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Logout Flow:** Cookie clearing, database session invalidation, and full page reload must continue to work exactly as implemented in `authentication-ui`.
- **Session Management:** Session augmentation must not interfere with session destruction or cross-tab invalidation.
- **Tenant Isolation:** All permission checks must respect the existing `organizationId` scoping.

## Scope
**In scope:**
- **Platform Organization:** Creation of a special "Platform Organization" to house Super Admins and support staff.
- **Permission Catalog:** Database-backed catalog of permissions using `resource:action` syntax (e.g., `properties:view`).
- **Default Roles:** Implementation of 7 default organization-scoped roles (Org Admin, Property Manager, Letting Agent, Accountant, Maintenance Staff, Tenant, Contractor).
- **Custom Roles:** Backend API and database structure allowing Organization Admins to create custom roles and map permissions to them.
- **Caching Strategy:** Redis integration to cache user permissions with a Time-To-Live (TTL) for performance.
- **Session Augmentation:** Modifying the BetterAuth session object to include resolved permissions for frontend use.
- **Frontend Authorization:** A `usePermission` hook to conditionally render UI elements based on user permissions.
- **Security Constraints:** Strict enforcement preventing non-Super Admins from being added to or modifying the Platform Organization.

**Out of scope (Deferred):**
- Full Administrative UI for managing custom roles and permissions (Backend APIs will be built, but the UI is deferred).
- Fine-grained field-level security (e.g., hiding specific columns in a table).
- Approval workflows or complex state-based permissions.

## Execution Boundary
This proposal will generate database schema updates, seed scripts, Redis configuration, backend authorization middleware, and frontend utility hooks. It will not implement the business logic for the property management features themselves, nor the UI for managing roles.

## Approach
Leverage the existing BetterAuth Organization plugin for base role assignment. Extend the database with `Permission`, `Role`, and `RolePermission` tables. Use Redis to cache the resolved permission sets per user to minimize database load. Augment the BetterAuth session callback to inject these permissions into the frontend session object.
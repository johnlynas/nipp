# Proposal: Super Admin Organization Management

## Intent
Implement the Super Admin dashboard for managing tenant organizations, custom roles, permissions, audit logging, and extreme event notifications. This proposal serves as the definitive integration test for the Authentication (`basic-authentication-login-flow`) and Authorization (`auth-and-rbac`) systems, proving that the multi-tenant organizational foundation works end-to-end. The Organization model is designed to be domain-agnostic, enabling reuse across different business verticals (property management, HR, healthcare, etc.).

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling (dot and dash variants), logout mechanics, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, Platform Organization security, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.

**Mandatory Rules Enforced:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed except through explicitly guarded Super Admin pathways.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables.
- **Test-Driven Completeness:** No code is considered "done" without passing tests. Every new library function, API route, and UI component must have corresponding unit tests. Integration tests must verify end-to-end flows. Mocking must follow strict hoisting rules.
- **Strict Property NI Design System Compliance:** ALL UI components MUST use the Property NI color palette. Navy (`#1B2A4A`) for primary elements. Amber (`#F5A623`) for accents, CTAs, and highlights. NO exceptions.
- **Import Path & Casing Consistency:** All imports MUST use correct PascalCase for component names. Import paths MUST use `@/` alias and match exact file casing.
- **Edge vs. Node Runtime Boundaries:** Middleware MUST NOT import Prisma or ioredis directly. Use cookie-only validation in middleware. Server components and API routes MUST lazy-load Node.js dependencies when called from Edge Runtime contexts.
- **Strict Platform Organization Gating:** All `/admin/*` pages, components, and API routes MUST be restricted exclusively to members of the Platform (Super Admin) Organization.
- **Conditional Root Routing:** The root route (`/`) must dynamically route Super Admins to `/admin/organizations`, while standard tenant users see the default homepage.

## Non-Regression Requirements
This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout, cross-tab session invalidation.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping, Platform Organization security guard.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.

## Scope

**In Scope:**
1. **Organization Schema Extension:** Add `status` field (pending, active, suspended, archived) and `slug` field to the Organization model.
2. **Database Migration:** Safe migration script for existing organizations (set to ACTIVE, generate slugs).
3. **Global Database Access:** Create an explicitly unscoped Prisma client (`lib/global-db.ts`) for Super Admin operations.
4. **Organization CRUD:** Full lifecycle management with enforced API pagination.
5. **Organization Lifecycle States:** `pending` → `active` → `suspended` → `archived` (terminal).
6. **Custom Role & Permission Management UI:** Super Admins (full CRUD across orgs + global catalog), Org Admins (custom roles only, default roles protected). Role deletion safety check.
7. **Audit Logging:** PostgreSQL-backed audit log for security-relevant admin actions. 1-year retention.
8. **Notification System:** Branded email notifications for extreme events. Fixed rules with 5-notification cap per event.
9. **Super Admin Dashboard UI:** `/admin/organizations` with list view, detail view, and global permissions management.
10. **Conditional Root Routing:** Super Admins land on `/admin/organizations`; tenant users land on default homepage.
11. **Strict Platform Gating:** All `/admin/*` pages wrapped with `<RequireSuperAdmin>`. Navigation conditionally rendered using `useIsSuperAdmin()`.
12. **Integration Verification:** Prove that auth, authz, and tenant isolation work correctly together.

**Out of Scope (Deferred):**
- WhatsApp notification channel (email only).
- Organization billing/subscription management.
- User impersonation ("Log in as" feature).
- Hard deletion of organizations (archive only).
- Bulk operations UI.

## Execution Boundary
This proposal will generate database schema updates, new API routes, new UI pages and components, audit logging infrastructure, and notification service code. It will not implement domain-specific business logic (properties, tenants, leases).

## Approach
Extend the Prisma schema with Organization status and slug fields. Create a safe migration script for existing data. Create a `lib/global-db.ts` module that provides an unscoped Prisma client, accessible only through `requireSuperAdmin()` route guards. Build the Super Admin dashboard using Next.js App Router. Use the new `<RequireSuperAdmin>` component to strictly enforce Platform Organization membership. Implement audit logging via a Prisma model and middleware. Implement notifications via a branded email service with rate limiting.
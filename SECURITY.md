# Security Architecture & Policies

This document outlines the security architecture, multi-tenancy isolation strategies, and authentication mechanisms implemented in the Property NI (nipp) portal.

## 🛡️ Defense-in-Depth Multi-Tenancy

Data isolation between organizations (tenants) is enforced using a strict, defense-in-depth approach. If one layer fails, the other acts as a safety net to prevent data leakage.

### Layer 1: Application-Level Isolation (Prisma `$extends`)
The primary enforcement mechanism lives in `lib/tenant-db.ts`. We utilize Prisma's native `$extends` API to intercept database queries at the application layer.
- **Context Propagation:** The current `organizationId` is stored in Node.js `AsyncLocalStorage` via middleware.
- **Query Interception:** The Prisma extension intercepts `findUnique`, `findFirst`, `findMany`, `update`, `delete`, `create`, and `upsert` operations for tenant-scoped models (`Role`, `RolePermission`, `MemberRole`).
- **Automatic Injection:** The extension automatically injects the `organizationId` into the `where` clauses (for reads/updates/deletes) and `data`/`create` payloads (for creates).
- **Fail-Safe:** If a query is executed against a scoped model without an active tenant context in `AsyncLocalStorage`, the extension throws an explicit error, preventing accidental global queries.

### Layer 2: Database-Level Isolation (PostgreSQL RLS)
As a secondary safety net, PostgreSQL Row Level Security (RLS) policies are applied to tenant-scoped tables. Even if the application layer is bypassed or misconfigured, the database engine will reject any query that attempts to access or modify rows belonging to a different `organizationId`.

## 🔐 Authentication & Session Management

Authentication is handled by [BetterAuth](https://www.better-auth.com/), configured in `lib/auth.ts`.

- **Session Cookies:** Sessions are managed via secure, HTTP-only cookies (`better-auth.session_token`).
- **Edge-Safe Middleware:** `middleware.ts` performs a fast, Edge-runtime-safe check for the presence of the session cookie. This avoids Prisma Edge Runtime crashes while ensuring unauthenticated users are instantly redirected to `/login`.
- **Cross-Tab Session Invalidation:** To prevent session bypasses across browser tabs, the logout handler (`authClient.signOut()`) forcefully revokes the session in the database, manually expires all BetterAuth cookies via `document.cookie`, and performs a hard `window.location.href` redirect to bust all client-side React/SWR caches.

## 👥 Role-Based Access Control (RBAC)

The application implements a granular RBAC system:
- **Permissions:** Atomic actions tied to resources (e.g., `properties:view`, `leases:create`).
- **Roles:** Collections of permissions assigned to users within a specific organization.
- **Super Admin Detection:** The system identifies "Super Admins" by checking if the user's active organization matches the designated Platform Organization ID (`PLATFORM_ORG_ID`).
- **UI & Route Protection:** Components like `<RequirePermission>` and middleware wrappers like `authz-route.ts` ensure users can only access UI elements and API endpoints they are explicitly authorized for.

## 🤫 Secrets Management

- **Environment Variables:** All secrets (Database URLs, API Keys, Auth Secrets) are strictly managed via `.env` files and are never hardcoded.
- **Pre-Commit Hooks:** A custom bash script (`scripts/check-secrets.sh`) runs via Husky before every commit to scan for accidental credential leaks (e.g., AWS keys, database passwords). If a secret is detected, the commit is blocked.
- **CSP Headers:** Content Security Policy (CSP) headers are configured in `next.config.ts` to mitigate Cross-Site Scripting (XSS) and data injection attacks.

## 🐛 Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not open a public GitHub issue. 

Instead, please report it via [Insert Your Email/Contact Method Here].

*Please include:*
- *A description of the issue.*
- *Steps to reproduce the vulnerability.*
- *Any potential impact or proof-of-concept code.*

We will acknowledge receipt of your report within 48 hours and work with you to understand and remediate the issue promptly.

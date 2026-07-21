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

The application implements a granular RBAC system that distinguishes between global identity and organizational authorization.

### Data Model Hierarchy
To support multi-tenancy, the following hierarchy is used:
- **`User` (Identity):** Represents a global entity. The `role` field here defines the **System Role** (e.g., `super_admin` vs `member`). This determines if the user has platform-wide privileges.
- **`Member` (Membership):** A junction table linking a `User` to an `Organization`. This represents the user's presence within a specific tenant.
- **`Role` (Tenant Authorization):** Organization-scoped role definitions (e.g., "Manager", "Technician").
- **`MemberRole` (Assignment):** A junction table linking a `Member` to one or more `Roles`. This allows a single user to hold multiple roles within one organization.
- **`RolePermission` (Capability):** Maps `Roles` to atomic `Permissions`.

### Authorization Logic & Flow
Authorization is enforced via a multi-layered logical flow:

1.  **Super Admin Bypass (Fast Path):** The system first checks if the user's global identity is a `super_admin`. If true, access is granted immediately. 
    *   **Note:** This "short-circuits" the permission resolver; Super Admins do not have their permissions cached in Redis because they bypass the granular check entirely.
2.  **Permission Resolution (Standard Path):** If not a Super Admin, the `resolvePermissions` function is called:
    *   **Cache Check:** It checks Redis for an existing permission set (`perm:${userId}:${orgId}`).
    *   **Database Fetch:** On a cache miss, it performs a join: `Member` $\rightarrow$ `MemberRole` $\rightarrow$ `RolePermission` $\rightarrow$ `Permission`.
    *   **Cache Write:** The resulting flattened list of permissions is written to Redis (TTL: 300s).
3.  **Enforcement:** The resulting permission list is compared against the required `resource:action` string.

### UI & Route Protection
- **Components:** `<RequirePermission>` and `<RequireSuperAdmin>` wrap UI elements. 
- **API Routes:** Use `hasPermission()` and `isSuperAdmin()` checks from `lib/authz.ts`.

## 🤫 Secrets Management

- **Environment Variables:** All secrets (Database URLs, API Keys, Auth Secrets) are strictly managed via `.env` files and are never hardcoded.
- **Pre-Commit Hooks:** A custom bash script (`scripts/check-secrets.sh`) runs via Husky before every commit to scan for accidental credential leaks (e.g., AWS keys, database passwords). If a secret is detected, the commit is blocked.
- **CSP Headers:** Content Security Policy (CSP) headers are configured in `middleware.ts` to mitigate Cross-Site Scripting (XSS) and data injection attacks. See the dedicated CSP section below for implementation details.

## 🛡️ Content Security Policy (CSP)

The application enforces a strict Content Security Policy via Edge Runtime middleware (`middleware.ts`) to mitigate Cross-Site Scripting (XSS) and data injection attacks. CSP is deployed in **Report-Only** mode initially, allowing us to monitor violations without blocking legitimate functionality.

### How It Works
1. **Nonce Generation:** On every request, a cryptographically secure random nonce is generated using `@/lib/csp-nonce`.
2. **Header Propagation:** The nonce is passed to the client via a custom `x-csp-nonce` header, allowing React components and scripts to dynamically inject the nonce into `<script>` tags.
3. **Directive Enforcement:** The middleware constructs a strict CSP string applied to the `Content-Security-Policy-Report-Only` header.

### Policy Directives
| Directive | Value | Rationale |
|-----------|-------|-----------|
| `default-src` | `'self'` | Blocks all resources not explicitly allowed. |
| `script-src` | `'self' 'nonce-${nonce}'` (+ `'unsafe-eval'` in dev) | Strict nonce-based execution. `unsafe-eval` is only allowed in development for Next.js Fast Refresh (HMR). |
| `style-src` | `'self' 'unsafe-inline'` | Next.js internal runtime injects inline styles. Browsers ignore `'unsafe-inline'` if a nonce is present in the same directive, so we omit the nonce here. |
| `img-src` | `'self' data: blob:` | Allows standard images, inline base64 data URIs, and blob URLs. |
| `font-src` | `'self' data:` | Allows standard fonts and base64-encoded font files. |
| `connect-src` | `'self'` | Restricts AJAX/Fetch/WebSocket connections to the same origin. |
| `frame-ancestors` | `'none'` | Prevents clickjacking by disallowing the app from being embedded in iframes. |
| `base-uri` / `form-action` | `'self'` | Prevents base tag hijacking and restricts form submissions to the same origin. |

### Development vs Production
- **Development:** `script-src` includes `'unsafe-eval'` to support Next.js Hot Module Replacement (Fast Refresh). All other directives remain strict.
- **Production:** `script-src` strictly uses the nonce only. No `'unsafe-inline'` or `'unsafe-eval'` is permitted for scripts, ensuring maximum XSS protection.

### Component Integration
React components consume the nonce via the `x-csp-nonce` header:
```tsx
import { headers } from 'next/headers';

export default function MyComponent() {
  const nonce = headers().get('x-csp-nonce') ?? '';
  return (
    <script nonce={nonce} dangerouslySetInnerHTML={{ __html: '/* inline script */' }} />
  );
}
```

### Safe Rollout Strategy
CSP is currently set via `Content-Security-Policy-Report-Only`. This logs violations to the browser console without blocking resources. Once validated, it can be switched to `Content-Security-Policy` for strict enforcement.

## 🐛 Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not open a public GitHub issue. 

Instead, please report it via [Insert Your Email/Contact Method Here].

*Please include:*
- *A description of the issue.*
- *Steps to reproduce the vulnerability.*
- *Any potential impact or proof-of-concept code.*

We will acknowledge receipt of your report within 48 hours and work with you to understand and remediate the issue promptly.

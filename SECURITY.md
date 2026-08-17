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
- **Auto-Logout on Inactivity:** See the [dedicated section](#-auto-logout-on-inactivity) below for details on automatic session termination after configurable idle periods.

## 🕒 Auto-Logout on Inactivity

The application automatically terminates sessions after a configurable period of user inactivity, protecting unattended devices from unauthorized access.

### How It Works
1. **Client-Side Detection:** A React hook (`hooks/useInactivityTimeout.ts`) listens for `mousemove`, `click`, `keydown`, `scroll`, and `touchstart` events on the window.
2. **Configurable Timeout:** The timeout duration is read from `INACTIVITY_TIMEOUT_MINS` (default: 15 minutes) via a server-side environment variable passed through React Context — no `NEXT_PUBLIC_` duplication.
3. **Warning Toast:** At `timeout - 30s`, a warning toast appears in the top-right corner, giving the user advance notice.
4. **Session Invalidation:** At timeout expiry, `signOutUser()` is called to delete the session from the database (BetterAuth), clear cookies, and perform a hard `window.location.href` redirect to `/login`.
5. **Activity Resets Timer:** Any tracked user interaction during the warning period dismisses the toast and restarts the countdown.
6. **Auth-Gated:** The timer only runs when a user has an active session — it returns early on unauthenticated pages (e.g., `/login`).

### Server-Side Session Backstop
Client-side detection is complemented by tight server-side session expiry:
| Setting | Value | Purpose |
|---|---|---|
| `session.expiresIn` | 1 hour (3600s) | Absolute maximum session lifetime |
| `session.updateAge` | 15 minutes (900s) | Sessions renew on any request when remaining time drops below this |

Active users making at least one server request per 45 minutes never hit the absolute expiry. If client-side detection is bypassed (JavaScript disabled, browser crash), the server rejects stale sessions after 1 hour maximum.

### Uniform Behavior
The inactivity timeout applies identically to all authenticated users — Super Admins (Platform Organization members) and tenant users alike. Each browser tab tracks inactivity independently.

### Configuration
| Variable | Default | Validation |
|---|---|---|
| `INACTIVITY_TIMEOUT_MINS` | `15` | Digits-only string, transformed to `number` via Zod schema |

### Files
| File | Role |
|---|---|
| `hooks/useInactivityTimeout.ts` | Client-side inactivity tracking hook with ref-stabilized event listeners |
| `components/providers/InactivityTimeoutConfig.tsx` | React Context provider bridging server env config to the client |
| `app/providers.tsx` | Unconditional `<Toaster />` and hook invocation |
| `app/layout.tsx` | Server component reads env var, wraps children in provider |
| `lib/auth.ts` | Tight session expiry configuration (1h absolute, 15m renewal) |
| `lib/env.ts` | Zod schema validation for `INACTIVITY_TIMEOUT_MINS` |

### Testing
- **Unit tests:** `tests/unit/useInactivityTimeout.test.tsx` (8 tests) — timer behavior, toast timing, cleanup on unmount.
- **Env schema tests:** `tests/unit/env-inactivity-timeout.test.ts` (15 tests) — validation, defaults, type transformation.

---

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

## 👥 Teams & Sub-Organization Security

BetterAuth's **Teams** plugin provides sub-organizational groupings within each tenant. Teams are fully subject to the same defense-in-depth tenant isolation as all other organization-scoped data.

### Data Model
| Model | Scope | Purpose |
|---|---|---|
| `Team` | Organization-scoped | Sub-organizational groupings (e.g., "Operations", "QA") |
| `TeamMember` | Organization-scoped | Junction linking users to teams |
| `TeamRole` | Organization-scoped | Team-level role definitions (mapped to org-scoped `Role`) |

### Tenant Isolation
- **Application Layer:** The Prisma `$extends` extension in `lib/tenant-db.ts` includes `Team`, `TeamMember`, and `TeamRole` in its tenant-scoped model list. All queries on these models are automatically filtered by `organizationId`.
- **Database Layer:** PostgreSQL RLS policies apply to team tables using the same `current_setting('app.current_org_id', true)` mechanism as other tenant-scoped tables.
- **Service Layer:** `services/team-service.ts` enforces authorization via `requireAnyAdmin()` context checks before any team mutation.

### Default Teams
Every organization bootstrapped via `prisma/seed.ts` receives a default **"Members"** team. In dev mode, an additional **"Platform Ops"** team is created for the Platform organization.

### API Endpoints
| Route | Methods | Access |
|---|---|---|
| `/api/organizations/[orgId]/teams` | GET, POST | Admin (tenant) |
| `/api/organizations/[orgId]/teams/[teamId]` | GET, PATCH, DELETE | Admin (tenant) |
| `/api/organizations/[orgId]/teams/[teamId]/members` | GET, POST, DELETE | Admin (tenant) |
| `/api/organizations/[orgId]/teams/[teamId]/roles` | GET, POST, DELETE | Admin (tenant) |

All team endpoints require an active tenant context and admin membership in the target organization.

## 📅 Calendar & Event Security

The interactive calendar (`components/calendar/`, `services/calendar*-service.ts`) stores organization-scoped events with optional recurrence rules. It is integrated into the Super Admin dashboard at `/dashboard/admin/calendar` and exposed via org-scoped REST endpoints.

### Data Model
| Model | Scope | Purpose |
|---|---|---|
| `Calendar` | Organization-scoped (`organizationId`) | Container/namespace for events (one default per org) |
| `CalendarEvent` | Organization-scoped (`organizationId`) | Individual events (local datetimes, optional property association) |
| `CalendarRecurrence` | Organization-scoped (`organizationId`) | 1:1 recurrence rule per event (`eventId @unique`, iCal-inspired fields) |

### Authorization (RBAC)
- **Route layer:** Every `/api/organizations/[orgId]/calendar*` route verifies the session (401) and membership in the URL's organization via `globalDb.member.findFirst` (403 for non-members), then derives `TENANT_ADMIN` / `MEMBER` from the member record.
- **Service layer:** Mutations (`createEvent`, `updateEvent`, `deleteEvent`, calendar create/update/delete) call `requireAnyAdmin(ctx)` — only tenant admins can modify data; members are read-only.
- **Permissions:** `calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete` are seeded into the permission catalog (resource `calendars`) for role-based assignment.

### Tenant Isolation — ✅ Resolved
Calendar models are now fully tenant-isolated via defense-in-depth:
- **Application layer (Prisma `$extends`):** `Calendar`, `CalendarEvent`, and `CalendarRecurrence` are registered in the `TENANT_SCOPED_MODELS` list (`lib/tenant-db.ts`). Any query on these models through the tenant-scoped client is automatically filtered by `organizationId`, and fails closed (throws) if no tenant context is active.
- **Service layer (explicit filters):** Every calendar service query filters by `organizationId` derived from the verified route context (`ctx.organizationId`) — including `getEventsWithRecurrences`, `getEventById`, `updateEvent`, `deleteEvent`, and `getUpcomingEvents` (which now applies its target org id to both the single-event and recurring-event queries). By-ID lookups (`getCalendarById`, `updateCalendar`, `deleteCalendar`) are likewise org-scoped.
- **Tests:** Calendar-specific isolation tests live in `tests/isolation/application/calendar-isolation.test.ts` (see `ISOLATION_TEST_STRATEGY.md`), verifying that reads/writes are scoped to the active organization and that cross-org access is blocked.

Because routes verify membership in the URL's organization **and** every service query filters by that same `organizationId`, an authenticated member of Org A can no longer read or modify Org B events by supplying their IDs/calendarId.

### API Endpoints
| Route | Methods | Access |
|---|---|---|
| `/api/organizations/[orgId]/calendar` | GET, POST | Member (read) / Admin (create) |
| `/api/organizations/[orgId]/calendar/[id]` | GET, PATCH, DELETE | Member (read) / Admin (mutate) |
| `/api/organizations/[orgId]/calendar-events` | GET, POST | Member (read) / Admin (create) |
| `/api/organizations/[orgId]/calendar-events/[id]` | GET, PATCH, DELETE | Member (read) / Admin (mutate) |
| `/api/organizations/[orgId]/calendar-events/upcoming` | GET | Member (read) |
| `/api/organizations/[orgId]/calendar-notifications/today` | GET | Member (read) |
| `/api/organizations/[orgId]/calendar-notifications/send-today` | POST | Admin |
| `/api/organizations/[orgId]/calendar-notifications/history` | GET | Admin |

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

## 🔒 Data-in-Transit Payload Encryption

**Status: Infrastructure complete — route-by-route migration in progress.**

Payload encryption is gated by `PAYLOAD_ENCRYPTION_MODE=disabled` (default). When enabled, selected PII-bearing API routes encrypt request and response bodies at the application layer using AES-256-GCM, on top of TLS transport encryption.

### Implementation Status (Phase 2)

| Component | Status |
|---|---|
| Environment variables (`lib/env.ts`) | ✅ Implemented |
| Logger PII redaction fields | ✅ Implemented |
| Payload format module (`lib/payload-format.ts`) | ✅ Implemented |
| Server crypto (`lib/crypto-server.ts`) | ✅ Implemented |
| Client crypto (`lib/crypto-client.ts`) | ✅ Implemented |
| Payload key store & issuance (`lib/payload-key-server.ts`) | ✅ Implemented |
| Key endpoint (`app/api/security/payload-key/route.ts`) | ✅ Implemented |
| PII route matcher (`lib/pii-routes.ts`) | ✅ Implemented — 11 patterns |
| Server middleware/wrapper (`lib/payload-middleware.ts`) | ✅ Implemented |
| Client key manager (`lib/payload-key-manager.ts`) | ✅ Implemented |
| Encrypted fetch wrapper (`lib/api-client.ts`) | ✅ Implemented |
| Unit tests (111 tests) | ✅ Passing |
| PII routes wrapped with `wrapPiiRoute()` | 🔄 In progress — 11 of ~20 PII routes wrapped |
| Client calls migrated to `encryptedFetch` | 🔄 In progress — 10 of ~20 client pages migrated |
| Integration tests | ❌ Planned |
| Browser/Playwright tests | ❌ Planned |

### Architecture Overview

| Layer | Component | File |
|---|---|---|
| Payload Key | Server-issued short-lived AES-256-GCM keys | `lib/payload-key-server.ts`, `app/api/security/payload-key/route.ts` |
| Encryption | AES-256-GCM with AAD (server) | `lib/crypto-server.ts` |
| Encryption | AES-256-GCM with AAD (browser, Web Crypto) | `lib/crypto-client.ts` |
| Format | Shared constants, binary helpers, validation | `lib/payload-format.ts` |
| Route Matching | PII route configuration and matcher | `lib/pii-routes.ts` |
| Middleware | Server route wrapper / helpers | `lib/payload-middleware.ts` |
| Client Key Manager | In-memory key fetching and caching | `lib/payload-key-manager.ts` |
| API Client | Encrypted fetch wrapper for PII calls | `lib/api-client.ts` |

### Key Bootstrap

The client obtains a short-lived payload encryption key from an authenticated server endpoint:

```
POST /api/security/payload-key
```

The server validates the BetterAuth session and returns:
- `keyId` — unique key identifier
- `algorithm` — always `aes-256-gcm`
- `expiresAt` — Unix timestamp (seconds) when the key expires
- `key` — base64url-encoded 32-byte key material

The client imports the key as a non-extractable AES-256-GCM `CryptoKey` and stores it only in memory. This preserves HTTP-only BetterAuth session cookies.

**Note:** The client key manager (`lib/payload-key-manager.ts`) is implemented and wired into API callers via `encryptedFetch`. React component integration continues in Phase 2.

### Payload Format

Encrypted payloads use a versioned binary format:
- 12-byte random nonce
- ciphertext (AES-GCM)
- 16-byte GCM authentication tag

HTTP headers for encrypted requests:
| Header | Value |
|---|---|
| `X-Payload-Encryption` | `v1` |
| `X-Payload-Key-Id` | key identifier |
| `X-Payload-Timestamp` | Unix timestamp (seconds) |
| `X-Payload-Nonce` | base64url random value |

### Request Context Binding (AAD)

Each encrypted payload is bound to the request context via AES-GCM Additional Authenticated Data, preventing replay and cross-route reuse. AAD includes:
- Protocol version (`v1`)
- Purpose (`request` or `response`)
- HTTP method
- URL pathname
- Key ID
- Session ID
- Timestamp / nonce

### Replay Protection

The server rejects requests with:
- Missing or unsupported payload versions
- Expired timestamps (outside configured window)
- Replayed request nonces (within replay window)
- Payloads sent to a different route or with a different HTTP method
- Invalid or expired payload keys

Replay nonces are validated server-side using a Redis-backed cache with TTL-based expiry. The replay protection logic is implemented in `lib/payload-middleware.ts` (`checkReplayProtection`, `checkReplayProtectionStrict`).

**Fail-closed behavior in enforce mode:** When `PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true` and the replay cache is unavailable, enforce-mode requests return HTTP 503 (`replay_cache_unavailable`) instead of proceeding without replay protection. This is the recommended configuration for production enforce mode.

**Multi-instance limitation:** The in-memory payload key store (`lib/payload-key-server.ts`) is single-instance only. Memory-only replay cache (`PAYLOAD_ENCRYPTION_REPLAY_CACHE=memory`) is also single-instance. For multi-instance deployments, both must be backed by Redis. Enforce mode **must not** be enabled on multi-instance deployments with in-memory stores.

### Feature Flag Modes

| Mode | Behavior |
|---|---|
| `disabled` (default) | No payload encryption is required or applied |
| `permissive` | Server accepts encrypted payloads; emits metrics for plaintext PII (migration-only) |
| `enforce` | Server requires encrypted payloads for configured PII routes |

**Note:** The feature flag enforcement logic is implemented in `lib/payload-middleware.ts`. Currently 11 routes are wrapped with `wrapPiiRoute()`, so enabling the flag will activate encryption for those routes. Additional routes are being assessed and migrated in Phase 2.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `PAYLOAD_ENCRYPTION_MODE` | `disabled` | Feature flag mode (`disabled`, `permissive`, `enforce`) |
| `PAYLOAD_ENCRYPTION_MAX_BYTES` | `65536` | Maximum encrypted payload size |
| `PAYLOAD_ENCRYPTION_KEY_TTL_SECONDS` | `300` | Payload key lifetime |
| `PAYLOAD_ENCRYPTION_REPLAY_WINDOW_SECONDS` | `30` | Replay protection window |
| `PAYLOAD_ENCRYPTION_NONCE_TTL_SECONDS` | `60` | Replay nonce cache TTL |
| `PAYLOAD_ENCRYPTION_REPLAY_CACHE` | `redis` | Replay cache backend (`memory`, `redis`) |
| `PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE` | `false` | Fail closed if replay cache unavailable (set to `true` for production enforce mode) |

**Production enforce mode requirements:**
- Set `PAYLOAD_ENCRYPTION_MODE=enforce`
- Set `PAYLOAD_ENCRYPTION_REQUIRE_REPLAY_CACHE=true`
- Use Redis-backed replay cache (`PAYLOAD_ENCRYPTION_REPLAY_CACHE=redis`)
- Do not enable on multi-instance deployments until payload key store is shared (Redis or database-backed)
- Integration and browser/Playwright tests must pass first

### Trust Boundaries

**Protected:** PII exposure in application logs, proxy logs, debug middleware, accidental plaintext serialization.

**Not Protected:** Malicious server-side code, malicious browser code (XSS), session theft, PII in URLs/query strings/headers.

### CSRF Protection

Payload encryption does **not** replace CSRF protection. PII mutating routes must continue to enforce:
- SameSite cookie attributes
- CORS restrictions
- CSRF tokens where applicable
- Content-type restrictions
- Origin checks

### Error Contract

| Condition | HTTP Status | Error Code |
|---|---:|---|
| Missing/invalid session | 401 | `unauthorized` |
| Missing payload key header | 400 | `missing_payload_key_id` |
| Unknown key ID | 401 | `payload_key_unknown` |
| Expired key | 401 | `payload_key_expired` |
| Invalid encrypted payload | 400 | `invalid_encrypted_payload` |
| Unsupported version | 400 | `unsupported_payload_version` |
| Payload too large | 413 | `payload_too_large` |
| Wrong content type | 415 | `unsupported_media_type` |

### Logging Policy

The logger (`lib/logger.ts`) redacts the following fields via Pino's `redact` configuration:

**Authentication & session:**
- `password`, `passwordHash`, `sessionToken`, `betterAuthSessionToken`
- `cookie`, `cookies`, `authorization`

**Personal data:**
- `email`, `phone`, `ssn`, `passportNumber`, `creditCard`

**API keys & secrets:**
- `apiKey`, `secret`, `token`

**Payload encryption (never log these):**
- `keyMaterial`, `payloadKey`
- `ciphertext`, `plaintext`

**Request/response bodies (never log full payloads):**
- `requestBody`, `responseBody`, `body`

Logs MUST NOT contain:
- Ciphertext or encrypted payloads
- Plaintext request/response bodies
- Payload keys, session tokens, or key material
- PII fields (redacted at the logger level)

Logs MAY contain: route, method, status, request ID, error code, payload size.

**Note:** Logger redaction uses Pino's `redact.paths` with wildcard matching (`*.field`). Nested PII in request/response bodies is redacted at the top level. Full redaction testing (including nested objects and error serialization) is planned.

---

## 🐛 Reporting a Vulnerability

If you discover a security vulnerability within this project, please do not open a public GitHub issue. 

Instead, please report it via [Insert Your Email/Contact Method Here].

*Please include:*
- *A description of the issue.*
- *Steps to reproduce the vulnerability.*
- *Any potential impact or proof-of-concept code.*

We will acknowledge receipt of your report within 48 hours and work with you to understand and remediate the issue promptly.

# Security Architecture & Policies

This document describes the security architecture, policies, and implementation details of the application. It covers multi-tenant isolation, authentication, authorization, data protection, content security policies, and logging.

The design follows three core principles:

- **Defense-in-depth**: Multiple independent security layers are applied so that a failure in one layer is caught by another.
- **Fail-closed**: When an error occurs, the system denies access rather than allowing it.
- **Least privilege**: Every operation is checked against the minimum permissions required for that action.

## Table of Contents

- [1. Multi-Tenant Isolation](#1-multi-tenant-isolation)
  - [Two-Layer Strategy](#two-layer-strategy)
  - [Application-Level Isolation (Prisma Extension)](#application-level-isolation-prisma-extension)
  - [Database-Level Isolation (PostgreSQL RLS)](#database-level-isolation-postgresql-rls)
  - [Tenant Context Propagation](#tenant-context-propagation)
  - [Global vs. Tenant-Scoped Models](#global-vs-tenant-scoped-models)
- [2. Authentication & Session Security](#2-authentication--session-security)
  - [BetterAuth Configuration](#betterauth-configuration)
  - [Session Lifecycle](#session-lifecycle)
  - [Cross-Tab Session Invalidation](#cross-tab-session-invalidation)
  - [Auto-Logout on Inactivity](#auto-logout-on-inactivity)
  - [User Ban System](#user-ban-system)
  - [Google OIDC Sign-In & Magic-Link Verification (in development)](#google-oidc-sign-in--magic-link-verification-in-development)
- [3. Authorization & Access Control](#3-authorization--access-control)
  - [Dual-Authorization Model](#dual-authorization-model)
  - [Permission Resolution Flow](#permission-resolution-flow)
  - [Domain-Specific Permission Modules](#domain-specific-permission-modules)
  - [Role Validation Utilities](#role-validation-utilities)
  - [Resource-Based Feature Access Control](#resource-based-feature-access-control)
- [4. Teams & Sub-Organization Security](#4-teams--sub-organization-security)
  - [Data Model](#data-model)
  - [Tenant Isolation](#tenant-isolation-1)
  - [Default Teams Bootstrapping](#default-teams-bootstrapping)
  - [API Endpoints](#api-endpoints)
- [5. Calendar Security](#5-calendar-security)
  - [Data Model](#data-model-1)
  - [Authorization Flow](#authorization-flow)
  - [Tenant Isolation](#tenant-isolation-2)
- [6. Data Protection](#6-data-protection)
  - [PII At-Rest Encryption](#pii-at-rest-encryption)
  - [Data-in-Transit Payload Encryption](#data-in-transit-payload-encryption)
  - [CSRF Protection](#csrf-protection)
  - [Secrets Management](#secrets-management)
- [7. Content Security Policy](#7-content-security-policy)
  - [CSP Directives](#csp-directives)
  - [Nonce Generation & Propagation](#nonce-generation--propagation)
- [8. Logging & PII Redaction](#8-logging--pii-redaction)
  - [Pino Logger Configuration](#pino-logger-configuration)
  - [PII Field List](#pii-field-list)
  - [Error Serialization Redaction](#error-serialization-redaction)
- [9. Security Configuration Reference](#9-security-configuration-reference)
  - [Environment Variables](#environment-variables)
  - [Rate Limiting Configuration](#rate-limiting-configuration)
  - [Trusted Proxies](#trusted-proxies)

## Appendices

- [A. API Route Security Summary](#appendix-a-api-route-security-summary)
- [B. Tenant-Scoped Model Inventory](#appendix-b-tenant-scoped-model-inventory)
- [C. Cross-References](#appendix-c-cross-references)

---

## 1. Multi-Tenant Isolation

### Two-Layer Strategy

Tenant isolation is enforced at two independent layers:

1. **Application level**: `lib/tenant-db.ts` (`tenantDb`) intercepts every
   operation on the 11 tenant-scoped models — `findUnique`, `findFirst`,
   `findMany`, `count`, `aggregate`, `groupBy`, `update`, `updateMany`,
   `delete`, `deleteMany`, `create`, `upsert` — and injects the verified org id
   (`organizationId`, `orgId` for BetterAuth models) into where/data. It fails
   closed when no verified tenant context is active: a context-less scoped query
   throws, it never silently widens. Verified platform-admin contexts pass
   through with the DB layer as authority (cross-tenant).

2. **Database level**: PostgreSQL Row-Level Security policies on all 18
   org-relevant tables (`prisma/migrations/20260919093000_rls_complete_policies`).
   The app connects as the NON-owner role `nipp_app`, so RLS applies to every
   query — including raw SQL and code paths the extension cannot intercept. The
   per-request context (`app.current_user_id` / `app.current_org_id` /
   `app.is_platform_admin` / `app.platform_org_id`) is set transaction-locally
   via `set_config(…, true)` by the single choke point
   `lib/rls-transaction.ts` on the SAME pinned interactive-transaction
   connection as the guarded query (verified: GUCs reset after commit, so
   pooling cannot leak context). Unwrapped queries reach Postgres with no GUCs
   and return zero rows — fail-closed by construction.

### Database-Level Isolation (PostgreSQL RLS)

Policies are audited by the ownership spec
(`tests/isolation/database/migrations-ownership.spec.ts`): it asserts no public
table is owned by `nipp_app` (a table owner bypasses its own policies), RLS is
enabled on exactly the 18 catalog tables, and the live `pg_policies` set hashes
to the committed golden file `tests/isolation/database/policy-catalog.golden` —
policy drift blocks merge.

### Tenant Context Propagation

Tenant context propagates via `AsyncLocalStorage` (`lib/tenant-context.ts`). It
is established at the route boundary from **server-verified inputs only**:

1. BetterAuth session → verified user id (`auth.api.getSession`)
2. Target org from the route, then access-checked: ordinary members → own org;
   platform-admin flag = ONE membership lookup in the platform org (fail-closed
   503 on lookup failure); everyone else → 403 before any query runs
3. `withRLSContext({userId, orgId, isPlatformAdmin}, op)` wraps the handler so
   ALS context and DB GUCs are bound for the same operation tree

### Tenant-Scoped Model Inventory (app layer + RLS)

| Model | Org column | App-layer ext | RLS policy | Notes |
|-------|-----------|---------------|------------|-------|
| Role | organizationId | ✓ | ✓ | per-tenant role definitions |
| RolePermission | organizationId | ✓ | ✓ | role ↔ permission grants |
| MemberRole | organizationId | ✓ | ✓ | user ↔ role assignments |
| Member | orgId | ✓ | ✓ | BetterAuth membership — authz-critical |
| Invitation | orgId | ✓ | ✓ | pending invitations |
| SentInvitation | orgId | ✓ | ✓ | invitation audit trail |
| Team | organizationId | ✓ | ✓ | sub-organizational groups |
| TeamMember | organizationId | ✓ | ✓ | team membership (+ PII linkage) |
| TeamRole | organizationId | ✓ | ✓ | role inheritance on teams |
| Calendar | organizationId | ✓ | ✓ | tenant calendars |
| CalendarEvent | organizationId | ✓ | ✓ | recurrence lives in JSON fields (rrule/exdates); there is no separate model |

Tables enforced **by RLS only** (no app-layer org injection — their visibility rules are richer than a single-column filter): Organization (per-command policies; UPDATE/DELETE = platform ops acting *on* the target org, which prevents self-privilege edits), AuditLog + NotificationLog (append-only for `nipp_app` — no UPDATE/DELETE policy by design; NULL-org global rows visible cross-tenant), Notification (org ∪ NULL-global reads, admin ack path on UPDATE, GLOBAL broadcasts stored with `organizationId = NULL`), JobDefinition / JobExecution (platform-only: `is_platform_admin` flag AND `app.platform_org_id` matching the row's `platformOrgId`), Permission (global catalog — platform sees all, tenants see only permissions assigned to their org's roles via RolePermission).

Exempt tables (no policy, documented): User / Session / Account (BetterAuth auth models containing no tenant data) and Resource / ResourceRole (global feature catalog; the sensitive side — which roles can use a resource — sits on org-scoped Role rows which ARE policied; `ResourceRole` has no direct org column by design, re-evaluate before any route ever queries it directly). All other models require a valid `tenantId` in the current request context.

---

## 2. Authentication & Session Security

### BetterAuth Configuration

Authentication is handled by [BetterAuth](https://www.better-auth.com/), configured in `lib/auth.ts`. Key configuration:

- **Providers**: Email/password is the only fully *user-facing live* sign-in method today. Google OIDC sign-in behind the "Sign in with Google" button is in development on branch `google-oidc` — its **server-side provider wiring is implemented** (see [below](#google-oidc-sign-in--magic-link-verification-in-development)); only the login UI, magic-link verification gate, and hardening remain. Its credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) are already required by the env schema (`lib/env-schema.ts`). No other providers are configured.
- **Cookie settings**: The session cookie uses `Secure` flag (HTTPS only) and `SameSite=Lax` to prevent CSRF via cross-site navigation.
- **Rate limiting**: Request rate limits are enforced:
  - General requests: 10 requests per 15 minutes
  - Sign-in attempts: 5 requests per 15 minutes (stricter to prevent brute force)

### Session Lifecycle

Sessions are managed with the following constraints:

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Absolute max duration | 1 hour | Sessions expire regardless of activity |
| Renewal interval | Every 15 minutes | Session is refreshed on active use within this window |
| Cache window | 30 seconds | Concurrent requests within this window share the same session state to avoid race conditions |
| Cross-tab invalidation | Enabled | Signing out in one tab invalidates sessions across all tabs |

The renewal interval ensures that long-lived browsing sessions are regularly refreshed without requiring re-authentication. The absolute maximum duration limits the window of compromise if a session token is stolen.

### Cross-Tab Session Invalidation

When a user signs out, the session is invalidated server-side and across all browser tabs. This is implemented by incrementing a session version counter in the database; each tab's client polls for this counter and signs out when it detects a change.

### Auto-Logout on Inactivity

Users are automatically logged out after 30 minutes of inactivity. The mechanism:

1. On each authenticated request, the "last active" timestamp is updated in the session store
2. A client-side heartbeat (every 60 seconds) keeps sessions alive during active use
3. When the inactivity threshold is reached, the client detects the expired session and triggers sign-out

### User Ban System

Users can be banned at any time. The `User` model includes three ban-related fields:

| Field | Type | Purpose |
|-------|------|---------|
| `banned` | Boolean | Whether the user is currently banned |
| `banReason` | String (nullable) | Reason for the ban, stored for audit purposes |
| `banExpires` | DateTime (nullable) | Optional expiry date; if set, the ban is temporary and auto-expires |

Ban enforcement happens in the authentication callback: when a user attempts to sign in or refresh their session, the system checks `banned` and `banExpires`. If a temporary ban has expired (`banExpires < now`), the ban is automatically cleared.

**All-methods enforcement (implemented on branch `google-oidc`):** this check previously ran on the email sign-in path only (`lib/auth.ts` route hook). Branch `google-oidc` consolidates it into `databaseHooks.session.create.before` via one shared exported helper (`enforceBanStatus(email)`) — the single point every successful sign-in funnels through with a resolved user id — so a banned user cannot bypass the ban by using Google (or any future method). The email route hook now calls the *same* helper (fast 401 on the login form, behavior unchanged). Expired-ban auto-clear happens in the same place for all doors. Behavior is pinned by `tests/integration/google-oidc.test.ts` (active ban rejected; expired ban lifts the flag).

### Google OIDC Sign-In & Magic-Link Verification (in development)

Google sign-in behind the login page's "Sign in with Google" button is being built on branch `google-oidc`. **Phase 1 (server-side) is implemented:** provider registration, PKCE state/nonce storage in a new Prisma `Verification` table, all-methods ban enforcement at session creation, and callback public-route verification. The login UI, magic-link gate, and hardening phases are still in build. Full design: [documents/feature-planning-and-development/google-oidc-design.md](./documents/feature-planning-and-development/google-oidc-design.md).

One security-relevant implementation note from Phase 1: the signed `state` nonce for each OAuth flow is **persisted in the Prisma `Verification` table** (BetterAuth's DB-backed state storage) and validated at callback time — a callback with an unknown/mismatched state is rejected with a redirect to BetterAuth's own error page (`/api/auth/error?error=state_mismatch`). The original plan assumed no schema change was needed; it was not — the table is mandatory for the CSRF control to work.

- **Flow.** Standard OAuth 2.0 authorization-code flow through BetterAuth's built-in `google` provider (`socialProviders.google`). The auth code never returns to the browser; BetterAuth performs a server-to-server token exchange and verifies the ID token (signature, audience, expiry, issuer) before any user row is touched. A signed per-flow `state` nonce guards the callback against CSRF injection.
- **Account linking.** One `User` row per person: returning Google identities sign in as their linked account; a Google email matching an existing password-only user **links** a new `Account(google, sub)` to that user (no shadow users); brand-new identities create a fresh `User` + `Account`.
- **Magic-link verification gate.** A brand-new Google identity's rows are created on first sign-in, but **no session is issued**: `databaseHooks.session.create.before` rejects session creation when the user has only a Google account and `oidcVerified = false`, and sends a one-time magic link to the (Google-asserted) email. The verify endpoint (`GET /auth/magic-link/verify?token=…`) consumes the token atomically from a `Verification` row, sets `User.oidcVerified = true`, and redirects — it **deliberately does not mint a session**. Sign-in completes on the user's second "Sign in with Google" click. Passwordless admin-created users follow the same emailed-link path; local (password) logins are untouched by design invariant.
- **Threat controls** (full table in the design doc):

| Threat | Control |
|--------|---------|
| CSRF on OAuth callback | signed `state` nonce per flow (BetterAuth) |
| Magic-link interception / replay | 32-char random token; stored in `Verification`, consumed atomically on verify; 5-minute expiry; verify route IP-rate-limited and session-less |
| Token enumeration | 192-bit random tokens, not enumerable |
| Open redirect via `callbackUrl` | same-origin guard on post-login navigation (login page); server callback URLs are hardcoded constants |
| Post-verification abuse | ban enforcement at session creation applies to both doors (above) |

- **Operational dependency.** Portal outbound mail delivers as its own mailbox, so per-user email forwarding must be configured for new OIDC users — a runbook item in the design doc (§6), and the first e2e diagnostic.

---

## 3. Authorization & Access Control

### Dual-Authorization Model

The system uses a dual-authorization model where access decisions consider both the user's global role and their tenant-specific role:

1. **User-level role** (`User.role`): A global role (e.g., "admin") that applies across all organizations the user belongs to. Admin users can access audit logs and perform cross-tenant operations.
2. **Tenant-level role** (`MemberRole`): A role within a specific tenant that defines what resources and actions the user is permitted to perform in that organization.

Both roles are checked for every protected operation:

```
isAuthorized(user.role, memberRole, action, resource) => boolean
```

The user-level role provides a baseline permission set; the tenant-level role refines or restricts those permissions within the specific organization context.

### Permission Resolution Flow

Permission resolution is implemented in `lib/permissions/resolver.ts` and uses a multi-level cache:

1. **L1 Cache (in-memory)**: Permission results are cached in a Map for the duration of the request. Subsequent checks within the same request hit this cache immediately.
2. **L2 Cache (Redis)**: Permission results are cached in Redis with a configurable TTL. This cache is shared across all instances of the application, ensuring consistency for concurrent requests from different servers.
3. **Database**: If neither cache hits, the resolver queries the database to compute permissions from the user's roles and the resource/permission definitions.

The resolver follows a top-down approach: it checks the user's global role first (faster path for admins), then falls back to tenant-level permission resolution.

### Domain-Specific Permission Modules

Permission logic is organized into domain-specific modules under `lib/permissions/`:

| Module | Purpose |
|--------|---------|
| `resolver.ts` | Core permission resolution engine with L1/L2 caching |
| `contractor.ts` | Contractor-specific permission rules (e.g., work order access) |
| `financial.ts` | Financial data permissions (invoices, payments, reports) |
| `maintenance.ts` | Maintenance task and work order permissions |
| `property.ts` | Property management permissions (listings, units) |
| `tenant.ts` | Tenant-specific permission rules |

Each module defines its own set of permission checks that are composed into the overall authorization decision. This separation keeps permission logic maintainable and allows domain experts to review their own rules.

### Role Validation Utilities

Role names are validated against a fixed allowlist defined in `lib/roles/validation.ts`:

| Function | Purpose |
|----------|---------|
| `isValidRoleName(name)` | Checks if a string is a valid role name |
| `getValidRoleNames()` | Returns the complete list of allowed role names |
| `assertValidRoleName(name)` | Throws if the name is not a valid role |

This prevents arbitrary role names from being used in authorization decisions and ensures consistency across the system.

### Resource-Based Feature Access Control

Beyond role-based access, the system supports feature-level access control through `Resource` and `ResourceRole` models:

- **Resource**: Represents a specific feature or resource within an organization (e.g., a tenant's access to the "financial module").
- **ResourceRole**: Binds an organization role (from `Role`) to a specific resource, defining what that role can do with that resource.

This allows organizations to enable or disable specific features for different roles without changing the core role definition. For example, an organization might grant "manager" access to the financial module for some users but not others.

---

## 4. Teams & Sub-Organization Security

### Data Model

Teams provide sub-organization structure within a tenant:

| Model | Purpose |
|-------|---------|
| `Team` | A sub-group within a tenant (e.g., "Maintenance", "Finance") |
| `TeamMember` | Membership of a user in a team, with a team-specific role |
| `TeamRole` | Role definitions within a team (separate from tenant-level roles) |

A user can have different roles at the tenant level and within each team they belong to. Team membership is determined by `TeamMember` records linking users to teams with specific team roles.

### Tenant Isolation

All team-related models (`Team`, `TeamMember`, `TeamRole`) are tenant-scoped. The Prisma extension automatically injects the tenant filter when querying team data, ensuring that users cannot access teams from other organizations.

### Default Teams Bootstrapping

When a new tenant is created, default teams are automatically bootstrapped (e.g., "Maintenance", "Finance"). These defaults provide a starting structure that organizations can customize.

### API Endpoints

Team management is exposed through the following route patterns:

| Pattern | Method | Access |
|---------|--------|--------|
| `/api/teams` | GET, POST | Tenant-scoped; user must be a team member |
| `/api/teams/:id` | GET, PUT, DELETE | Tenant-scoped; user must have team management permissions |
| `/api/teams/:id/members` | GET, POST, DELETE | Tenant-scoped; user must manage team membership |
| `/api/teams/:id/roles` | GET, POST, PUT, DELETE | Tenant-scoped; user must manage team roles |

---

## 5. Calendar Security

### Data Model

Calendar data is stored in three models:

| Model | Purpose |
|-------|---------|
| `Calendar` | A calendar belonging to a tenant (e.g., "Work Schedule") |
| `CalendarEvent` | An event within a calendar, with start/end times and recurrence rules |
| `CalendarRecurrence` | Recurring event patterns (daily, weekly, monthly, yearly) |

All three models are tenant-scoped. Each event belongs to a specific calendar, which in turn belongs to a specific tenant.

### Authorization Flow

Calendar access follows the dual-authorization model:

1. The user's tenant-level role is checked for calendar read/write permissions
2. If the user has admin privileges at the user level, they bypass tenant-level checks

Calendar events are not individually permissioned; access is determined at the calendar level. This means if a user can read a calendar, they can read all events within it.

### Tenant Isolation

Calendar data is isolated by tenant through the Prisma extension and RLS policies. The `tenantId` field on all calendar models ensures that queries from one tenant cannot access another tenant's calendars or events.

---

## 6. Data Protection

### PII At-Rest Encryption

PII (Personally Identifiable Information) stored in the database is encrypted at rest using AES-256-GCM. The implementation is in `lib/pii-crypto.ts`.

**Key management**: The encryption key is read from the `PII_ENCRYPTION_KEY` environment variable at startup. This key must be a valid hex-encoded 32-byte (256-bit) value.

**Encryption process**:
1. A random 12-byte nonce is generated for each encryption operation
2. The plaintext PII value is encrypted with AES-256-GCM using the key and nonce
3. The output format is: `nonce (hex) + ciphertext (hex) + auth tag (hex)`
4. The encrypted value is stored in the database as a single hex string

**Decryption process**:
1. The encrypted value is parsed into its nonce, ciphertext, and auth tag components
2. AES-256-GCM decryption is performed with the stored key
3. If authentication fails (tag mismatch), an error is thrown

**PII fields**: The following database columns are encrypted at rest:
- `User.firstName`, `User.lastName`
- `User.email` (when not used as auth identifier)
- `User.phone`, `User.address`
- `Organization.name` (when containing personal data)

PII encryption is applied at the application layer through Prisma middleware hooks and explicit encrypt/decrypt calls in route handlers.

### Data-in-Transit Payload Encryption

Payload encryption protects sensitive data transmitted between client and server. The implementation spans `lib/payload-key-server.ts`, `lib/payload-middleware.ts`, `lib/crypto-server.ts`, and `lib/crypto-client.ts`.

**Key lifecycle**:
1. **Generation**: A 32-byte symmetric key is generated for each payload using `generatePayloadKey()`
2. **Storage**: The key is stored in a `PayloadKeyStore` with the payload ID as the lookup key
3. **Encryption**: The client encrypts the payload data with this key using AES-256-GCM
4. **Transmission**: Only the encrypted data (not the key) is sent to the server
5. **Decryption**: The server retrieves the key from the store and decrypts the payload

**PayloadKeyStore interface**: The `PayloadKeyStore` interface defines how payload keys are stored and retrieved:

| Implementation | Use Case | Description |
|---------------|----------|-------------|
| In-memory store (default) | Single-instance deployments | Keys stored in a Map; keys are automatically cleaned up after TTL expiry |
| Redis-backed store | Multi-instance deployments | Keys stored in Redis with TTL; shared across all application instances |

The default in-memory store is sufficient for single-instance deployments. For multi-instance deployments (e.g., multiple server replicas behind a load balancer), the Redis-backed store ensures that any instance can retrieve the key generated by any other instance.

**Cleanup scheduler**: A background cleanup job (`startKeyCleanupScheduler()`) runs every 5 minutes to remove expired payload keys from the store. This prevents unbounded memory growth and ensures that old keys are not available for decryption after their intended lifetime.

**Replay protection**: To prevent replay attacks, the system uses a replay cache:
- Each payload is assigned a unique ID
- The first time a payload with a given ID is processed, it is recorded in the replay cache
- Subsequent requests with the same payload ID are rejected as replays

The replay cache supports two backends:
| Backend | Use Case | Description |
|---------|----------|-------------|
| In-memory (default) | Single-instance deployments | Replay entries stored in a Map with TTL expiry |
| Redis-backed | Multi-instance deployments | Replay entries shared across instances via Redis |

**Payload metrics**: The `lib/payload-metrics.ts` module tracks encryption/decryption performance and error rates, providing observability into the payload encryption system.

**PII routes**: The `lib/pii-routes.ts` module defines 9 route patterns for PII-specific operations (encrypt, decrypt, verify) with automatic encryption middleware applied to all requests.

### CSRF Protection

CSRF (Cross-Site Request Forgery) protection is implemented in `lib/csrf.ts`. The mechanism validates the origin of incoming requests to ensure they originate from trusted sources.

**Protection strategy**:
1. **Origin/Referer validation**: For state-changing requests (POST, PUT, DELETE), the `Origin` and `Referer` headers are validated against an allowlist of trusted domains
2. **Safe methods**: GET, HEAD, and OPTIONS requests are exempt from CSRF checks (they should not modify server state)
3. **Development relaxation**: In development mode, CSRF validation is relaxed to allow testing from arbitrary origins

**Implementation details**:
- Trusted domains are configured via the `TRUSTED_ORIGINS` environment variable (comma-separated list)
- The CSRF check is applied as middleware on all state-changing routes
- If validation fails, a 403 Forbidden response is returned

**Limitations**: CSRF protection in this implementation relies on header validation rather than token-based approaches. This is sufficient for same-origin applications but may need to be augmented with CSRF tokens if third-party integrations are introduced.

### Secrets Management

Secrets and configuration values are managed through environment variables:

- **Never committed**: No secrets, API keys, or credentials are committed to version control
- **Environment-specific**: Different environments (development, staging, production) use different secret values
- **Key rotation**: Encryption keys can be rotated by updating the relevant environment variable and re-encrypting affected data

---

## 7. Content Security Policy

### CSP Directives

Content Security Policy (CSP) headers are configured in `middleware.ts` to prevent XSS, clickjacking, and other code injection attacks. The policy differs between development and production:

| Directive | Development | Production |
|-----------|-------------|------------|
| `default-src` | `'self'` | `'self'` |
| `script-src` | `'self' 'unsafe-inline' 'unsafe-eval'` | `'self' <nonces>` |
| `style-src` | `'self' 'unsafe-inline'` | `'self' <nonces>` |
| `img-src` | `'self' data: blob:` | `'self' data: blob:` |
| `connect-src` | `'self' ws: wss:` | `'self' wss:` |
| `frame-ancestors` | `'none'` (relaxed in dev) | `'none'` |
| `base-uri` | `'self'` | `'self'` |
| `form-action` | `'self'` | `'self'` |

In production, inline scripts and styles are blocked by default; they must use nonces (see below) to be allowed.

### Nonce Generation & Propagation

CSP nonces are generated and managed in `lib/csp-nonce.ts`:

1. **Generation**: A cryptographically random nonce (32 bytes, base64-encoded) is generated for each request
2. **Header injection**: The nonce is added to the `Content-Security-Policy` header's `script-src` and `style-src` directives
3. **Client injection**: The nonce is made available to client-side code via a meta tag or global variable, so that dynamically created scripts can include the nonce attribute

This approach allows inline scripts to run without disabling CSP entirely. Each request gets a unique nonce, preventing replay attacks.

---

## 8. Logging & PII Redaction

### Pino Logger Configuration

The application uses [Pino](https://github.com/pinojs/pino) for structured logging, configured in `lib/logger.ts`. PII redaction is built into the logger configuration:

**Redaction paths**: Pino's `redact.paths` option is configured to automatically redact the following fields from all log output:

| Category | Fields |
|----------|--------|
| Authentication | `session.token`, `user.password`, `apiKey` |
| Personal data | `firstName`, `lastName`, `email`, `phone`, `address`, `ssn` |
| API credentials | `apiKey`, `apiSecret`, `accessToken`, `refreshToken` |
| Crypto material | `encryptionKey`, `privateKey`, `payloadKey` |

**Redaction behavior**: When any of these fields appear in a logged object, Pino replaces their values with `[REDACTED]` before writing to the log output. This ensures that PII never appears in log files, even if a developer accidentally logs a user object or request body.

### PII Field List

The complete list of fields that are redacted from logs includes:

- `session.token`, `user.password` — authentication credentials
- `firstName`, `lastName`, `email`, `phone`, `address`, `ssn` — personal identifiers
- `apiKey`, `apiSecret`, `accessToken`, `refreshToken` — API credentials
- `encryptionKey`, `privateKey`, `payloadKey` — cryptographic material

This list is maintained in the logger configuration and should be updated whenever new PII fields are added to the data model.

### Error Serialization Redaction

The `redactLogObject()` utility in `lib/logger.ts` provides additional redaction for error objects that may contain PII:

1. **Property filtering**: The utility iterates over an object's own properties and redacts any that match the PII field list
2. **Stack trace sanitization**: File paths in stack traces are redacted to remove local filesystem details (e.g., `/Users/john/...` is replaced with `[REDACTED]`)
3. **Recursive application**: The redaction is applied recursively to nested objects, ensuring that PII in deeply nested structures is also caught

This utility is used when logging error objects to ensure that stack traces and error context do not leak PII or internal file paths.

---

## 9. Security Configuration Reference

### Environment Variables

The following environment variables control security-relevant behavior:

| Variable | Purpose | Required |
|----------|---------|----------|
| `PII_ENCRYPTION_KEY` | AES-256 encryption key for PII at-rest (hex-encoded, 32 bytes) | Yes |
| `TRUSTED_ORIGINS` | Comma-separated list of trusted domains for CSRF validation | Yes |
| `TRUSTED_PROXY_CIDRS` | CIDR ranges of trusted reverse proxies for real client IP extraction | No (defaults to localhost) |
| `SESSION_SECRET` | Secret used for signing session cookies | Yes |
| `GOOGLE_CLIENT_ID` | Google OIDC client id (required by `lib/env-schema.ts`; consumed by the in-development sign-in) | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OIDC client secret (as above); magic-link emails additionally use the existing `SMTP_*` vars and `FRONTEND_URL` as the link host | Yes |
| `DATABASE_URL` | PostgreSQL connection string (includes credentials) | Yes |
| `REDIS_URL` | Redis connection string for caching and replay cache (optional) | No |
| `NODE_ENV` | Environment mode (`development`, `production`) — affects CSP strictness and CSRF relaxation | Yes |

### Rate Limiting Configuration

The application uses a unified rate limiting system with three distinct implementations, each configurable via environment variables with sensible defaults.

#### HTTP Route Rate Limiting (In-Memory)

Used by payload-key endpoints to prevent abuse of cryptographic key operations. All thresholds are configurable:

| Variable | Purpose | Default |
|----------|---------|---------|
| `RATE_LIMIT_PAYLOAD_KEY_MAX` | Max requests per window for key issuance | 30 |
| `RATE_LIMIT_PAYLOAD_KEY_WINDOW` | Window duration in seconds for key issuance | 60 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_MAX` | Max requests per window for key revocation | 5 |
| `RATE_LIMIT_PAYLOAD_KEY_REVOKE_WINDOW` | Window duration in seconds for key revocation | 60 |

The payload-key issuance endpoint uses a stricter limit (30 req/min) while revocation is capped at 5 req/min to prevent brute-force key destruction. Stores are in-memory and cleaned up every 5 minutes (entries older than 2× the window).

#### Notification Rate Limiting (Redis-Backed)

Used by the notification dispatcher to prevent email flooding. Configurable via:

| Variable | Purpose | Default |
|----------|---------|---------|
| `RATE_LIMIT_NOTIFICATION_MAX` | Max notifications per event type/recipient/window | 5 |
| `RATE_LIMIT_NOTIFICATION_WINDOW_HOURS` | Window duration in hours for notifications | 24 |

The notification rate limiter uses Redis for cross-instance consistency (important in multi-server deployments). Each event type and recipient gets an independent counter, so a user can receive notifications for different event types without sharing the same quota.

#### Authentication Rate Limiting (BetterAuth)

BetterAuth provides built-in rate limiting for authentication endpoints:

| Endpoint Category | Limit | Window |
|-------------------|-------|--------|
| General requests | 10 requests | 15 minutes |
| Sign-in attempts | 5 requests | 15 minutes |

These limits are enforced per-IP address. The stricter limit on sign-in attempts is designed to prevent brute-force password attacks. In addition, every POST under `/api/auth/*` passes through the route-level IP rate limit (`checkAuthRateLimit`) in `app/api/auth/[...all]/route.ts`, so social sign-in (`/api/auth/sign-in/social`) inherits the same per-IP window as email login — and the planned magic-link verify endpoint will do the same.

#### Rate Limiting Across API Routes

The unified rate limiter module (`lib/rate-limiter.ts`) is designed to be shared across all routes. Currently applied to:

| Route Group | Rate Limiting Applied |
|-------------|----------------------|
| `POST /api/security/payload-key` (issuance) | ✅ 30 req/min per session |
| `POST /api/security/payload-key/revoke` | ✅ 5 req/min per session |
| Notification dispatcher (email sending) | ✅ 5 per event type/recipient/24h |
| Auth endpoints (`/api/auth/*`) | ✅ BetterAuth built-in limits |
| Admin/Dashboard-Admin routes (`/api/admin/*`, `/api/dashboard/admin/*`) | ❌ Not yet rate limited — priority for future implementation |
| Organization routes (`/api/organizations/*`) | ❌ Not yet rate limited — priority for future implementation |
| Role routes (`/api/roles/*`) | ❌ Not yet rate limited — priority for future implementation |
| `POST /api/csp-report` | ❌ Not yet rate limited — ingestion endpoint needs protection |

See [Unified Rate Limiting Design](./openspec/changes/unified-rate-limiter/design.md) for the full architecture and plans to extend rate limiting to unprotected routes.

### Trusted Proxies

When the application runs behind a reverse proxy (e.g., nginx, Cloudflare), the real client IP is extracted from the `X-Forwarded-For` header. The `TRUSTED_PROXY_CIDRS` configuration specifies which IP ranges are trusted to provide this header.

Only requests from trusted proxy IPs will have their forwarded headers honored; requests claiming to be from a trusted proxy but arriving directly are ignored. This prevents IP spoofing by untrusted clients.

---

## Appendix A: API Route Security Summary

The following table summarizes the security characteristics of all API route groups in the application:

| Route Group | Authentication Required | Tenant-Scoped | CSRF Protected | PII Encrypted |
|-------------|------------------------|---------------|----------------|---------------|
| Auth routes (`/api/auth/*`) | No (login/signup) | No | Yes | No |
| Tenant routes (`/api/tenants/*`) | Yes | Yes (self) | Yes | No |
| Team routes (`/api/teams/*`) | Yes | Yes | Yes | No |
| Calendar routes (`/api/calendars/*`) | Yes | Yes | Yes | No |
| PII routes (`/api/pii/*`) | Yes | Yes | Yes | Yes (at-rest + in-transit) |
| Permission routes (`/api/permissions/*`) | Yes | Yes | Yes | No |

All authenticated routes require a valid session cookie. Tenant-scoped routes verify the `tenantId` context before processing any request.

---

## Appendix B: Tenant-Scoped Model Inventory

The complete inventory, current after the RLS rollout (org column is `organizationId`
— historical docs referenced a nonexistent `tenantId`; recurrence is a JSON field on
CalendarEvent, not a model):

| Model | Org column | App-layer (tenantDb) | RLS policy | Notes |
|-------|-----------|----------------------|------------|-------|
| Role | organizationId | ✓ | ✓ | Tenant-level role definitions |
| RolePermission | organizationId | ✓ | ✓ | Permission grants for roles |
| MemberRole | organizationId | ✓ | ✓ | User-to-role assignments within a tenant |
| Member | orgId | ✓ | ✓ | Tenant membership records (authz-critical) |
| Invitation | orgId | ✓ | ✓ | Pending tenant invitations |
| SentInvitation | orgId | ✓ | ✓ | Previously sent invitations (audit) |
| Team | organizationId | ✓ | ✓ | Sub-organization groups |
| TeamMember | organizationId | ✓ | ✓ | Team membership records |
| TeamRole | organizationId | ✓ | ✓ | Roles assigned to teams (inheritance) |
| Calendar | organizationId | ✓ | ✓ | Tenant calendars |
| CalendarEvent | organizationId | ✓ | ✓ | Events incl. recurrence JSON fields |

RLS-only tables (see Two-Layer Strategy above): Organization, AuditLog,
NotificationLog, Notification, JobDefinition, JobExecution, Permission. (Permission writes — create/update/delete via `/api/dashboard/admin/permissions` — are additionally gated at the DB layer to verified platform admins only: `rls_permission_platform_insert`/`_update`/`_delete` on the `is_platform_admin` flag; tenants have no catalog write path.)
Exempt: User, Session, Account, Resource, ResourceRole.

---

## Appendix C: Cross-References

This document covers security-specific details. For broader architectural context, see:

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Overall system architecture, data flow, and component interactions |
| [CACHING_ARCHITECTURE.md](./CACHING_ARCHITECTURE.md) | Caching strategy, Redis usage, and cache invalidation patterns |
| [QUICK_START.md](./QUICK_START.md) | Getting started guide for developers |
| [Google OIDC design doc](./documents/feature-planning-and-development/google-oidc-design.md) | Google sign-in flow, account-linking semantics, magic-link verification and its threat table (in development) |

---

*Last updated: 2026-10-03*
*Document owner: Engineering Team*

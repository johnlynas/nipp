# Proposal: Auto-Logout on Inactivity

## Intent
Implement an automatic session logout mechanism that triggers after a configurable period of user inactivity. The timeout is controlled by the `INACTIVITY_TIMEOUT_MINS` environment variable (default: 15 minutes). When triggered, the user receives a 30-second warning toast before being logged out and redirected to `/login`.

This applies uniformly to all authenticated users — Super Admins in the Platform organization and ordinary users in tenant organizations.

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules established in:
- **`project-initialization`**: Core architecture, tenant isolation, and BetterAuth setup.
- **`basic-authentication-login-flow`**: Login flow, session management, and logout mechanics.
- **`auth-and-rbac`**: Session augmentation with permissions (must not interfere).

**Mandatory Rules enforced in this proposal:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Secrets Management:** New env var added to `.env.example` — no real secrets committed.
- **Design System:** Property NI Navy & Amber tokens for any new UI components (warning toast).

## Non-Regression Requirements
This proposal MUST NOT break any existing functionality:
- **Logout Flow:** The existing `signOutUser()` flow in `lib/auth-client.ts` (cookie clearing + redirect) must continue to work exactly as implemented.
- **Session Management:** BetterAuth session configuration changes (shorter expiry) must not invalidate sessions prematurely during active use.
- **Authentication:** Login, session refresh via `updateAge`, and middleware-based route protection must continue to work.
- **Multi-Tenant:** Both Super Admin (Platform org) and tenant users must experience identical inactivity behavior.

## Scope
**In scope:**
- **Environment Variable:** Add `INACTIVITY_TIMEOUT_MINS` (default: 15, in minutes) to the env schema and `.env.example`.
- **Server-Side Session Tightening:** Update BetterAuth's `session.expiresIn` in `lib/auth.ts` to match the configured timeout, so stale sessions are rejected server-side.
- **Client-Side Inactivity Hook:** Create `hooks/useInactivityTimeout.ts` that listens for mousemove, click, and keydown events. Resets a timer on each event; fires logout when the timeout expires.
- **Warning Toast:** Display a toast notification 30 seconds before the timeout, giving the user a chance to stay active (any interaction dismisses it and resets the timer).
- **Toast Library:** Add `sonner` as a lightweight toast dependency (no existing toast library is installed).
- **Layout Integration:** Place the `useInactivityTimeout` hook in a top-level layout so it applies to all authenticated routes (both admin and dashboard).

**Out of scope (Deferred):**
- Per-user or per-role timeout configuration (all users share the same env-driven value).
- "Stay signed in" extended session option.
- Server-side heartbeat / ping mechanism to track activity on the backend.
- Cross-tab or cross-device logout (each tab tracks independently).

## Execution Boundary
This proposal generates a new React hook, a layout integration point, env schema updates, BetterAuth config changes, and one UI component (the warning toast via `sonner`). It does not modify any business logic, API routes, database schema, or authorization rules.

## Approach
1. **Env Schema:** Add `INACTIVITY_TIMEOUT_MINS` to `lib/env.ts` (Zod schema, default `"15"`) and `.env.example`.
2. **Server-Side:** Read the env var in `lib/auth.ts` and set `session.expiresIn` to match (converted to seconds). This ensures the server rejects sessions that have been idle beyond the configured timeout.
3. **Client-Side Hook:** Create `hooks/useInactivityTimeout.ts`:
   - Uses `useEffect` to attach event listeners for `mousemove`, `click`, and `keydown`.
   - Starts a countdown timer on mount.
   - Fires a warning toast via `sonner` at `timeout - 30s`.
   - Fires the actual logout (via `signOutUser()` from `lib/auth-client.ts`) at timeout.
   - Any tracked event resets the timer and dismisses any pending warning.
4. **Layout Integration:** Wrap the hook in `app/providers.tsx` (or a new layout wrapper) so it runs for all authenticated pages.
5. **Toast Library:** Install `sonner` — lightweight, zero-config, works well with Next.js App Router.

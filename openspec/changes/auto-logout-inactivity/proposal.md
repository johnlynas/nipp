# Proposal: Auto-Logout on Inactivity

**Status:** Proposed
**Author:** John Lynas
**Created:** 2026-08-03
**Last Updated:** 2026-08-03
**Related Issues:** Security initiative, Session management hardening

## Summary
Implement an automatic session logout mechanism that triggers after a configurable period of user inactivity. The timeout is controlled by the `INACTIVITY_TIMEOUT_MINS` environment variable (default: 15 minutes). When triggered, the user receives a 30-second warning toast before being logged out (session invalidated server-side) and hard-redirected to `/login`. This applies uniformly to all authenticated users, including Super Admins and tenant users.

## Motivation
Idle sessions on unattended devices pose a significant security risk, particularly in multi-tenant environments handling PII and tenant data. This feature ensures that sessions are automatically terminated after a period of inactivity, preventing unauthorized access. The server-side session is configured with a tight 1-hour absolute expiry and 15-minute renewal threshold, ensuring that even if client-side detection is bypassed, stale sessions are rejected server-side within a meaningful security window.

## References & Foundational Rules
This proposal builds upon and must strictly adhere to the rules established in:
- `project-initialization`: Core architecture, tenant isolation, and BetterAuth setup.
- `basic-authentication-login-flow`: Login flow, session management, and logout mechanics.
- `auth-and-rbac`: Session augmentation with permissions (must not interfere).

Mandatory Rules enforced in this proposal:
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Secrets Management:** New env var added to `.env.example` — no real secrets committed.
- **Design System:** Property NI Navy & Amber tokens for any new UI components (warning toast).

## Non-Regression Requirements
This proposal MUST NOT break any existing functionality:
- **Logout Flow:** The existing `signOutUser()` flow in `lib/auth-client.ts` (server-side session invalidation + cookie clearing) must continue to work exactly as implemented.
- **Session Management:** BetterAuth `session.expiresIn` (1 hour) and `session.updateAge` (15 minutes) must not invalidate sessions prematurely during active use. Active users making server requests MUST have their sessions renewed automatically.
- **Authentication:** Login, session refresh via `updateAge`, and middleware-based route protection must continue to work.
- **Multi-Tenant:** Both Super Admin (Platform org) and tenant users must experience identical inactivity behavior.

## Scope

**In scope:**
- **Environment Variable:** Add `INACTIVITY_TIMEOUT_MINS` (default: 15, in minutes) to the env schema and all `.env` templates. The schema validates the input as a digits-only string and transforms it to a `number`, so consumers receive a typed numeric value.
- **Server-Side Session Configuration:** Set `session.expiresIn` to 1 hour (absolute max) and `session.updateAge` to 15 minutes (renewal threshold) in `lib/auth.ts`.
- **Client-Side Inactivity Hook:** Create `hooks/useInactivityTimeout.ts` that listens for `mousemove`, `click`, `keydown`, `scroll`, and `touchstart` events. Resets a timer on each event; fires logout when the timeout expires.
- **Context Provider:** Create `components/providers/InactivityTimeoutConfig.tsx` to pass the server-read timeout value to the client-side hook via React Context.
- **Warning Toast:** Display a toast notification 30 seconds before the timeout, giving the user a chance to stay active (any interaction dismisses it and resets the timer).
- **Toast Library:** Add `sonner` as a lightweight toast dependency (no existing toast library is installed).
- **Layout Integration:** Place the `useInactivityTimeout` hook in `app/providers.tsx` so it applies to all authenticated routes (both admin and dashboard).
- **Hard Redirect:** Use `window.location.href = '/login'` instead of `router.push()` to avoid Next.js client-side router conflicts when session is cleared.

**Out of scope (Deferred):**
- Per-user or per-role timeout configuration (all users share the same env-driven value).
- "Stay signed in" extended session option.
- Server-side heartbeat / ping mechanism to track activity on the backend.
- Cross-tab or cross-device logout (each tab tracks independently).

## Detailed Design Overview
The solution employs a client-side timer that resets on tracked user interactions (`mousemove`, `click`, `keydown`, `scroll`, `touchstart`). The timeout duration is read server-side in `app/layout.tsx` and passed to a React Context provider, avoiding the need for `NEXT_PUBLIC_` env vars.

The environment value is parsed to a `number` at the schema boundary via Zod's `.transform(Number)`, so `app/layout.tsx` reads `env.INACTIVITY_TIMEOUT_MINS` directly as a number and passes it to `InactivityTimeoutProvider` without any manual `parseInt` or fallback.

At `timeout - 30s`, a warning toast is displayed. If the user remains inactive until `timeout`, `signOutUser()` is called to invalidate the session server-side (BetterAuth deletes the session from the database) and clear cookies, followed immediately by a hard redirect to `/login`.

The BetterAuth server-side `session.expiresIn` is set to 1 hour (absolute maximum) with `session.updateAge` at 15 minutes. Active users making server requests have their sessions renewed automatically and never hit the absolute expiry. Inactive users (or cases where client-side detection is bypassed) have their sessions rejected server-side after 1 hour maximum.

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `components/providers/InactivityTimeoutConfig.tsx` | React Context provider for timeout value |
| New | `hooks/useInactivityTimeout.ts` | Client-side inactivity tracking hook with ref stabilization |
| Modified | `lib/env.ts` | Add `INACTIVITY_TIMEOUT_MINS` to Zod schema (digits-only string, default `"15"`, transformed to `number`) |
| Modified | `lib/auth.ts` | Set `session.expiresIn` to 1 hour, `session.updateAge` to 15 minutes |
| Modified | `.env.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| Modified | `.env.local-prod.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| Modified | `.env.test.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| Modified | `app/layout.tsx` | Read env var (as a parsed number) and wrap children in `InactivityTimeoutProvider` |
| Modified | `app/providers.tsx` | Add `<Toaster />` and invoke `useInactivityTimeout()` |
| Modified | `package.json` | Add `sonner` dependency |

## Testing Plan
- **Unit Tests:** Verify `useInactivityTimeout` hook resets timer on events, fires warning at `T-30s`, and triggers logout at `T-0s`.
- **Integration Tests:** Verify active user sessions are renewed server-side and not prematurely invalidated.
- **Integration Tests:** Verify idle sessions are logged out (server-side invalidation) and redirected to `/login`.
- **Integration Tests:** Verify stale sessions beyond 1 hour are rejected server-side.
- **Manual Testing:** Verify warning toast displays, dismisses on activity, and timer resets.
- **Validation:** Verify env var schema rejects non-numeric values for `INACTIVITY_TIMEOUT_MINS` and yields a `number` for valid input.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users frustrated by unexpected logout | Medium | 30-second warning toast gives advance notice and chance to reset |
| Event listener thrashing causing lost clicks | High | Use `useRef` to stabilize function identities, preventing `useEffect` from tearing down/rebuilding listeners on every render |
| Toast dismissed when auth state changes | Medium | Place `<Toaster />` unconditionally in `providers.tsx`, outside any auth-checking components |
| Next.js router conflicts during logout | High | Use `window.location.href = '/login'` for hard redirect, bypassing client-side router entirely |
| Hook runs on unauthenticated pages | Low | Hook runs unconditionally, but `signOutUser()` is a safe no-op if no session exists |
| Active user reading long page without API calls hits 1-hour server expiry | Medium | `updateAge` of 15 minutes renews session on any request; client-side activity (mouse/scroll) keeps user engaged; 1-hour window is generous for reading |
| Timer drift if tab is backgrounded | Low | Browser throttles timers in background tabs — each tab operates independently, which is acceptable |

## Acceptance Criteria
- [ ] `INACTIVITY_TIMEOUT_MINS` is validated by Zod (digits-only), defaults to `"15"`, and is transformed to a `number`.
- [ ] Client-side hook tracks activity and resets timer on `mousemove`, `click`, `keydown`, `scroll`, `touchstart`.
- [ ] Warning toast appears 30 seconds before timeout and is dismissed by any tracked activity.
- [ ] User is logged out (server-side session invalidated) and hard-redirected to `/login` at timeout expiry.
- [ ] Server-side `session.expiresIn` is 1 hour (absolute max), `session.updateAge` is 15 minutes.
- [ ] Active users making server requests are NOT prematurely logged out.
- [ ] Stale sessions beyond 1 hour are rejected server-side.
- [ ] Feature applies uniformly to Super Admin and tenant users.
- [ ] All existing tests pass with zero TypeScript errors and zero ESLint warnings.
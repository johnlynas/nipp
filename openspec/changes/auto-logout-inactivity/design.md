# Design: Auto-Logout on Inactivity

## Overview
This document describes the technical design for implementing automatic session logout after a configurable period of user inactivity. The solution uses a client-side timer with a 30-second warning toast, combined with a tight server-side session expiry (1 hour absolute, 15-minute renewal) to ensure stale sessions are rejected even if client-side detection is bypassed.

## Architecture

```text
┌─────────────────────────────────────────────────────┐
 │                    Client (Browser)                  │
 │                                                      │
 │  ┌──────────────────────────────────────────────┐   │
 │  │           useInactivityTimeout Hook          │   │
 │  │                                              │   │
 │  │  Events: mousemove, click, keydown,          │   │
 │  │          scroll, touchstart                  │   │
 │  │  Timer: resets on each event (ref-stabilized)│   │
 │  │  T-30s: Warning toast (sonner)               │   │
 │  │  T-0s:  signOutUser() → window.location      │   │
 │  │         href = '/login' (hard redirect)      │   │
 │  └──────────────────────────────────────────────┘   │
 │                                                      │
 │  ┌──────────────────────────────────────────────┐   │
 │  │              <Toaster /> (sonner)             │   │
 │  │         (unconditional in providers.tsx)      │   │
 │  └──────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────┘
                        ▲
                        │ React Context (timeoutMins)
 ┌─────────────────────────────────────────────────────┐
 │              InactivityTimeoutProvider               │
 │  ┌──────────────────────────────────────────────┐   │
 │  │  app/layout.tsx (Server Component)           │   │
 │  │  Reads env.INACTIVITY_TIMEOUT_MINS           │   │
 │  │  Passes to InactivityTimeoutProvider         │   │
 │  └──────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────┘
                        │
                        ▼
 ┌─────────────────────────────────────────────────────┐
 │                   Server (Next.js)                  │
 │  ┌──────────────────────────────────────────────┐   │
 │  │           BetterAuth Config                  │   │
 │  │                                              │   │
 │  │  session.expiresIn = 1 hour (absolute max)   │   │
 │  │  session.updateAge = 15 min (renewal)        │   │
 │  │  signOutUser() deletes session from DB       │   │
 │  └──────────────────────────────────────────────┘   │
 │  ┌──────────────────────────────────────────────┐   │
 │  │           lib/env.ts (Zod Schema)            │   │
 │  │                                              │   │
 │  │  INACTIVITY_TIMEOUT_MINS: number (parsed)    │   │
 │  │    - regex: /^\d+$/                          │   │
 │  │    - default: "15" → transform(Number)       │   │  
 │  └──────────────────────────────────────────────┘   │
 └─────────────────────────────────────────────────────┘
```

## Technical Decisions

### Decision 1: Tight Server-Side Expiry with Active Renewal

**Context:** We need to log out idle users after 15 minutes of inactivity. The server-side session expiry must be a meaningful security backstop, not a 7-day window that undermines the inactivity policy. However, setting `expiresIn` to 15 minutes would log out active users mid-task.

**Decision:** Set `session.expiresIn` to 1 hour (absolute maximum) and `session.updateAge` to 15 minutes (renewal threshold). Active users making server requests have their sessions renewed automatically. Inactive users' sessions expire server-side after 1 hour maximum.

**Rationale:**
- Active users making at least 1 request per 45 minutes never hit the absolute expiry (session renews when remaining time < 15 minutes).
- If client-side detection is bypassed (JS disabled, browser crash), the server rejects the stale session after 1 hour — not 7 days.
- `signOutUser()` deletes the session from the database immediately on client-side logout, so the 1-hour window is only a backstop.
- Defense in depth: client-side 15-minute inactivity + server-side 1-hour absolute max.

**Alternatives considered:**
- Tie `session.expiresIn` to 15 minutes — rejected because it would log out active users mid-task (no server requests while reading/scrolling).
- 7-day absolute expiry — rejected because it is an unacceptably long security window for an app with a 15-minute inactivity policy.
- 8-hour absolute expiry — rejected as still too long; 1 hour is sufficient with active renewal.
- Server-side heartbeat/ping — rejected due to unnecessary network overhead.

### Decision 2: Hard Redirect After Logout

**Context:** When `signOutUser()` clears session cookies, the Next.js client-side router attempts to navigate while the auth state is in a transitional/invalidated state. Calling `router.push('/login')` followed by `router.refresh()` silently fails because the session is cleared mid-flight.

**Decision:** Use `window.location.href = '/login'` instead of `router.push('/login')` or `router.refresh()`.

**Rationale:**
- Hard redirect bypasses the client-side router entirely.
- Allows the Next.js middleware to cleanly intercept the unauthenticated request and redirect to `/login`.
- Eliminates race conditions between cookie clearing and client-side navigation.
- Prevents silent navigation failures and RSC fetch aborts.

**Alternatives considered:**
- `router.push('/login')` + `router.refresh()` — rejected because it causes silent navigation failures when the session is cleared mid-flight.
- `router.replace('/login')` — rejected for the same reasons as `router.push`.

### Decision 3: Ref-Based Function Stabilization

**Context:** React hooks that recreate functions on every render cause `useEffect` to tear down and rebuild event listeners. This leads to "lost click" race conditions where a click fires during cleanup and the timer never resets.

**Decision:** Use `useRef` to store `timeoutMins` and `performLogout`, keeping `resetTimer` and `clearTimers` identities stable across renders.

**Rationale:**
- Prevents event listener thrashing (performance issue).
- Ensures clicks always reliably reset the timer.
- Event listeners are attached once when the session becomes available and stay attached.
- Eliminates the "lost click" race condition entirely.

**Alternatives considered:**
- Adding all dependencies to the `useEffect` array — rejected because it causes the exact thrashing we are trying to avoid.
- Using `useCallback` with full dependency arrays — rejected for the same reason.

### Decision 4: Env Var Exposure Strategy (React Context)

**Context:** The timeout value is needed both server-side (for validation) and client-side (for the hook timer).

**Decision:** Read `INACTIVITY_TIMEOUT_MINS` server-side in `app/layout.tsx` and pass the value to the hook via React Context (`InactivityTimeoutProvider`).

**Rationale:**
- Cleaner architecture with a single source of truth.
- No `NEXT_PUBLIC_` duplication or exposure of env vars to the client bundle.
- Idiomatic React pattern for passing server-read config to client components.
- Easier to test and reason about.

**Alternatives considered:**
- `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINS` — rejected because it exposes the env var to the client bundle unnecessarily when Context is cleaner.
- Reading directly from `process.env` in the client hook — rejected because Next.js only exposes `NEXT_PUBLIC_` prefixed vars to the client.

### Decision 5: Toast Library Selection (Sonner)

**Context:** We need a lightweight toast library that works with Next.js App Router and supports programmatic dismissal (required to clear the warning on activity).

**Decision:** Use `sonner`.

**Rationale:**
- Lightweight (~4KB gzipped).
- Zero-config, works with Next.js App Router out of the box.
- Supports programmatic dismissal via `toast.dismiss()`.
- No additional UI component library dependency.
- Rich color support for warning toasts.

**Alternatives considered:**
- `react-hot-toast` — rejected because it is slightly heavier and less flexible for programmatic control.
- `react-toastify` — rejected because it is much heavier and overkill for our needs.
- Custom toast implementation — rejected because it would require significant development time.

### Decision 6: Unconditional Toaster Placement

**Context:** If the `<Toaster />` component is placed inside a component that conditionally renders based on auth state, it will unmount when `signOutUser()` clears the session, instantly dismissing any pending warning toast.

**Decision:** Place `<Toaster position="top-right" richColors />` unconditionally in `app/providers.tsx`, outside any auth-checking components.

**Rationale:**
- Ensures the toast never unmounts during auth state transitions.
- Warning toast remains visible even as the session is being cleared.
- Simple, predictable behavior.

**Alternatives considered:**
- Conditional placement inside auth-checking wrapper — rejected because it causes the toast to disappear instantly when auth state changes.
- Placement in root layout — rejected because `providers.tsx` is already the logical place for global UI components.

### Decision 7: Per-Tab Timeout (Not Cross-Tab)

**Context:** We need to decide whether the inactivity timeout should be tracked per-tab or synchronized across all open browser tabs.

**Decision:** Each browser tab tracks its own inactivity independently.

**Rationale:**
- Simpler implementation with no cross-tab synchronization overhead.
- Aligns with common web app patterns (Gmail, GitHub).
- Each tab operates independently, which is acceptable for this use case.
- If cross-tab synchronization is needed in the future, a `BroadcastChannel` listener can be added to the hook.

**Alternatives considered:**
- Cross-tab synchronization via `BroadcastChannel` or `localStorage` — rejected due to added complexity and network overhead.
- Server-side session tracking — rejected because it would require constant pings and doesn't provide immediate UX feedback.

## Data Flow

1. **Request Ingress** → User loads an authenticated page.
2. **Server Render** → `app/layout.tsx` reads `env.INACTIVITY_TIMEOUT_MINS` (already a `number` via Zod's `.transform(Number)`) and passes it to `<InactivityTimeoutProvider>`.
3. **Client Mount** → `useInactivityTimeout` hook initializes, reads context, and attaches event listeners (`mousemove`, `click`, `keydown`, `scroll`, `touchstart`).
4. **Activity** → User interacts. Event listener fires, dismisses any pending warning toast, and calls `resetTimer()`.
5. **Inactivity (T-30s)** → No activity detected. Hook fires `toast.warning()` with a 30-second duration.
6. **Inactivity (T-0s)** → Timeout expires. Hook calls `performLogout()`.
7. **Logout** → `signOutUser()` calls BetterAuth API, which deletes the session from the database and clears cookies. `window.location.href = '/login'` triggers hard redirect.
8. **Middleware** → Next.js middleware intercepts the unauthenticated request to `/login` and allows it to proceed.
9. **Server-Side Backstop** → If `signOutUser()` never fires (JS disabled, crash), the session expires server-side after 1 hour absolute max. Active users' sessions are renewed via `updateAge` (15-minute threshold).

## Component Specifications

### `InactivityTimeoutProvider`
- **Purpose:** Bridges server-side environment configuration to the client-side hook.
- **Inputs:** `timeoutMins` (number).
- **Outputs:** React Context providing `useInactivityTimeoutConfig()` hook.
- **Dependencies:** React `createContext`, `useContext`.

### `useInactivityTimeout`
- **Purpose:** Tracks user activity and enforces the logout sequence.
- **Inputs:** None (reads from `useInactivityTimeoutConfig`).
- **Outputs:** None (side-effects: toast notifications, server-side session invalidation, cookie clearing, window redirect).
- **Dependencies:** `sonner` (toast), `lib/auth-client` (`signOutUser`), React hooks (`useEffect`, `useRef`, `useCallback`).

### `<Toaster />`
- **Purpose:** Renders toast notifications globally.
- **Placement:** Unconditionally in `app/providers.tsx` to ensure it never unmounts during auth state transitions.

## Security Considerations

- **Idle Device Protection:** Prevents unauthorized access on unattended, authenticated devices.
- **Server-Side Session Invalidation:** `signOutUser()` deletes the session from the BetterAuth database, not just local cookies. The session is genuinely dead server-side.
- **Tight Absolute Expiry:** Server-side `session.expiresIn` is 1 hour, not 7 days. If client-side detection is bypassed, the session dies server-side within 1 hour.
- **Active Renewal:** `session.updateAge` of 15 minutes ensures active users' sessions are renewed on any server request, preventing premature logout.
- **Defense in Depth:** Client-side 15-minute inactivity + server-side 1-hour absolute max + middleware route protection.
- **Data Exposure:** No sensitive data is exposed via the Context provider (only a numeric minute value).
- **Cookie Security:** Session cookies use `httpOnly`, `secure`, and `sameSite` flags (existing BetterAuth configuration).

## Performance Considerations

- **Event Listener Efficiency:** Ref stabilization ensures event listeners are attached exactly once per component lifecycle, eliminating garbage collection overhead from constant teardown/rebuild.
- **Bundle Size:** `sonner` is highly optimized and adds negligible bundle size (~4KB gzipped).
- **Background Tabs:** Browser timer throttling in background tabs is an accepted trade-off. Each tab operates independently, which is standard for web applications and avoids complex cross-tab `BroadcastChannel` synchronization overhead.
- **Server Load:** No heartbeat/ping mechanism. Session renewal happens passively via `updateAge` on existing requests. Zero additional server load.

## Files Changed

| File | Change |
|------|--------|
| `lib/env.ts` | Add `INACTIVITY_TIMEOUT_MINS` to Zod schema (digits-only string, transformed to `number` ) |
| `.env.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| `.env.local-prod.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| `.env.test.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| `lib/auth.ts` | Set `session.expiresIn` to 1 hour, `session.updateAge` to 15 minutes |
| `components/providers/InactivityTimeoutConfig.tsx` | New — React Context provider for timeout value |
| `hooks/useInactivityTimeout.ts` | New — inactivity tracking hook with ref stabilization |
| `app/layout.tsx` | Read `env.INACTIVITY_TIMEOUT_MINS` and wrap in `InactivityTimeoutProvider` |
| `app/providers.tsx` | Add `<Toaster />` and `useInactivityTimeout()` |
| `package.json` | Add `sonner` dependency |

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Users frustrated by unexpected logout | Medium | 30-second warning toast gives advance notice and chance to reset |
| Event listener thrashing causing lost clicks | High | Use `useRef` to stabilize function identities, preventing `useEffect` from tearing down/rebuilding listeners on every render |
| Toast dismissed when auth state changes | Medium | Place `<Toaster />` unconditionally in `providers.tsx`, outside any auth-checking components |
| Next.js router conflicts during logout | High | Use `window.location.href = '/login'` for hard redirect, bypassing client-side router entirely |
| Hook runs on unauthenticated pages | Low | Hook runs unconditionally, but `signOutUser()` is a safe no-op if no session exists |
| Active user reading long page without API calls hits 1-hour server expiry | Medium | `updateAge` of 15 minutes renews session on any request; 1-hour window is generous for reading; client-side activity (mouse/scroll) keeps user engaged |
| Timer drift if tab is backgrounded | Low | Browser throttles timers in background tabs — each tab operates independently, which is acceptable |
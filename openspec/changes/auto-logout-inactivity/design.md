# Design: Auto-Logout on Inactivity

## Overview
This document describes the technical design for implementing automatic session logout after a configurable period of user inactivity.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Client (Browser)                  │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           useInactivityTimeout Hook          │   │
│  │                                              │   │
│  │  Events: mousemove, click, keydown           │   │
│  │  Timer: resets on each event                 │   │
│  │  T-30s: Warning toast (sonner)               │   │
│  │  T-0s:  signOutUser() → redirect /login      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │              <Toaster /> (sonner)             │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│                   Server (Next.js)                   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           BetterAuth Config                   │   │
│  │                                              │   │
│  │  session.expiresIn = INACTIVITY_TIMEOUT_MINS │   │
│  │         (converted to seconds)                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │           lib/env.ts (Zod Schema)             │   │
│  │                                              │   │
│  │  INACTIVITY_TIMEOUT_MINS: string             │   │
│  │    - regex: /^\d+$/                          │   │
│  │    - default: "15"                           │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Per-Tab Timeout (Not Global)
Each browser tab tracks its own inactivity independently. This is the simpler approach and aligns with common web app patterns (e.g., Gmail, GitHub). If cross-tab synchronization is needed in the future, a `BroadcastChannel` listener can be added to the hook.

### 2. Client-Side Timer + Server-Side Expiry (Defense in Depth)
- **Client-side:** Provides immediate UX feedback — the user is logged out without making an unnecessary server request.
- **Server-side:** `session.expiresIn` is set to the same value, so even if a tab somehow bypasses client-side detection (e.g., JS disabled), the server will reject stale sessions.

### 3. Warning Toast at T-30s
A 30-second warning gives the user a chance to interact and reset the timer. Any tracked event (mousemove, click, keydown) dismisses the warning and resets the countdown.

### 4. Toast Library: Sonner
`sonner` is chosen because it is:
- Lightweight (~4KB gzipped)
- Zero-config, works with Next.js App Router out of the box
- Supports programmatic dismissal (needed to clear warning on activity)
- No additional UI component library dependency

### 5. Env Var Exposure Strategy
The timeout value needs to be available both server-side (BetterAuth config) and client-side (hook timer). Two approaches:
- **Option A:** Use `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINS` for client-side, and read `INACTIVITY_TIMEOUT_MINS` directly in server code. Both derive from the same env var at deploy time.
- **Option B:** Single `INACTIVITY_TIMEOUT_MINS` read server-side, and pass the value to the hook via props from a server-rendered layout.

**Recommendation:** Option A — simpler, no prop drilling needed. The hook reads `process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINS` directly.

### 6. Placement in Layout
The hook is placed in `app/providers.tsx` since it already wraps all client components. This ensures:
- The hook runs for every authenticated page (admin dashboard, tenant pages).
- No additional layout nesting required.
- The hook can check the session state to only start the timer for authenticated users.

## Files Changed
| File | Change |
|------|--------|
| `lib/env.ts` | Add `INACTIVITY_TIMEOUT_MINS` to Zod schema |
| `.env.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| `.env.test.example` | Add `INACTIVITY_TIMEOUT_MINS=15` |
| `lib/auth.ts` | Set `session.expiresIn` from env var |
| `hooks/useInactivityTimeout.ts` | **New** — inactivity tracking hook |
| `app/providers.tsx` | Add `<Toaster />` and `useInactivityTimeout()` |
| `package.json` | Add `sonner` dependency |

## Risks & Mitigations
| Risk | Mitigation |
|------|-----------|
| Users frustrated by unexpected logout | 30-second warning toast gives advance notice |
| Timer drift if tab is backgrounded | Browser throttles timers in background tabs — use `performance.now()` for accurate elapsed time measurement instead of `setTimeout` |
| Session expiry too aggressive in dev | Default 15 min is reasonable; can be set higher (e.g., 60) in dev via `.env.local` |
| Hook runs on unauthenticated pages | Check session state before starting timer; skip if no active session |

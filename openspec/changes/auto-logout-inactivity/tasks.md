# Tasks

## 1. Environment Variable & Schema
- [ ] 1.1 Add `INACTIVITY_TIMEOUT_MINS` to the Zod env schema in `lib/env.ts` (type: `z.enum(['true', 'false']).default('15')` — actually a string regex for digits, default `"15"`).
- [ ] 1.2 Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.example`.
- [ ] 1.3 Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.test.example` (for test environment).

## 2. Server-Side Session Tightening
- [ ] 2.1 Read `INACTIVITY_TIMEOUT_MINS` from env in `lib/auth.ts`.
- [ ] 2.2 Convert minutes to seconds and set `session.expiresIn` in the BetterAuth config to match.
- [ ] 2.3 Verify that `session.updateAge` is also set appropriately (keep existing or tighten — discuss).

## 3. Toast Library
- [ ] 3.1 Install `sonner` via npm.
- [ ] 3.2 Add `<Toaster />` component to `app/providers.tsx` (or root layout) so toasts are available globally.

## 4. Client-Side Inactivity Hook
- [ ] 4.1 Create `hooks/useInactivityTimeout.ts`:
      - Listen for `mousemove`, `click`, and `keydown` events.
      - Start a countdown timer on mount using the configured timeout from env (passed as prop or read via `process.env.NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINS` — note: env vars must be prefixed `NEXT_PUBLIC_` to be available client-side).
      - Fire a warning toast via `sonner` at `timeout - 30s`.
      - Fire logout via `signOutUser()` from `lib/auth-client.ts` at timeout.
      - Any tracked event resets the timer and dismisses pending warning.
- [ ] 4.2 Decide on env var exposure: Since BetterAuth server config reads from `process.env`, but the client hook needs the value too, we may need a `NEXT_PUBLIC_INACTIVITY_TIMEOUT_MINS` var (or read from a shared constant).

## 5. Layout Integration
- [ ] 5.1 Place the `useInactivityTimeout` hook in a layout that covers all authenticated routes:
      - Option A: `app/providers.tsx` (runs for every client-side rendered page).
      - Option B: A new `app/(authenticated)/layout.tsx` wrapper.
      - Recommendation: Use Option A (`providers.tsx`) since it already wraps all client components.
- [ ] 5.2 Ensure the hook only runs for authenticated users (check session before starting timer).

## 6. Testing
- [ ] 6.1 Unit test: `useInactivityTimeout` hook — verify timer resets on events, warning fires at correct time, logout fires at timeout.
- [ ] 6.2 Integration test: Verify that active user sessions are not prematurely invalidated (interact within timeout, session persists).
- [ ] 6.3 Integration test: Verify that idle sessions are logged out and redirected to `/login`.
- [ ] 6.4 Verify env var validation rejects non-numeric values for `INACTIVITY_TIMEOUT_MINS`.

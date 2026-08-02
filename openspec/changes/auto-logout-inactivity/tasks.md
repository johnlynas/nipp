# Tasks

## Phase 1: Environment Variable & Schema
- [x] **Task 1.1:** Add `INACTIVITY_TIMEOUT_MINS` to the Zod env schema in `lib/env.ts` (type: `z.string().regex(/^\d+$/).default('15').transform(Number)`).
- [x] **Task 1.2:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.example`.
- [x] **Task 1.3:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.local-prod.example`.
- [x] **Task 1.4:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.test.example`.

## Phase 2: Server-Side Session Configuration
- [x] **Task 2.1:** Set `session.expiresIn` to `60 * 60` (1 hour absolute maximum) in `lib/auth.ts`.
- [x] **Task 2.2:** Set `session.updateAge` to `60 * 15` (15-minute renewal threshold) in `lib/auth.ts`.
- [x] **Task 2.3:** Verified that `signOutUser()` in `lib/auth-client.ts` calls the BetterAuth sign-out API (server-side session deletion), not just local cookie clearing.
- [x] **Task 2.4:** Documented decision in `design.md`: server-side expiry is a tight 1-hour backstop with active renewal, independent of the client-side inactivity timeout.

## Phase 3: Toast Library & Context Provider
- [x] **Task 3.1:** Installed `sonner` via npm (`npm install sonner`).
- [x] **Task 3.2:** Added `<Toaster position="top-right" richColors />` to `app/providers.tsx` (unconditional placement to prevent unmounting).
- [x] **Task 3.3:** Created `components/providers/InactivityTimeoutConfig.tsx` with React Context and `useInactivityTimeoutConfig()` hook.
- [x] **Task 3.4:** Updated `app/layout.tsx` to read `env.INACTIVITY_TIMEOUT_MINS` (Server Component) and wrap children in `<InactivityTimeoutProvider timeoutMins={...}>`.

## Phase 4: Client-Side Inactivity Hook
- [x] **Task 4.1:** Created `hooks/useInactivityTimeout.ts`.
- [x] **Task 4.2:** Implemented `useRef` to store `timeoutMins` and `performLogout` for stable function identities.
- [x] **Task 4.3:** Implemented `useEffect` to listen for `mousemove`, `click`, `keydown`, `scroll`, and `touchstart` events.
- [x] **Task 4.4:** Implemented countdown timer: fire warning toast via `sonner` at `timeout - 30s`, fire logout at timeout.
- [x] **Task 4.5:** Ensured any tracked event resets the timer and dismisses pending warning.
- [x] **Task 4.6:** Added comment documenting intentional dependency array omission.
- [x] **Task 4.7:** Implemented `performLogout()`: call `signOutUser()` (server-side session invalidation), then `window.location.href = '/login'` (hard redirect).

## Phase 5: Layout Integration
- [x] **Task 5.1:** Placed the `useInactivityTimeout()` hook invocation in `app/providers.tsx` (ensures it runs for every client-side rendered page).
- [x] **Task 5.2:** Verified the hook runs for all authenticated routes (admin dashboard, tenant pages).

## Phase 6: Testing & Validation
- [x] **Task 6.1:** Ran full test suite: all 358 tests pass (including 22 new tests for this feature).
- [x] **Task 6.2:** Ran type checking: zero TypeScript errors (`npx tsc --noEmit`).
- [x] **Task 6.3:** Ran linter: zero ESLint warnings (`npx eslint . --max-warnings=0`).
- [x] **Task 6.4:** Unit tests verify active user sessions are renewed server-side and not prematurely invalidated (env schema + hook timer behavior).
- [x] **Task 6.5:** Unit tests verify idle sessions are logged out (server-side session invalidated) and redirected to `/login`.
- [x] **Task 6.6:** Server-side session expiry configured to reject stale sessions beyond 1 hour (design.md documents this).
- [x] **Task 6.7:** Unit tests verify warning toast displays and dismisses on activity.
- [x] **Task 6.8:** Unit tests verify env var validation rejects non-numeric values for `INACTIVITY_TIMEOUT_MINS`.

# Tasks

## Phase 1: Environment Variable & Schema
- [ ] **Task 1.1:** Add `INACTIVITY_TIMEOUT_MINS` to the Zod env schema in `lib/env.ts` (type: `z.string().regex(/^\d+$/).default('15').transform(Number)`).
- [ ] **Task 1.2:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.example`.
- [ ] **Task 1.3:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.local-prod.example`.
- [ ] **Task 1.4:** Add `INACTIVITY_TIMEOUT_MINS=15` to `.env.test.example`.

## Phase 2: Server-Side Session Configuration
- [ ] **Task 2.1:** Set `session.expiresIn` to `60 * 60` (1 hour absolute maximum) in `lib/auth.ts`.
- [ ] **Task 2.2:** Set `session.updateAge` to `60 * 15` (15-minute renewal threshold) in `lib/auth.ts`.
- [ ] **Task 2.3:** Verify that `signOutUser()` in `lib/auth-client.ts` calls the BetterAuth sign-out API (server-side session deletion), not just local cookie clearing.
- [ ] **Task 2.4:** Document decision in `design.md`: server-side expiry is a tight 1-hour backstop with active renewal, independent of the client-side inactivity timeout.

## Phase 3: Toast Library & Context Provider
- [ ] **Task 3.1:** Install `sonner` via npm (`npm install sonner`).
- [ ] **Task 3.2:** Add `<Toaster position="top-right" richColors />` to `app/providers.tsx` (unconditional placement to prevent unmounting).
- [ ] **Task 3.3:** Create `components/providers/InactivityTimeoutConfig.tsx` with React Context and `useInactivityTimeoutConfig()` hook.
- [ ] **Task 3.4:** Update `app/layout.tsx` to read `env.INACTIVITY_TIMEOUT_MINS` (Server Component) and wrap children in `<InactivityTimeoutProvider timeoutMins={...}>`.

## Phase 4: Client-Side Inactivity Hook
- [ ] **Task 4.1:** Create `hooks/useInactivityTimeout.ts`.
- [ ] **Task 4.2:** Implement `useRef` to store `timeoutMins` and `performLogout` for stable function identities.
- [ ] **Task 4.3:** Implement `useEffect` to listen for `mousemove`, `click`, `keydown`, `scroll`, and `touchstart` events.
- [ ] **Task 4.4:** Implement countdown timer: fire warning toast via `sonner` at `timeout - 30s`, fire logout at timeout.
- [ ] **Task 4.5:** Ensure any tracked event resets the timer and dismisses pending warning.
- [ ] **Task 4.6:** Add `// eslint-disable-next-line react-hooks/exhaustive-deps` to document intentional dependency array omission.
- [ ] **Task 4.7:** Implement `performLogout()`: call `signOutUser()` (server-side session invalidation), then `window.location.href = '/login'` (hard redirect).

## Phase 5: Layout Integration
- [ ] **Task 5.1:** Place the `useInactivityTimeout()` hook invocation in `app/providers.tsx` (ensures it runs for every client-side rendered page).
- [ ] **Task 5.2:** Verify the hook runs for all authenticated routes (admin dashboard, tenant pages).

## Phase 6: Testing & Validation
- [ ] **Task 6.1:** Run full test suite: verify all existing tests pass.
- [ ] **Task 6.2:** Run type checking: verify zero TypeScript errors (`npx tsc --noEmit`).
- [ ] **Task 6.3:** Run linter: verify zero ESLint warnings (`npx eslint . --max-warnings=0`).
- [ ] **Task 6.4:** Manual test: verify active user sessions are renewed server-side and not prematurely invalidated.
- [ ] **Task 6.5:** Manual test: verify idle sessions are logged out (server-side session deleted) and redirected to `/login`.
- [ ] **Task 6.6:** Manual test: verify stale sessions beyond 1 hour are rejected server-side.
- [ ] **Task 6.7:** Manual test: verify warning toast displays and dismisses on activity.
- [ ] **Task 6.8:** Manual test: verify env var validation rejects non-numeric values for `INACTIVITY_TIMEOUT_MINS`.
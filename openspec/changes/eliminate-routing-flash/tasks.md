# Tasks: Eliminate Super Admin Routing Flash

## Task 1: Audit Session Payload
- [ ] Verify that `auth.api.getSession()` returns the user's `role` field directly in the session payload.
- [ ] If the `role` is not present in the session payload, update the BetterAuth configuration to include the `role` field in the session response.

## Task 2: Implement Server-Side Redirect
- [ ] Update the root entry point (e.g., `app/page.tsx` or the main tenant layout) to be an `async` Server Component.
- [ ] Implement session retrieval using `auth.api.getSession({ headers: headers() })`.
- [ ] Add logic to check if `session?.user.role === 'super_admin'`.
- [ ] Implement the server-side `redirect('/admin/organizations')` if the condition is met.
- [ ] Ensure the redirect handles unauthenticated users correctly (redirecting to `/login` if no session exists).

## Task 3: Refactor Client-Side Hooks — Loading State Fix
- [ ] Locate `RequireSuperAdmin` component.
- [ ] Update the component to check `isLoading` **before** `isSuperAdmin`.
- [ ] While `isLoading` is `true`, render a loading spinner (using Property NI Amber `#F5A623` for the spinner border) or `null`.
- [ ] Only render `<AccessDenied />` when `isLoading` is `false` AND `isSuperAdmin` is `false`.
- [ ] Remove any client-side `router.push` or `window.location` redirect logic from `useIsSuperAdmin` and `RequireSuperAdmin`.
- [ ] Verify that `useIsSuperAdmin()` returns both `isSuperAdmin` and `isLoading` from the hook.

## Task 4: Testing & Verification
- [ ] **Super Admin Login Test:** Log in as a Super Admin. Verify that the browser URL immediately resolves to `/admin/organizations` without ever painting the tenant dashboard UI or the `AccessDenied` screen.
- [ ] **Tenant User Login Test:** Log in as a standard tenant user. Verify they are correctly routed to the tenant dashboard and *not* redirected to the admin panel.
- [ ] **Direct URL Access (Super Admin):** Have a Super Admin manually type the tenant dashboard URL into the browser. Verify they are immediately redirected to the admin dashboard without any flash.
- [ ] **Direct URL Access (Tenant User):** Have a standard tenant user manually type an `/admin/*` URL. Verify they see the `AccessDenied` component (not a loading spinner indefinitely).
- [ ] **Performance Check:** Ensure the Server Component adds negligible latency (< 50ms) to the initial page load.
- [ ] **Visual Check:** Confirm the loading spinner uses Property NI brand colors (Amber `#F5A623` border) if a spinner is shown.
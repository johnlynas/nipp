# Proposal: Eliminate Super Admin Routing Flash via Server-Side Interception

## 1. Context
Currently, when a Super Admin logs into the Property NI Multi-Tenant Portal, they experience a "flash of incorrect content" (FOIC). The browser briefly renders either the default tenant dashboard layout or an "Access Denied" screen before client-side React hooks (like `useIsSuperAdmin`) resolve and trigger a redirect to the `/admin/organizations` dashboard. 

This happens because the initial page render occurs before the asynchronous permission check completes. During this brief window, client-side guards incorrectly evaluate `isSuperAdmin` as `false` (since it's still `undefined`), causing the `AccessDenied` component to render prematurely. This degrades the user experience and briefly exposes incorrect UI states to platform administrators.

## 2. Objectives
- **Eliminate the Routing Flash:** Prevent the default tenant page and `AccessDenied` screen from ever rendering in the browser for Super Admins.
- **Server-Side Routing Decision:** Move the role-based routing logic from the client-side (React hooks) to the server-side (Next.js Server Components) so the redirect happens before the HTML is sent to the browser.
- **Fix Client-Side Loading State Logic:** Refactor `RequireSuperAdmin` to check `isLoading` before `isSuperAdmin`, preventing premature rendering of `AccessDenied` during async permission checks.
- **Maintain Runtime Compatibility:** Ensure the solution respects Next.js runtime limitations (avoiding heavy database queries in Edge Middleware).

## 3. Scope
- Root application entry points (`app/page.tsx` or `app/layout.tsx`)
- Client-side authentication hooks (`useIsSuperAdmin`, `RequireSuperAdmin`)
- `AccessDenied` component usage patterns
- BetterAuth session retrieval logic
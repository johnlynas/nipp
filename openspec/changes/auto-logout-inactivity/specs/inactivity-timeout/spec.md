# Delta for Inactivity Timeout

## ADDED Requirements

### Requirement: Configurable Inactivity Timeout
The system MUST support a configurable inactivity timeout that triggers automatic session logout.

**Scenario: Default Timeout Value**
- **GIVEN** the `INACTIVITY_TIMEOUT_MINS` environment variable is not set
- **WHEN** the application starts
- **THEN** the inactivity timeout MUST default to 15 minutes.

**Scenario: Custom Timeout Value**
- **GIVEN** the `INACTIVITY_TIMEOUT_MINS` environment variable is set to a positive integer (e.g., `"30"`)
- **WHEN** the application starts
- **THEN** the inactivity timeout MUST use the configured value.

**Scenario: Invalid Timeout Value**
- **GIVEN** the `INACTIVITY_TIMEOUT_MINS` environment variable is set to a non-numeric or zero value
- **WHEN** the application starts
- **THEN** the system MUST fail environment validation with a clear error message.

---

### Requirement: Client-Side Inactivity Detection
The system MUST track user activity on the client side and trigger logout after the configured timeout.

**Scenario: Activity Tracking**
- **GIVEN** a user is authenticated and viewing an authenticated page
- **WHEN** the user performs any of the following actions: mouse movement, click, keyboard input, scroll, or touch
- **THEN** the inactivity timer MUST reset and continue counting from zero.

**Scenario: Inactivity Timeout Expiry**
- **GIVEN** a user is authenticated and has performed no tracked activity for the full timeout duration
- **WHEN** the timeout expires
- **THEN** the system MUST display a warning toast notification indicating logout is imminent (30 seconds remaining).
- **THEN** 30 seconds after the warning, the system MUST call `signOutUser()` to invalidate the session server-side and clear cookies.
- **THEN** the system MUST perform a hard redirect to `/login`.

**Scenario: Warning Toast Dismissal**
- **GIVEN** a warning toast is displayed (30 seconds before logout)
- **WHEN** the user performs any tracked activity (mouse movement, click, keyboard input, scroll, or touch)
- **THEN** the warning toast MUST be dismissed.
- **THEN** the inactivity timer MUST reset and continue counting from zero.

**Scenario: Per-Tab Timeout**
- **GIVEN** a user has multiple browser tabs open with authenticated sessions
- **WHEN** the inactivity timeout expires in one tab
- **THEN** only that tab MUST log out and redirect to `/login`.
- **THEN** other tabs MUST continue functioning normally (independent timers).

---

### Requirement: Server-Side Session Expiry
The system MUST configure BetterAuth session expiry as a tight absolute backstop, independent of the client-side inactivity timeout.

**Scenario: Session Expiry Configuration**
- **GIVEN** the application starts
- **WHEN** BetterAuth is configured
- **THEN** `session.expiresIn` MUST be set to 1 hour (absolute maximum session lifetime).
- **THEN** `session.updateAge` MUST be set to 15 minutes (renewal threshold for active sessions).

**Scenario: Active Session Renewal**
- **GIVEN** an authenticated user is actively making server requests
- **WHEN** the session's remaining time drops below 15 minutes
- **THEN** the next server request MUST renew the session back to the full 1-hour expiry.
- **THEN** the user MUST NOT be logged out while actively using the application.

**Scenario: Stale Session Rejection**
- **GIVEN** a session has not been renewed for 1 hour (e.g., client-side logout failed, JS disabled, browser crash)
- **WHEN** the server processes any request with that session
- **THEN** the session MUST be rejected and the user redirected to `/login`.

**Scenario: Server-Side Session Invalidation on Logout**
- **GIVEN** the client-side inactivity timer fires and calls `signOutUser()`
- **WHEN** BetterAuth processes the sign-out request
- **THEN** the session MUST be deleted from the server-side session store.
- **THEN** the session cookie MUST be cleared on the client.

---

### Requirement: Uniform Behavior Across User Types
The system MUST apply the inactivity timeout uniformly to all authenticated users.

**Scenario: Super Admin Timeout**
- **GIVEN** a Super Admin user (member of the Platform organization) is authenticated
- **WHEN** they are inactive for the configured timeout duration
- **THEN** they MUST be logged out and redirected to `/login` — identical to other users.

**Scenario: Tenant User Timeout**
- **GIVEN** a regular user (member of a tenant organization) is authenticated
- **WHEN** they are inactive for the configured timeout duration
- **THEN** they MUST be logged out and redirected to `/login` — identical to Super Admins.
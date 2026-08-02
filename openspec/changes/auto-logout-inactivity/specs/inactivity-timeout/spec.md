# Delta for Inactivity Timeout

## ADDED Requirements

### Requirement: Configurable Inactivity Timeout
The system MUST support a configurable inactivity timeout that triggers automatic session logout.

#### Scenario: Default Timeout Value
- GIVEN the `INACTIVITY_TIMEOUT_MINS` environment variable is not set
- WHEN the application starts
- THEN the inactivity timeout MUST default to 15 minutes.

#### Scenario: Custom Timeout Value
- GIVEN the `INACTIVITY_TIMEOUT_MINS` environment variable is set to a positive integer (e.g., `"30"`)
- WHEN the application starts
- THEN the inactivity timeout MUST use the configured value.

#### Scenario: Invalid Timeout Value
- GIVEN the `INACTIVITY_TIMEOUT_MINS` environment variable is set to a non-numeric or zero value
- WHEN the application starts
- THEN the system MUST fail environment validation with a clear error message.

### Requirement: Client-Side Inactivity Detection
The system MUST track user activity on the client side and trigger logout after the configured timeout.

#### Scenario: Activity Tracking
- GIVEN a user is authenticated and viewing an authenticated page
- WHEN the user performs any of the following actions: mouse movement, click, or keyboard input
- THEN the inactivity timer MUST reset and continue counting from zero.

#### Scenario: Inactivity Timeout Expiry
- GIVEN a user is authenticated and has performed no tracked activity for the full timeout duration
- WHEN the timeout expires
- THEN the system MUST display a warning toast notification indicating logout is imminent (30 seconds remaining).
- THEN 30 seconds after the warning, the system MUST automatically log out the user and redirect to `/login`.

#### Scenario: Warning Toast Dismissal
- GIVEN a warning toast is displayed (30 seconds before logout)
- WHEN the user performs any tracked activity (mouse movement, click, or keyboard input)
- THEN the warning toast MUST be dismissed.
- THEN the inactivity timer MUST reset and continue counting from zero.

#### Scenario: Per-Tab Timeout
- GIVEN a user has multiple browser tabs open with authenticated sessions
- WHEN the inactivity timeout expires in one tab
- THEN only that tab MUST log out and redirect to `/login`.
- THEN other tabs MUST continue functioning normally (independent timers).

### Requirement: Server-Side Session Expiry
The system MUST enforce the inactivity timeout on the server side by configuring BetterAuth session expiry.

#### Scenario: Session Expiry Alignment
- GIVEN the `INACTIVITY_TIMEOUT_MINS` environment variable is set to a value (e.g., 15 minutes)
- WHEN the BetterAuth server is configured
- THEN `session.expiresIn` MUST be set to the same duration (converted to seconds).

#### Scenario: Stale Session Rejection
- GIVEN a user's session has been idle beyond the configured timeout
- WHEN the server processes any request with that session
- THEN the session MUST be rejected and the user redirected to `/login`.

### Requirement: Uniform Behavior Across User Types
The system MUST apply the inactivity timeout uniformly to all authenticated users.

#### Scenario: Super Admin Timeout
- GIVEN a Super Admin user (member of the Platform organization) is authenticated
- WHEN they are inactive for the configured timeout duration
- THEN they MUST be logged out and redirected to `/login` — identical to other users.

#### Scenario: Tenant User Timeout
- GIVEN a regular user (member of a tenant organization) is authenticated
- WHEN they are inactive for the configured timeout duration
- THEN they MUST be logged out and redirected to `/login` — identical to Super Admins.

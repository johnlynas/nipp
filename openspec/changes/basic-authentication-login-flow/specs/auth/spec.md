# Delta for Authentication UI

## ADDED Requirements

### Requirement: Login Page UI
The application MUST provide a login page styled with the Property NI design system.

#### Scenario: Login Page Rendering
- GIVEN the user navigates to `/login`
- WHEN the page loads
- THEN it MUST display a User ID input field and a masked Password input field.
- THEN it MUST display a "Login" button.
- THEN the UI MUST strictly follow the Property NI Navy & Amber design tokens.

#### Scenario: Login Failure
- GIVEN the user submits invalid credentials
- WHEN the login attempt fails
- THEN the UI MUST display a generic error message (e.g., "Invalid credentials").
- THEN the UI MUST NOT reveal whether the User ID or the password was incorrect.

### Requirement: Database & ORM Configuration
The application MUST provide SQL scripts and Prisma mappings for the user table.

#### Scenario: User Table Creation
- GIVEN the database setup is executed
- WHEN the SQL script runs
- THEN it MUST create a `user` table with fields for User ID and encrypted password hash.

#### Scenario: Default Admin Seeding
- GIVEN the `db:seed` script is executed
- WHEN it runs
- THEN it MUST insert a default admin user with a securely hashed password into the `user` table.

### Requirement: Session & Routing
The application MUST enforce authentication for the home page.

#### Scenario: Unauthenticated Access
- GIVEN an unauthenticated user navigates to `/`
- WHEN the request hits the middleware
- THEN the user MUST be redirected to `/login`.

#### Scenario: Authenticated Access & Logout
- GIVEN an authenticated user navigates to `/`
- WHEN the page loads
- THEN it MUST display a "Logout" button.
- WHEN the user clicks "Logout"
- THEN the session MUST be destroyed and the user redirected to `/login`.
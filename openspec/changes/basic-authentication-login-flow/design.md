# Design: Authentication UI & Login Flow

## Technical Approach
- **Framework:** Next.js (App Router).
- **Styling:** Property NI Navy & Amber design system (CSS variables, Tailwind).
- **Authentication:** BetterAuth native email/password flow. No custom API routes for login; BetterAuth handles the endpoint, hashing, and comparison.

## Architecture Decisions

### Decision: Native BetterAuth Login Flow
*Why:* BetterAuth provides a secure, tested implementation for password hashing and session management. Building custom API routes for this introduces unnecessary security risks and complexity.

### Decision: Generic Login Error Messages
*Why:* To prevent user enumeration attacks, the login UI must never reveal whether the User ID or the password was incorrect. A single generic message ("Invalid credentials") will be used for all authentication failures.

### Decision: Database Seeding for Default Admin
*Why:* To minimize direct database logins and manual setup, a Prisma seed script will be used to insert the initial admin user with a securely hashed password.

### Decision: Middleware for Route Protection
*Why:* Next.js middleware is the most efficient way to intercept requests, check for a valid BetterAuth session cookie, and redirect unauthenticated users to the login page before the page renders.
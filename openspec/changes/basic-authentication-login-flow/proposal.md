# Proposal: Authentication UI & Login Flow

## Intent
Implement the foundational Authentication UI and login flow for the Property NI Multi-Tenant Portal. This proposal focuses strictly on user authentication against a local database, establishing the secure entry point to the application while deferring authorization and user registration to future phases.

## References
This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in the **`project-initialization`** proposal.

## Scope
**In scope:**
- **Login Page UI:** Next.js page styled with the Property NI Navy & Amber design system.
- **Authentication Flow:** User ID and masked password login via BetterAuth.
- **Database Setup:** Raw PostgreSQL SQL scripts to create the `user` table and corresponding Prisma schema mappings.
- **Default Admin User:** Prisma seed script (`prisma/seed.ts`) to securely insert the initial admin user.
- **Session & Routing:** BetterAuth HTTP-only cookie sessions, middleware route protection for the home page, and a logout mechanism.
- **Security:** Generic error messages on login failure to prevent user enumeration.

**Out of scope (Deferred):**
- User registration (formal invite only).
- Authorization (roles, permissions, organization scoping).
- Email verification and password reset flows.

## Execution Boundary
This proposal will generate configuration, database scripts, UI components, and routing logic. It will not implement business logic, authorization rules, or administrative dashboards.

## Approach
Utilize BetterAuth's native email/password authentication flow to handle server-side password hashing (Argon2id) and session management. Implement the login UI using the established Property NI design tokens. Protect the home page via Next.js middleware.
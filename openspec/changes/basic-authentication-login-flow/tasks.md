# Tasks

## 1. Database & ORM Setup
- [x] 1.1 Create raw PostgreSQL SQL script to create the `user` table (including `id`, `userId`/`email`, `passwordHash`, etc.).
- [x] 1.2 Update `prisma/schema.prisma` with the `User` model mapping.
- [x] 1.3 Run `prisma migrate` to apply the schema. (migration already exists)
- [x] 1.4 Create `prisma/seed.ts` to hash a default admin password and insert the default admin user.
- [x] 1.5 Update `package.json` to include a `db:seed` script (tsx-based).

## 2. BetterAuth Configuration
- [x] 2.1 Ensure `lib/auth.ts` is configured for email/password authentication. (already configured)
- [x] 2.2 Verify `BETTER_AUTH_SECRET` and other required environment variables are documented in `.env.example`. (already documented)

## 3. Login Page UI Implementation
- [x] 3.1 Create `app/login/page.tsx`.
- [x] 3.2 Apply Property NI Navy & Amber design system (split-screen layout, pill-shaped inputs, specific hex codes).
- [x] 3.3 Implement User ID and masked Password input fields.
- [x] 3.4 Implement the "Login" button.
- [x] 3.5 Implement generic error message display for failed login attempts.

## 4. Home Page & Routing
- [x] 4.1 Update `app/page.tsx` (Home Page) to display a basic welcome message and a "Logout" button.
- [x] 4.2 Implement the logout functionality using the BetterAuth client.
- [x] 4.3 Update `middleware.ts` to protect the home page (`/`) and redirect unauthenticated users to `/login`. (already configured)
- [x] 4.4 Ensure `/login` is in the public routes array in `middleware.ts`. (already configured)

## 5. Testing
- [x] 5.1 Write unit tests for the login form validation.
- [x] 5.2 Write integration tests for the login flow (success and generic failure scenarios).
# Tasks

## 1. Database & ORM Setup
- [ ] 1.1 Create raw PostgreSQL SQL script to create the `user` table (including `id`, `userId`/`email`, `passwordHash`, etc.).
- [ ] 1.2 Update `prisma/schema.prisma` with the `User` model mapping.
- [ ] 1.3 Run `prisma migrate` to apply the schema.
- [ ] 1.4 Create `prisma/seed.ts` to hash a default admin password and insert the default admin user.
- [ ] 1.5 Update `package.json` to include a `db:seed` script.

## 2. BetterAuth Configuration
- [ ] 2.1 Ensure `lib/auth.ts` is configured for email/password authentication.
- [ ] 2.2 Verify `BETTER_AUTH_SECRET` and other required environment variables are documented in `.env.example`.

## 3. Login Page UI Implementation
- [ ] 3.1 Create `app/login/page.tsx`.
- [ ] 3.2 Apply Property NI Navy & Amber design system (split-screen layout, pill-shaped inputs, specific hex codes).
- [ ] 3.3 Implement User ID and masked Password input fields.
- [ ] 3.4 Implement the "Login" button.
- [ ] 3.5 Implement generic error message display for failed login attempts.

## 4. Home Page & Routing
- [ ] 4.1 Update `app/page.tsx` (Home Page) to display a basic welcome message and a "Logout" button.
- [ ] 4.2 Implement the logout functionality using the BetterAuth client.
- [ ] 4.3 Update `middleware.ts` to protect the home page (`/`) and redirect unauthenticated users to `/login`.
- [ ] 4.4 Ensure `/login` is in the public routes array in `middleware.ts`.

## 5. Testing
- [ ] 5.1 Write unit tests for the login form validation.
- [ ] 5.2 Write integration tests for the login flow (success and generic failure scenarios).
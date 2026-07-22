# Quick Start Guide — Property NI Portal

This guide provides the essential steps to get the Property NI Multi-Tenant Portal running locally. For detailed configuration and architecture information, see [README.md](./README.md).

## Prerequisites

Ensure you have the following installed:
- **Node.js 22 LTS** (pinned via `.nvmrc`)
- **PostgreSQL 16+**
- **Git**

## Setup Steps

### 1. Clone and Install Dependencies

```bash
git clone <your-repo-url> && cd nipp
nvm use                          # Switch to Node.js 22
npm install                      # Install dependencies
```

### 2. Set Up Database

Create the development database (`nipp_dev`):

```bash
bash scripts/setup-db.s

### 3. Configure Environment Variables

Copy the template and fill in your local values:

```bash
cp .env.example .env
```

**Required Variables:**
- `DATABASE_URL`: Your PostgreSQL connection string (e.g., `postgresql://postgres@localhost:5432/nipp_dev`)
- `BETTER_AUTH_SECRET`: Session encryption key (generate with `openssl rand -base64 32`)
- `ADMIN_EMAIL`: Email for the initial super admin account (e.g., `admin@example.com`)
- `ADMIN_PASSWORD`: Password for the initial super admin account (must be strong)
- `PGBOUNCER_PASSWORD` : You pgbouncer password

> **Note:** `ADMIN_EMAIL` and `ADMIN_PASSWORD` are required for seeding. The seed script will fail if these are not set.

### 4. Initialize Database & Seed

Generate the Prisma client and push schema to your database:

```bash
npx prisma generate
npx prisma db push
```

Seed the database with default data (Platform Organization, permissions, and admin user):

```bash
npm run db:seed
```

### 5. Start Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Next Steps

- **Login:** Use the `ADMIN_EMAIL` and `ADMIN_PASSWORD` you configured to log in.
- **Full Documentation:** Refer to [README.md](./README.md) for advanced configuration, testing, and deployment instructions.
## Troubleshooting: Next.js 15 Worker Thread Issue

During development, you may encounter repeated errors in the terminal:
```
[Error: Cannot find module '/Users/johnlynas/dev/nipp-0713/.next/server/vendor-chunks/lib/worker.js']
⨯ uncaughtException: [Error: the worker thread exited]
```

These are a known Next.js 15 issue with worker threads and module resolution during development, specifically related to the `lib/worker.js` chunk.

### 🔍 Root Cause
The error occurs when:
- The `.next` cache is stale after code changes (especially library imports)
- Worker threads are used by a dependency (likely `pino` or a similar logging/worker-based package)
- The module resolver can't find the rebuilt chunk

### ✅ Quick Fix — Clear Cache & Restart
Run these commands to clear the stale cache and restart:
```bash
# 1. Stop the dev server (Ctrl+C)

# 2. Clear Next.js cache
rm -rf .next

# 3. Restart dev server
npm run dev
```

### 🛡️ If the Issue Persists
If clearing `.next` doesn't fully resolve it, you can also try:
```bash
# Clear npm cache as well
npm cache clean --force

# Reinstall dependencies (if needed)
rm -rf node_modules package-lock.json
npm install

# Clear Next.js cache again
rm -rf .next

# Restart
npm run dev
```

### 📝 Why This Happens
- Next.js 15 uses a new bundler that creates `vendor-chunks` for shared modules
- When you modify files in `lib/`, the bundler may not immediately rebuild all dependent worker chunks
- The dev server's HMR (Hot Module Replacement) sometimes fails to invalidate these stale references
- **This is a development-only issue** — it does not affect production builds

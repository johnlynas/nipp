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
- **Architecture:** See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design details.

# BetterAuth Teams Data Model

## Overview

This document describes the Prisma schema, SQL DDL, relationship diagrams, and usage patterns for the Teams feature integrated into the Property NI Multi-Tenant Portal.

Teams provide a sub-organizational grouping layer, allowing users to be organized into functional units (e.g., "Maintenance Team A", "Letting Agents") within a single organization. Each team can have default roles automatically assigned to all its members, enabling role inheritance at the team level.

---

## Prisma Schema Definitions

### Team Model

```prisma
model Team {
  id          String   @id @default(cuid())
  name        String   // Human-readable team name (max 100 chars)
  slug        String?  @unique // URL-friendly identifier (auto-generated from name if not provided)
  description String?  // Optional team description (max 500 chars)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  members TeamMember[]
  roles  TeamRole[]

  @@index([organizationId, name]) // B-tree index for efficient org-scoped team lookups
  @@index([slug])                 // Index for unique slug resolution
}
```

### TeamMember Model

```prisma
model TeamMember {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([userId, teamId]) // A user can only be in a team once
  @@index([organizationId])  // Index for tenant-scoped queries
  @@index([teamId])          // Index for team member lookups
}
```

### TeamRole Model

```prisma
model TeamRole {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([teamId, roleId]) // A role can only be assigned once per team
  @@index([organizationId])  // Index for tenant-scoped queries
}
```

### Modified Models

#### Invitation (added `teamId`)

```prisma
model Invitation {
  // ... existing fields ...

  // Optional team association — invites users directly to a specific team
  teamId     String?  @map("teamId")

  @@index([email])
}
```

#### Member (added `teamId`)

```prisma
model Member {
  // ... existing fields ...

  // Optional team association (BetterAuth internal alignment when teams are enabled)
  teamId     String?  @map("teamId")

  @@unique([userId, orgId])
}
```

---

## SQL DDL Statements

### Team Table

```sql
CREATE TABLE "Team" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
  "name"         TEXT         NOT NULL,
  "slug"         TEXT,
  "description"  TEXT,
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ  NOT NULL,
  "organizationId" TEXT       NOT NULL,

  PRIMARY KEY ("id"),
  CONSTRAINT "Team_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "Team_slug_key" UNIQUE ("slug")
);

CREATE INDEX "Team_organizationId_name_idx" ON "Team" ("organizationId", "name");
CREATE INDEX "Team_slug_idx" ON "Team" ("slug");

-- Row Level Security
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_isolation_policy" ON "Team"
  USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

### TeamMember Table

```sql
CREATE TABLE "TeamMember" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "teamId"       TEXT         NOT NULL,
  "userId"       TEXT         NOT NULL,
  "organizationId" TEXT       NOT NULL,

  PRIMARY KEY ("id"),
  CONSTRAINT "TeamMember_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamMember_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamMember_userId_teamId_key" UNIQUE ("userId", "teamId")
);

CREATE INDEX "TeamMember_organizationId_idx" ON "TeamMember" ("organizationId");
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember" ("teamId");

-- Row Level Security
ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_member_isolation_policy" ON "TeamMember"
  USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

### TeamRole Table

```sql
CREATE TABLE "TeamRole" (
  "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "teamId"       TEXT         NOT NULL,
  "roleId"       TEXT         NOT NULL,
  "organizationId" TEXT       NOT NULL,

  PRIMARY KEY ("id"),
  CONSTRAINT "TeamRole_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamRole_roleId_fkey"
    FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamRole_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE,
  CONSTRAINT "TeamRole_teamId_roleId_key" UNIQUE ("teamId", "roleId")
);

CREATE INDEX "TeamRole_organizationId_idx" ON "TeamRole" ("organizationId");

-- Row Level Security
ALTER TABLE "TeamRole" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_role_isolation_policy" ON "TeamRole"
  USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

---

## Relationship Diagrams

### Entity-Relationship Overview

```
Organization 1──N Team          (org has many teams)
Team      1──N TeamMember       (team has many members)
User      N──1 TeamMember       (user can be in many teams)
Team      1──N TeamRole         (team has many default roles)
Role      N──1 TeamRole         (role can be a default for many teams)
Member    1──N MemberRole       (member has many roles, including team-inherited)
```

### Team Membership Flow

```
User ──has──> Member (org membership)
                │
                ├──> TeamMember ──> Team
                │                    │
                │                    └──> TeamRole ──> Role (inherited)
                │
                └──> MemberRole ──> Role (org-level + team-inherited)
```

### Cascade Delete Chain

```
Organization deleted
  └──> Team cascade delete
        ├──> TeamMember cascade delete
        └──> TeamRole cascade delete
```

---

## Usage Patterns

### Creating a Team

```typescript
import { TeamService } from '@/services/team-service';

const team = await TeamService.createTeam(
  { name: 'Maintenance', slug: 'maintenance', description: 'Handles maintenance requests' },
  organizationId,
  ctx, // ServiceContext with userId and role
);
```

### Adding a Member to a Team (with Role Inheritance)

```typescript
const teamMember = await TeamService.addTeamMember(
  teamId,
  { userId: 'user-123' },
  ctx,
);

// Automatically assigns all TeamRole-linked roles to the member via MemberRole
```

### Removing a Member from a Team (with Role Revocation)

```typescript
await TeamService.removeTeamMember(
  teamId,
  'user-123',
  ctx,
);

// Automatically revokes all team-inherited roles from the member's MemberRole records
```

### Assigning a Role to a Team (for Inheritance)

```typescript
const teamRole = await TeamService.assignTeamRole(
  teamId,
  { roleId: 'role-456' },
  ctx,
);

// All future members of this team will automatically receive 'role-456'
```

### Listing Teams in an Organization

```typescript
const result = await TeamService.getTeamsByOrg(
  organizationId,
  ctx,
  page: 1,
  pageSize: 20,
);

// Returns { teams: TeamData[], pagination: {...} }
```

---

## Tenant Isolation

All team-related models are organization-scoped and covered by the defense-in-depth strategy:

1. **Prisma Extension** (`lib/tenant-db.ts`): Automatically injects `organizationId` into all queries on `Team`, `TeamMember`, and `TeamRole`.
2. **PostgreSQL RLS**: Row Level Security policies filter all operations by `organizationId`.
3. **Service Layer Authorization**: `TeamService` methods enforce platform admin and tenant admin boundaries.

### Exempt Models List

The following models are org-scoped (not global) and included in the tenant isolation exempt list:

- `Team`
- `TeamMember`
- `TeamRole`

### Cross-Tenant Prevention

A user in Organization A cannot read, update, or delete teams from Organization B:

- **Application layer**: Prisma extension injects `organizationId` filter into all queries.
- **Database layer**: RLS policies block access to rows with mismatching `organizationId`.

---

## Default "Members" Team

Every organization is automatically bootstrapped with a default team:

| Field | Value |
|-------|-------|
| `name` | `"Members"` |
| `slug` | `"members"` |
| `description` | `null` |

This team serves as the catch-all for organization members not assigned to any functional team. It mirrors common patterns (e.g., GitHub's default team structure).

---

## Seeding Profiles

### Developer Profile (default mode)

```
Platform Organization ("Platform")
├── Team: "Platform Ops" (slug: platform-ops)
│   └── Member: admin@nipp.gov.uk (Super Admin, via TeamMember)
│
Tenant Organization: "Dev Tenant Ltd" (slug: dev-tenant-ltd)
├── Team: "Members" (default, slug: members)
└── Team: "Operations" (slug: operations)
    ├── Member: dev-tenant-a@example.com
    └── Member: dev-tenant-b@example.com
```

### Testing Profile (test mode — `TEST_ADMIN_EMAIL` set)

```
Platform Organization ("Platform")
├── Team: "Platform Ops" (slug: platform-ops)
│   └── Member: TEST_ADMIN_EMAIL (Super Admin Test User, via TeamMember)
│
Tenant Organization: "Test Tenant Ltd" (slug: test-tenant-ltd)
├── Team: "Members" (default, slug: members)
└── Team: "QA Operations" (slug: qa-operations)
    ├── Member: TEST_TENANT_A_EMAIL
    └── Member: TEST_TENANT_B_EMAIL
```

---

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/api/organizations/[orgId]/teams` | List teams (paginated) | Admin |
| POST | `/api/organizations/[orgId]/teams` | Create team | Admin |
| GET | `/api/organizations/[orgId]/teams/[teamId]` | Get team details + members + roles | Admin |
| PATCH | `/api/organizations/[orgId]/teams/[teamId]` | Update team | Admin |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]` | Delete team (empty for tenant admins) | Admin |
| GET | `/api/organizations/[orgId]/teams/[teamId]/members` | List team members (paginated) | Admin |
| POST | `/api/organizations/[orgId]/teams/[teamId]/members` | Add member (with role inheritance) | Admin |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]/members?userId=...` | Remove member (with role revocation) | Admin |
| GET | `/api/organizations/[orgId]/teams/[teamId]/roles` | List team roles | Admin |
| POST | `/api/organizations/[orgId]/teams/[teamId]/roles` | Assign role to team (for inheritance) | Admin |
| DELETE | `/api/organizations/[orgId]/teams/[teamId]/roles?roleId=...` | Remove role from team | Admin |

---

## BetterAuth Configuration

### Server-side (`lib/auth.ts`)

```typescript
organization({
  teams: { enabled: true },
  // Hooks scaffolded as no-op stubs for future extension
})
```

### Client-side (`lib/auth-client.ts`)

```typescript
organizationClient({
  teams: { enabled: true },
})
```

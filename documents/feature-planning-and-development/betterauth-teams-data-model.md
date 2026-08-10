# BetterAuth Teams — Prisma & Database SQL Data Model

## Table of Contents
1. [Overview](#overview)
2. [Entity Relationship Diagram](#entity-relationship-diagram)
3. [New Models — Prisma Schema](#new-models--prisma-schema)
4. [Modified Models — Prisma Schema](#modified-models--prisma-schema)
5. [Complete Updated Schema (New + Modified)](#complete-updated-schema-new--modified)
6. [SQL DDL Statements](#sql-ddl-statements)
7. [Relationships & Cardinality](#relationships--cardinality)
8. [Indexes & Constraints](#indexes--constraints)
9. [Usage Patterns](#usage-patterns)
10. [Tenant Isolation Design](#tenant-isolation-design)
11. [Migration Strategy](#migration-strategy)

---

## Overview

This document describes the complete data model for BetterAuth Teams integration in the Property NI Multi-Tenant Portal. It covers:

- **Three new models:** `Team`, `TeamMember`, `TeamRole`
- **Two modified models:** `Invitation` (adds `teamId?`), `Member` (adds `teamId?`)
- **SQL DDL** for all new and altered tables
- **Relationships** between teams, members, roles, and organizations
- **Tenant isolation** design ensuring cross-org data leakage is impossible

All models follow the Property NI convention: `cuid()` IDs, `DateTime` timestamps, and mandatory `organizationId` on org-scoped models.

---

## Entity Relationship Diagram

```
┌──────────────┐                          ┌──────────────┐
│  Organization │                          │     User     │
├──────────────┤                          ├──────────────┤
│ id (PK)      │                          │ id (PK)      │
│ name         │     1──N                 │ email        │
│ slug         │                         N│              │
│ status       │   ┌──────────┐           │ role         │
│ organizationId│   │  Team    │           └──────┬───────┘
└──────────────┘   ├──────────┤                  │
                   │ id (PK)  │                  │
                   │ name     │       N          │
                   │ slug     │   ┌──────────┐  N│
                   │ desc     │   │TeamMember│  │
                   │ orgId(FK)│   ├──────────┤  │
                   └────┬─────┘   │ teamId(FK)│  │
                        │        │ userId(FK)│  │
                   ┌────┴─────┐  │ orgId(FK)│  │
                   │ Member   │  └────┬─────┘  │
                   ├──────────┤       │        │
                   │ id (PK)  │       │        │
                   │ userId(FK)│      │        │
                   │ orgId(FK)│       │        │
                   │ role     │       │        │
                   └────┬─────┘       │        │
                        │             │        │
                   ┌────┴─────────────┘        │
                   │                            │
              N    │ 1                          │
           ┌───────┴────────┐                  │
           │  MemberRole    │◄─────────────────┘
           ├────────────────┤
           │ id (PK)        │
           │ memberId(FK)   │
           │ roleId(FK)     │
           │ orgId(FK)      │
           └───────┬────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
   N    │    1     │    1     │    N
┌───────┴─────┐ ┌──┴────────┐ ┌┴──────────────┐
│   Role      │ │   Team    │ │  TeamRole     │
├─────────────┤ ├───────────┤ ├───────────────┤
│ id (PK)     │ │ id (PK)   │ │ id (PK)       │
│ name        │ │ name      │ │ teamId (FK)   │
│ orgId (FK)  │ │ slug      │ │ roleId (FK)   │
└─────────────┘ │ desc      │ │ orgId (FK)    │
                │ orgId(FK) │ └───────────────┘
                └───────────┘
                        │
                 ┌──────┴──────┐
                 │ Invitation  │ (modified)
                 ├─────────────┤
                 │ id (PK)     │
                 │ email       │
                 │ teamId? (FK)│ ← NEW
                 │ orgId (FK)  │
                 └─────────────┘
```

---

## New Models — Prisma Schema

### Team Model

Represents a functional grouping within an organization (e.g., "Maintenance Team A", "Letting Agents").

```prisma
/**
 * Team — Functional grouping within an organization.
 * Teams allow users to be organized into sub-organizational units.
 * Each team can have default roles that are automatically assigned to members.
 * Org-scoped for tenant isolation (defense-in-depth).
 */
model Team {
  id          String   @id @default(cuid())
  name        String   // Human-readable team name (e.g., "Maintenance Team A")
  slug        String?  @unique // URL-friendly identifier (auto-generated from name)
  description String?  // Optional team description (max 500 chars)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Relations
  members         TeamMember[]
  roles           TeamRole[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([organizationId, name]) // B-tree for efficient org-scoped team lookups
  @@index([slug])                 // B-tree for unique slug resolution
}
```

**Field Details:**

| Field | Type | Key | Constraints | Description |
|-------|------|-----|-------------|-------------|
| `id` | `String` | PK | `@default(cuid())` | Unique team identifier |
| `name` | `String` | — | Required, max 100 chars (application-level) | Human-readable team name |
| `slug` | `String?` | Unique | Auto-generated from name if not provided | URL-friendly identifier (e.g., "maintenance-team-a") |
| `description` | `String?` | — | Optional, max 500 chars (application-level) | Team purpose/description |
| `organizationId` | `String` | FK → Organization | Required, cascade delete | Parent organization |
| `createdAt` | `DateTime` | — | `@default(now())` | Team creation timestamp |
| `updatedAt` | `DateTime` | — | `@updatedAt` | Last update timestamp |

### TeamMember Model

Junction table linking users to teams. A user can belong to multiple teams within the same organization.

```prisma
/**
 * TeamMember — User-to-team membership junction table.
 * A user can be a member of multiple teams within the same organization.
 * Org-scoped for tenant isolation (defense-in-depth).
 */
model TeamMember {
  id         String   @id @default(cuid())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt  DateTime @default(now())

  @@unique([userId, teamId])   // A user can only be in a team once
  @@index([organizationId])    // B-tree for tenant-scoped queries
  @@index([teamId])            // B-tree for team member lookups
}
```

**Field Details:**

| Field | Type | Key | Constraints | Description |
|-------|------|-----|-------------|-------------|
| `id` | `String` | PK | `@default(cuid())` | Unique membership identifier |
| `teamId` | `String` | FK → Team | Required, cascade delete | Parent team |
| `userId` | `String` | FK → User | Required, cascade delete | Member user |
| `organizationId` | `String` | FK → Organization | Required, cascade delete | Parent organization (tenant isolation) |
| `createdAt` | `DateTime` | — | `@default(now())` | Membership creation timestamp |

### TeamRole Model

Junction table linking teams to organization-scoped roles. Enables role inheritance: when a user joins a team, all roles associated with that team are automatically assigned.

```prisma
/**
 * TeamRole — Team-to-role inheritance mapping.
 * Links teams to organization-scoped roles. When a user joins a team,
 * all associated roles are automatically assigned via MemberRole records.
 * Org-scoped for tenant isolation (defense-in-depth).
 */
model TeamRole {
  id         String   @id @default(cuid())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt  DateTime @default(now())

  @@unique([teamId, roleId])   // A role can only be assigned once per team
  @@index([organizationId])    // B-tree for tenant-scoped queries
}
```

**Field Details:**

| Field | Type | Key | Constraints | Description |
|-------|------|-----|-------------|-------------|
| `id` | `String` | PK | `@default(cuid())` | Unique assignment identifier |
| `teamId` | `String` | FK → Team | Required, cascade delete | Parent team |
| `roleId` | `String` | FK → Role | Required, cascade delete | Assigned role (from the same org) |
| `organizationId` | `String` | FK → Organization | Required, cascade delete | Parent organization (tenant isolation) |
| `createdAt` | `DateTime` | — | `@default(now())` | Assignment creation timestamp |

---

## Modified Models — Prisma Schema

### Invitation Model (Modified)

Adds optional `teamId` field to support team-specific invitations.

```prisma
model Invitation {
  id         String   @id @default(cuid())
  email      String
  role       String?
  token      String   @unique
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  orgId      String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  // ─── NEW FIELD ──────────────────────────────────────────────
  teamId     String?    @map("teamId") // Optional: invite user directly to a team
  // ───────────────────────────────────────────────────────────

  @@index([email])
}
```

**Change:** Added `teamId String? @map("teamId")` — nullable foreign key to Team. When present, the invited user is added to the specified team upon accepting the invitation.

### Member Model (Modified)

Adds optional `teamId` field for BetterAuth internal schema alignment.

```prisma
model Member {
  id         String   @id @default(cuid())
  role       String   @default("member")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId      String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  memberRoles MemberRole[]

  // ─── NEW FIELD ──────────────────────────────────────────────
  teamId     String?    @map("teamId") // Optional: BetterAuth internal team association
  // ───────────────────────────────────────────────────────────

  @@unique([userId, orgId])
}
```

**Change:** Added `teamId String? @map("teamId")` — nullable field aligning with BetterAuth's internal member schema when teams are enabled. This represents the primary team for a member (distinct from `TeamMember` which supports multi-team membership).

---

## Complete Updated Schema (New + Modified)

Below is the complete Prisma schema with all new and modified models. Existing models (User, Session, Account, Organization, Role, Permission, RolePermission, AuditLog, NotificationLog) are unchanged and omitted for brevity.

```prisma
// ============================================================
// TENANT ISOLATION REQUIREMENT
// ============================================================
// Every organization-scoped model MUST include:
//   organizationId String
//   organization   Organization @relation(...)
//   @@index([organizationId])
// ============================================================

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Enums ──────────────────────────────────────────────────

enum OrgStatus {
  PENDING
  ACTIVE
  SUSPENDED
  ARCHIVED
}

enum NotificationStatus {
  SENT
  FAILED
}

// ─── Authentication Models (BetterAuth — global) ────────────

model User {
  id            String    @id @default(cuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  passwordHash  String?
  role          String    @default("member")
  banned        Boolean?  @default(false)
  banReason     String?
  banExpires    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  activeOrganizationId  String?   @map("activeOrganizationId")

  sessions Session[]
  accounts Account[]
  members  Member[]
}

model Session {
  id           String    @id @default(cuid())
  expiresAt    DateTime
  token        String    @unique
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  ipAddress    String?
  userAgent    String?
  userId       String
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Account {
  id                String    @id @default(cuid())
  accountId         String
  providerId        String
  providerAccountId String?
  password          String?
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state      String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  userId   String
  user     User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([providerId, providerAccountId])
  @@index([userId])
}

// ─── Multi-Tenancy Models (BetterAuth Organization Plugin) ──

model Organization {
  id          String   @id @default(cuid())
  slug        String?  @unique
  name        String
  status      OrgStatus @default(PENDING)
  metadata    Json?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  members            Member[]
  invitations        Invitation[]
  sentInvitations    SentInvitation[]
  memberRoles        MemberRole[]
  auditLogs          AuditLog[]
  notificationLogs   NotificationLog[]
  roles              Role[]
  rolePermissions    RolePermission[]
  teams              Team[]                     // NEW
}

model Member {
  id         String   @id @default(cuid())
  role       String   @default("member")
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  orgId      String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)
  memberRoles MemberRole[]

  // NEW: BetterAuth internal team association
  teamId     String?    @map("teamId")

  @@unique([userId, orgId])
}

model Invitation {
  id         String   @id @default(cuid())
  email      String
  role       String?
  token      String   @unique
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  orgId      String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  // NEW: Optional team association for invitations
  teamId     String?    @map("teamId")

  @@index([email])
}

model SentInvitation {
  id         String   @id @default(cuid())
  email      String
  role       String?
  token      String   @unique
  expiresAt  DateTime
  createdAt  DateTime @default(now())

  orgId      String
  organization Organization @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([email])
}

// ─── RBAC Models (Authorization & Role-Based Access Control) ──

model Permission {
  id          String   @id @default(cuid())
  key         String   @unique
  resource    String
  action      String
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  roles       RolePermission[]
}

model Role {
  id          String   @id @default(cuid())
  name        String
  description String?
  isDefault   Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  permissions        RolePermission[]
  memberRoles        MemberRole[]
  teamRoles          TeamRole[]              // NEW

  @@index([name])
}

model RolePermission {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())

  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  permissionId String
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: NoAction)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([roleId, permissionId])
  @@index([organizationId])
}

model MemberRole {
  id         String   @id @default(cuid())
  createdAt  DateTime @default(now())

  memberId   String
  member     Member   @relation(fields: [memberId], references: [id], onDelete: Cascade)

  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([memberId, roleId])
  @@index([organizationId])
}

// ─── TEAM MODELS (NEW) ──────────────────────────────────────

model Team {
  id          String   @id @default(cuid())
  name        String
  slug        String?  @unique
  description String?

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  members         TeamMember[]
  roles           TeamRole[]

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([organizationId, name])
  @@index([slug])
}

model TeamMember {
  id         String   @id @default(cuid())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt  DateTime @default(now())

  @@unique([userId, teamId])
  @@index([organizationId])
  @@index([teamId])
}

model TeamRole {
  id         String   @id @default(cuid())

  teamId     String
  team       Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  roleId     String
  role       Role     @relation(fields: [roleId], references: [id], onDelete: Cascade)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt  DateTime @default(now())

  @@unique([teamId, roleId])
  @@index([organizationId])
}

// ─── Audit & Notification Models ────────────────────────────

model AuditLog {
  id             String       @id @default(cuid())
  timestamp      DateTime     @default(now())
  userId         String?
  userName       String?
  action         String
  resourceType   String
  resourceId     String?
  organizationId String?
  ipAddress      String?
  userAgent      String?
  success        Boolean      @default(true)
  metadata       Json?

  organization   Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([organizationId])
  @@index([timestamp])
  @@index([resourceType])
}

model NotificationLog {
  id               String         @id @default(cuid())
  timestamp        DateTime       @default(now())
  recipientEmail   String
  eventType        String
  message          String?
  status           NotificationStatus @default(SENT)
  organizationId   String?

  organization     Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([timestamp])
}
```

---

## SQL DDL Statements

### CREATE TABLE — Team

```sql
CREATE TABLE "Team" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
    "name"         VARCHAR(100) NOT NULL,
    "slug"         TEXT,
    "description"  TEXT,
    "organizationId" TEXT       NOT NULL,
    "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updatedAt"    TIMESTAMPTZ  NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Team_slug_unique" UNIQUE ("slug"),
    CONSTRAINT "Team_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- Indexes
CREATE INDEX "Team_organizationId_name_idx" ON "Team" ("organizationId", "name");
CREATE INDEX "Team_slug_idx" ON "Team" ("slug");

-- Row Level Security (defense-in-depth)
ALTER TABLE "Team" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_isolation" ON "Team"
    USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

### CREATE TABLE — TeamMember

```sql
CREATE TABLE "TeamMember" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
    "teamId"       TEXT         NOT NULL,
    "userId"       TEXT         NOT NULL,
    "organizationId" TEXT       NOT NULL,
    "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamMember_userId_teamId_unique" UNIQUE ("userId", "teamId"),
    CONSTRAINT "TeamMember_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE,
    CONSTRAINT "TeamMember_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
    CONSTRAINT "TeamMember_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- Indexes
CREATE INDEX "TeamMember_organizationId_idx" ON "TeamMember" ("organizationId");
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember" ("teamId");

-- Row Level Security (defense-in-depth)
ALTER TABLE "TeamMember" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_member_isolation" ON "TeamMember"
    USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

### CREATE TABLE — TeamRole

```sql
CREATE TABLE "TeamRole" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid(),
    "teamId"       TEXT         NOT NULL,
    "roleId"       TEXT         NOT NULL,
    "organizationId" TEXT       NOT NULL,
    "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "TeamRole_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TeamRole_teamId_roleId_unique" UNIQUE ("teamId", "roleId"),
    CONSTRAINT "TeamRole_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE,
    CONSTRAINT "TeamRole_roleId_fkey"
        FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE,
    CONSTRAINT "TeamRole_organizationId_fkey"
        FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE
);

-- Indexes
CREATE INDEX "TeamRole_organizationId_idx" ON "TeamRole" ("organizationId");

-- Row Level Security (defense-in-depth)
ALTER TABLE "TeamRole" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "team_role_isolation" ON "TeamRole"
    USING ("organizationId"::text = current_setting('app.current_org_id', true));
```

### ALTER TABLE — Invitation (add teamId)

```sql
ALTER TABLE "Invitation" ADD COLUMN "teamId" TEXT;

ALTER TABLE "Invitation"
    ADD CONSTRAINT "Invitation_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL;

-- No RLS needed on Invitation — it already has orgId and is covered by existing policies
```

### ALTER TABLE — Member (add teamId)

```sql
ALTER TABLE "Member" ADD COLUMN "teamId" TEXT;

ALTER TABLE "Member"
    ADD CONSTRAINT "Member_teamId_fkey"
        FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL;

-- No RLS needed on Member — it already has orgId and is covered by existing policies
```

---

## Relationships & Cardinality

### Organization → Team (1:N)

An organization has one or more teams. The default "Members" team is created automatically on organization bootstrapping.

```
Organization ──1──N── Team
```

**Cascade behavior:** Deleting an organization cascade-deletes all its teams.

### Team → TeamMember (1:N)

A team has one or more members. A user can be a member of multiple teams within the same organization (enforced by unique constraint on `[userId, teamId]`, not `[userId, teamId, organizationId]`).

```
Team ──1──N── TeamMember ──N──1── User
```

**Cascade behavior:** Deleting a team cascade-deletes all its `TeamMember` records. A user is automatically removed from the team but retains their organization membership (via `Member`).

### Team → TeamRole (1:N)

A team can have zero, one, or multiple default roles. Each role is an organization-scoped `Role` from the existing RBAC system.

```
Team ──1──N── TeamRole ──N──1── Role
```

**Cascade behavior:** Deleting a team cascade-deletes all its `TeamRole` records. Deleting a role cascade-deletes all `TeamRole` references to it.

### Role Inheritance Flow

When a user is added to a team, the system automatically creates `MemberRole` records for all roles associated with that team:

```
1. User is added to Team "Maintenance" (teamId: t-123)
2. System queries TeamRole where teamId = 't-123' → finds Role "Maintenance Staff" (roleId: r-456)
3. System creates MemberRole record: { memberId: m-789, roleId: r-456, organizationId: org-001 }
4. User now has the "Maintenance Staff" role with all its permissions
```

### Invitation → Team (0:1)

An invitation may optionally target a specific team. If `teamId` is null, the invited user joins the organization without a specific team assignment (they are added to the default "Members" team).

```
Invitation ──0──1── Team
```

**Cascade behavior:** Deleting a team sets `teamId` to NULL on any pending invitations targeting that team (`ON DELETE SET NULL`).

### Member → Team (0:1)

A member has one primary team association (BetterAuth internal). This is distinct from `TeamMember` which supports multi-team membership. The `teamId` on `Member` represents the member's "home" team for display purposes.

```
Member ──0──1── Team
```

---

## Indexes & Constraints

### Summary Table

| Model | Constraint/Index | Type | Purpose |
|-------|-----------------|------|---------|
| `Team` | `PK (id)` | Primary Key | Unique team identification |
| `Team` | `UNIQUE (slug)` | Unique | URL-friendly identifier uniqueness |
| `Team` | `FK (organizationId) → Organization` | Foreign Key | Org ownership, cascade delete |
| `Team` | `INDEX (organizationId, name)` | Composite B-tree | Efficient org-scoped team listing + search |
| `Team` | `INDEX (slug)` | B-tree | Fast slug resolution |
| `TeamMember` | `PK (id)` | Primary Key | Unique membership identification |
| `TeamMember` | `UNIQUE (userId, teamId)` | Unique | Prevent duplicate team membership |
| `TeamMember` | `FK (teamId) → Team` | Foreign Key | Team ownership, cascade delete |
| `TeamMember` | `FK (userId) → User` | Foreign Key | User ownership, cascade delete |
| `TeamMember` | `FK (organizationId) → Organization` | Foreign Key | Org ownership, cascade delete |
| `TeamMember` | `INDEX (organizationId)` | B-tree | Tenant-scoped queries |
| `TeamMember` | `INDEX (teamId)` | B-tree | Team member lookups |
| `TeamRole` | `PK (id)` | Primary Key | Unique assignment identification |
| `TeamRole` | `UNIQUE (teamId, roleId)` | Unique | Prevent duplicate role assignment per team |
| `TeamRole` | `FK (teamId) → Team` | Foreign Key | Team ownership, cascade delete |
| `TeamRole` | `FK (roleId) → Role` | Foreign Key | Role ownership, cascade delete |
| `TeamRole` | `FK (organizationId) → Organization` | Foreign Key | Org ownership, cascade delete |
| `TeamRole` | `INDEX (organizationId)` | B-tree | Tenant-scoped queries |
| `Invitation` | `ADD COLUMN teamId?` | Nullable FK → Team | Optional team target for invitations |
| `Member` | `ADD COLUMN teamId?` | Nullable FK → Team | BetterAuth internal team association |

### Index Design Rationale

1. **`Team(organizationId, name)` composite index:** Supports the most common query pattern — listing teams within an organization, optionally filtered by name. The composite index allows PostgreSQL to use index-only scans for `WHERE organizationId = ? ORDER BY name`.

2. **`TeamMember(organizationId)` index:** Critical for tenant isolation — all queries on team memberships must be scoped by organization. This index enables efficient `WHERE organizationId = ?` filtering.

3. **`TeamMember(teamId)` index:** Supports the common pattern of listing all members of a specific team (`WHERE teamId = ?`).

4. **`TeamRole(organizationId)` index:** Enables efficient queries for "get all roles assigned to teams in this organization" — needed for permission resolution and team role management.

---

## Usage Patterns

### Pattern 1: Create Organization with Default Team

```typescript
// In OrganizationService.createOrganization() — within a transaction:
const organization = await tx.organization.create({
  data: { name, slug },
});

// Bootstrap default "Members" team
const membersTeam = await tx.team.create({
  data: {
    name: 'Members',
    slug: 'members',
    organizationId: organization.id,
  },
});

// If an admin user is created/associated during org creation:
await tx.teamMember.create({
  data: {
    userId: user.id,
    teamId: membersTeam.id,
    organizationId: organization.id,
  },
});
```

### Pattern 2: Create Team (Organization Admin)

```typescript
// In TeamService.createTeam():
const team = await tx.team.create({
  data: {
    name: input.name,
    slug: input.slug ?? input.name.toLowerCase().replace(/\s+/g, '-'),
    description: input.description,
    organizationId: ctx.organizationId,  // Auto-scoped by Prisma extension
  },
});

// Trigger afterCreateTeam hook (scaffolded in lib/auth.ts)
```

### Pattern 3: Add Member to Team (with Role Inheritance)

```typescript
// In TeamService.addTeamMember():
return await globalDb.$transaction(async (tx) => {
  // 1. Verify user is an org member
  const existingMember = await tx.member.findFirst({
    where: { userId, orgId: ctx.organizationId },
  });
  if (!existingMember) {
    throw new ValidationError('User is not a member of this organization');
  }

  // 2. Verify team exists in the same org
  const team = await tx.team.findFirst({
    where: { id: input.teamId, organizationId: ctx.organizationId },
  });
  if (!team) {
    throw new NotFoundError('Team not found');
  }

  // 3. Create team membership
  const teamMember = await tx.teamMember.create({
    data: { userId, teamId: input.teamId, organizationId: ctx.organizationId },
  });

  // 4. Auto-assign team roles (role inheritance)
  const teamRoles = await tx.teamRole.findMany({
    where: { teamId: input.teamId },
  });

  for (const tr of teamRoles) {
    // Check if member already has this role (avoid duplicates)
    const existing = await tx.memberRole.findFirst({
      where: { memberId: existingMember.id, roleId: tr.roleId },
    });
    if (!existing) {
      await tx.memberRole.create({
        data: {
          memberId: existingMember.id,
          roleId: tr.roleId,
          organizationId: ctx.organizationId,
        },
      });
    }
  }

  return teamMember;
});
```

### Pattern 4: Remove Member from Team (Revoke Inherited Roles)

```typescript
// In TeamService.removeTeamMember():
return await globalDb.$transaction(async (tx) => {
  // 1. Find the team membership
  const teamMember = await tx.teamMember.findFirst({
    where: { userId, teamId },
  });
  if (!teamMember) {
    throw new NotFoundError('User is not a member of this team');
  }

  // 2. Find roles assigned via this team (TeamRole → Role)
  const inheritedRoles = await tx.teamRole.findMany({
    where: { teamId },
    include: { role: true },
  });

  // 3. Remove inherited MemberRole records (but preserve org-level roles)
  for (const tr of inheritedRoles) {
    await tx.memberRole.deleteMany({
      where: {
        memberId: existingMember.id,
        roleId: tr.roleId,
        // Only remove if this role was assigned via the team (not org-level)
        // This requires tracking the source of each MemberRole assignment
      },
    });
  }

  // 4. Delete the team membership
  await tx.teamMember.delete({ where: { id: teamMember.id } });

  return { success: true };
});
```

### Pattern 5: Assign Role to Team (Role Inheritance Setup)

```typescript
// In TeamService.assignTeamRole():
return await tx.teamRole.create({
  data: {
    teamId,
    roleId,
    organizationId: ctx.organizationId,  // Auto-scoped by Prisma extension
  },
});

// All existing and future members of this team will inherit the assigned role.
```

### Pattern 6: List Teams with Member Count (for UI)

```typescript
// In TeamService.getTeamsByOrg():
const teams = await globalDb.team.findMany({
  where: { organizationId: ctx.organizationId },
  include: {
    _count: { select: { members: true } },
    roles: { include: { role: true } },
  },
  orderBy: { name: 'asc' },
});

// Returns: [{ id, name, slug, description, _count: { members: 5 }, roles: [...] }]
```

---

## Tenant Isolation Design

### Defense-in-Depth for Team Models

All three new team models (`Team`, `TeamMember`, `TeamRole`) are organization-scoped and covered by both layers of the defense-in-depth strategy:

| Layer | Mechanism | Coverage |
|-------|-----------|----------|
| **Layer 1: Application** | Prisma Extension (`lib/tenant-db.ts`) | All queries on `Team`, `TeamMember`, `TeamRole` are automatically filtered by `organizationId` |
| **Layer 2: Database** | PostgreSQL RLS policies | All queries on `Team`, `TeamMember`, `TeamRole` are filtered by session variable `app.current_org_id` |

### Prisma Extension Configuration

The tenant-scoped Prisma client must include team models in both the **scoped models list** (models that get auto-filtered) and the **exempt models list** (models that are org-scoped, not global):

```typescript
// In lib/tenant-db.ts:

const ORG_SCOPED_MODELS = [
  // Existing models...
  'Team',       // NEW: Team is org-scoped
  'TeamMember', // NEW: TeamMember is org-scoped
  'TeamRole',   // NEW: TeamRole is org-scoped
] as const;

const GLOBAL_MODELS = [
  'User',
  'Session',
  'Account',
  'Organization',
  'Member',
  'Invitation',
  'SentInvitation',
  'Permission',   // Global permission catalog
  'AuditLog',     // Global audit trail
  'NotificationLog',
] as const;

// Team, TeamMember, and TeamRole are NOT in GLOBAL_MODELS
// They ARE in ORG_SCOPED_MODELS and get auto-filtered by organizationId
```

### ESLint Exempt List Update

The ESLint rule preventing direct imports of the unscoped `prisma` client must be updated:

```json
// eslint.config.mjs — exempt models for direct prisma imports
{
  "exemptModels": [
    // Existing...
    "Team",       // NEW: org-scoped, requires tenant-db import
    "TeamMember", // NEW: org-scoped, requires tenant-db import
    "TeamRole",   // NEW: org-scoped, requires tenant-db import
  ]
}
```

### RLS Policy Template

When creating new org-scoped tables in future proposals, the migration MUST include:

```sql
-- Enable RLS on all org-scoped tables
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;

-- Create tenant isolation policy
CREATE POLICY "<table>_isolation" ON "<table>"
    USING ("organizationId"::text = current_setting('app.current_org_id', true));

-- Apply to all operations
ALTER POLICY "<table>_isolation" ON "<table>" USING (true) FOR ALL;
```

---

## Migration Strategy

### Migration File Structure

```
prisma/migrations/
  0001_add_teams_model/
    migration.sql          -- DDL for Team, TeamMember, TeamRole + ALTER TABLE for Invitation and Member
```

### Migration Steps

1. **Create new tables** — `Team`, `TeamMember`, `TeamRole` with all constraints, indexes, and RLS policies
2. **Alter existing tables** — Add `teamId` column to `Invitation` and `Member`
3. **Bootstrap default teams** — Run a seed script to add "Members" team to all existing organizations
4. **Regenerate Prisma Client** — `prisma generate`

### Seed Script for Existing Organizations

```typescript
// prisma/seed-teams.ts — one-time migration script
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function bootstrapDefaultTeams() {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  for (const org of organizations) {
    // Check if default team already exists
    const existing = await prisma.team.findFirst({
      where: { organizationId: org.id, slug: 'members' },
    });

    if (!existing) {
      await prisma.team.create({
        data: {
          name: 'Members',
          slug: 'members',
          organizationId: org.id,
        },
      });
      console.log(`Created default "Members" team for org: ${org.name}`);
    }
  }
}

bootstrapDefaultTeams()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

### Rollback Plan

If the migration needs to be rolled back:

1. Drop RLS policies on `Team`, `TeamMember`, `TeamRole`
2. Drop foreign key constraints on `teamId` in `Invitation` and `Member`
3. Drop the three new tables
4. Remove `teamId` columns from `Invitation` and `Member`

```sql
-- Rollback DDL (execute in reverse order)
DROP POLICY IF EXISTS "team_role_isolation" ON "TeamRole";
DROP POLICY IF EXISTS "team_member_isolation" ON "TeamMember";
DROP POLICY IF EXISTS "team_isolation" ON "Team";

ALTER TABLE "Member" DROP CONSTRAINT "Member_teamId_fkey";
ALTER TABLE "Member" DROP COLUMN "teamId";

ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_teamId_fkey";
ALTER TABLE "Invitation" DROP COLUMN "teamId";

DROP TABLE IF EXISTS "TeamRole";
DROP TABLE IF EXISTS "TeamMember";
DROP TABLE IF EXISTS "Team";
```

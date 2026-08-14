# Resource Data Model

## Overview

Introduces a global `Resource` data model that wraps portal features/modules, controlling which organization-scoped roles can access them. Resources are managed exclusively by Super Admins through the integrated dashboard.

## What Changed

- **New Prisma models:** `Resource` (global feature catalog) and `ResourceRole` (global junction table linking resources to org-scoped roles).
- **New service:** `services/resource-service.ts` — full CRUD with Platform Admin authorization.
- **New API routes:** `/api/dashboard/admin/resources/...` — REST endpoints for the dashboard.
- **New UI page:** `/dashboard/admin/resources` — list, create, edit, delete resources with role assignment.
- **Updated sidebar:** New "Resources" nav item (Layers icon) in the integrated dashboard.

## Specifications

- **`specs/resource-data-model/spec.md`** — BDD scenarios for schema, service layer, and API routes.
- **`specs/resource-ui/spec.md`** — BDD scenarios for the Resources page, modals, sidebar, and design system.

## Related Proposals

- **`data-model-services`** — Service layer patterns, `ServiceContext`, typed errors.
- **`integrated-super-admin-dashboard`** — Dashboard UI components, sidebar layout, API route conventions.
- **`auth-and-rbac`** — RBAC engine, `requireSuperAdmin()` guards.

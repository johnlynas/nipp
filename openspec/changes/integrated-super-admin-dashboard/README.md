# Integrated Super Admin Dashboard

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-08-11  
**Last Updated:** 2026-08-11  

## Overview
This change introduces a new, unified Super Admin dashboard at `/dashboard/admin` that consolidates CRUD operations and relationship management for Organizations, Users, Teams, Roles, and Permissions into a single integrated interface. The dashboard connects directly to the existing data model services to provide live data access, with a collapsible navy sidebar, light content area, and corporate/enterprise aesthetic.

Key differentiator from the existing `/admin/*` dashboard: **relationship-aware management** — Users can be assigned to Teams with inherited Roles; Roles are linked to Permissions (1-to-many); Organizations contain Teams which contain Users. All relationships are managed through the new dashboard's UI and backed by dedicated REST endpoints.

## Artifacts
- [Proposal](proposal.md) — Intent, scope, execution boundary, approach
- [Design](design.md) — Technical decisions and architecture
- [Tasks](tasks.md) — Implementation tasks broken into 11 phases
- [Spec: Dashboard UI](specs/dashboard-ui/spec.md) — UI/UX requirements delta
- [Spec: Organizations](specs/organizations/spec.md) — Organization CRUD and lifecycle requirements delta
- [Spec: Users](specs/users/spec.md) — User CRUD, ban/unban, role assignment requirements delta
- [Spec: Teams](specs/teams/spec.md) — Team CRUD, membership, role inheritance requirements delta
- [Spec: Roles & Permissions](specs/roles-permissions/spec.md) — Role CRUD, permission catalog, relationship management requirements delta

## Related Changes
- `project-initialization` — Foundational architecture, BetterAuth setup, tenant isolation
- `auth-and-rbac` — RBAC system with Permission, Role, and MemberRole models
- `super-admin-org-mgmt` — Existing Super Admin dashboard at `/admin/*`, global DB client, audit logging
- `betterauth-teams-integration` — Team model (Team, TeamMember, TeamRole), team CRUD APIs
- `data-model-services` — Standardized service layer (OrganizationService, UserService, RoleService, PermissionService)

## Non-Goals
- No changes to existing `/admin/*` dashboard (it remains in place)
- No changes to login page or any auth flows
- No shadcn/ui dependency (raw Tailwind CSS with Property NI tokens)
- No analytics/charts panel (deferred)

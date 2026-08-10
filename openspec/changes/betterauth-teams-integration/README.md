# BetterAuth Teams Integration

**Status:** Proposed  
**Author:** Property NI Development Team  
**Created:** 2026-08-10  
**Last Updated:** 2026-08-10  

## Overview
This change integrates BetterAuth's Teams feature into the Property NI Multi-Tenant Portal, adding a sub-organizational grouping layer with role inheritance. Teams allow users to be organized into functional units within an organization, with default roles automatically assigned upon team membership.

## Artifacts
- [Proposal](proposal.md) — Intent, scope, execution boundary, approach
- [Design](design.md) — Technical decisions and architecture
- [Tasks](tasks.md) — Implementation tasks broken into 8 phases
- [Spec: Auth](specs/auth/spec.md) — Authentication-related requirements delta
- [Spec: Database](specs/database/spec.md) — Data model requirements delta
- [Spec: Multi-Tenancy](specs/multi-tenancy/spec.md) — Tenant isolation requirements delta
- [Spec: Testing](specs/testing/spec.md) — Test coverage requirements delta

## Related Changes
- `project-initialization` — Foundational architecture, BetterAuth setup, tenant isolation
- `auth-and-rbac` — RBAC system with Permission, Role, and MemberRole models

## Documentation
- Detailed data model: `documents/feature-planning-and-development/betterauth-teams-data-model.md`

# Proposal: Interactive Calendar

## Intent

Build an interactive, multi-view calendar component for the Property NI portal that enables all user classes to view, create, edit, and manage organization-scoped calendar events. The calendar supports month, week, day, and multi-year views with drag-and-drop rescheduling, event detail modals, quick-add via sidebar or right-click context menu, and recurring events (weekly through annually).

The calendar is a **standalone shared component** (`components/calendar/`) usable across any organization context, with events scoped per `organizationId` via the existing tenant isolation strategy (Prisma Extension + PostgreSQL RLS).

Initially, the calendar will be integrated into the **Integrated Super Admin Dashboard** (`/dashboard/admin`) as a new sidebar navigation item.

## References & Foundational Rules

This proposal builds upon and must strictly adhere to the rules, design system, and infrastructure established in:

- **`project-initialization`**: Core architecture, tenant isolation strategy (Prisma Extension + RLS), BetterAuth setup, version pinning, and secrets management.
- **`basic-authentication-login-flow`**: Login flow, session management, cookie handling, and cross-tab invalidation.
- **`auth-and-rbac`**: RBAC engine, permission catalog (`resource:action` syntax), Redis caching with 5-min TTL, session augmentation, `usePermission` hooks, `<RequirePermission>` component, and automatic role bootstrapping.
- **`data-model-services`**: Standardized service layer with `ServiceContext` interface, typed error classes (`ValidationError`, `NotFoundError`, `ConflictError`, `ForbiddenError`), authorization checks, and Redis cache invalidation.
- **`integrated-super-admin-dashboard`**: The Integrated Super Admin Dashboard layout, sidebar navigation pattern with collapsible state, and the existing nav item structure using `lucide-react` icons.
- **`resource-data-model`**: Resource catalog pattern for linking features to org-scoped roles.
- **`betterauth-teams-integration`**: Team model and organization-scoped data patterns.
- **Notification Infrastructure** (`lib/notifications/dispatcher.ts`, `lib/notifications/email.ts`, `lib/notifications/events.ts`): Email dispatch with rate limiting via Redis, logging to `NotificationLog`, Property NI branded email templates.

**Mandatory Rules Enforced:**
- **Unified Architecture:** Single Next.js origin. No separate backend servers.
- **Version Pinning:** Node.js 22 LTS, Next.js 15, React 19, Vitest 4.x.
- **Database & ORM:** PostgreSQL only, Prisma ORM. All new org-scoped models MUST include `organizationId` with proper relation and index.
- **Tenant Isolation:** `organizationId` is mandatory on all organization-scoped models. The defense-in-depth strategy (Prisma Extension + RLS) must not be bypassed.
- **Secrets Management:** No real secrets committed to GitHub. Use `.env.example` for new variables if needed.
- **Test-Driven Completeness:** No code is considered "done" without passing tests. Every new library function, API route, and UI component must have corresponding unit tests.
- **Strict Property NI Design System Compliance:** ALL UI components MUST use the Property NI color palette. Navy (`#1B2A4A`) for primary elements. Amber (`#F5A623`) for accents, CTAs, and highlights. NO exceptions.
- **Import Path & Casing Consistency:** All imports MUST use correct PascalCase for component names. Import paths MUST use `@/` alias and match exact file casing.
- **Edge vs. Node Runtime Boundaries:** Services must never be imported from client components or middleware (Edge runtime boundary). API routes MUST use `nodejs` runtime.
- **Stand-Alone Component:** The calendar component MUST be a reusable, standalone component in `components/calendar/` that can be integrated into any organization context.
- **No Changes to Existing Admin Dashboard:** The current `/admin/*` dashboard remains in place and fully functional.

## Non-Regression Requirements

This proposal MUST NOT break any functionality established in previous proposals:
- **Auth:** Cookie clearing, database session invalidation, full page reload on logout.
- **AuthZ:** Permission resolution with Redis caching, session augmentation, automatic role bootstrapping.
- **Project:** Prisma Extension tenant isolation, additive/non-destructive migrations.
- **Super Admin Org Mgmt:** Existing `/admin/*` dashboard must continue to function.
- **Integrated Super Admin Dashboard:** All existing panels (Users, Organizations, Teams, Roles, Permissions) must continue to function. The new Calendar nav item is additive only.
- **Data Model Services:** Existing service layer methods must continue to work unchanged.

## Scope

**In Scope:**
1. **Prisma Schema Changes** — New `Calendar`, `CalendarEvent`, and `CalendarRecurrence` models with appropriate enums (`CalendarEventType`, `CalendarRecurrenceFrequency`). All org-scoped with `organizationId`.
2. **Permission Catalog Entries** — New permissions: `calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete`.
3. **Resource Catalog Entry** — New resource "calendars" linked to org-scoped roles for feature-level access control.
4. **CalendarService** (`services/calendar-service.ts`) — Full CRUD for calendars with default calendar bootstrapping.
5. **CalendarEventService** (`services/calendar-event-service.ts`) — Full CRUD for events, date range queries, recurrence expansion, upcoming events query.
6. **API Routes** — REST endpoints under `/api/organizations/[orgId]/calendar/*` and `/api/organizations/[orgId]/calendar-events/*`.
7. **Calendar UI Components** — Standalone reusable component in `components/calendar/`:
   - `Calendar.tsx` — Main container with view toggle
   - `CalendarMonthView.tsx` — Month grid renderer
   - `CalendarWeekView.tsx` — Week view renderer
   - `CalendarDayView.tsx` — Day view renderer
   - `CalendarEventCard.tsx` — Expandable/compressible event card
   - `CalendarSidebar.tsx` — Slide-in/out upcoming events panel with Quick Add
   - `CalendarEventModal.tsx` — Event detail/edit modal
   - `CalendarContextMenu.tsx` — Right-click context menu on dates
   - `calendar-utils.ts` — Pure utility functions (date math, recurrence expansion)
8. **Drag-and-Drop Rescheduling** — HTML5 drag-and-drop for moving events between dates.
9. **Recurring Events** — Support for weekly, monthly, quarterly, semi-annually, and annually recurring events with server-side expansion.
10. **Integrated Super Admin Dashboard Integration** — New Calendar nav item in sidebar with `<CalendarDays />` icon from lucide-react.
11. **Prisma Seeding** — Test calendars and events for dev and test profiles in `prisma/seed.ts`.
12. **Calendar Notification Service** (`services/calendar-notification-service.ts`) — Service for sending today's event notifications to users or organizations. Reuses existing email dispatch (`lib/notifications/dispatcher.ts`), rate limiting, and `NotificationLog`.
13. **Calendar Notification REST Endpoints** — API routes under `/api/organizations/[orgId]/calendar-notifications/*` for triggering notifications, viewing today's events, and checking delivery history.
14. **Testing** — Unit tests for services, utility functions, and UI components; integration tests for API routes and recurrence expansion.

**Out of Scope (Deferred):**
- Scheduler integration (automated event creation from maintenance requests, lease events).
- Tenant-facing calendar view.
- Calendar sharing between organizations (cross-org collaboration).
- Export to iCal/Google Calendar.
- Timezone support (local datetime only for v1).
- Color theme customization per organization.
- In-app SSE notification push (email-only for v1; SSE broadcast deferred to scheduler phase).
- Push notifications (mobile).

### Requirement: Tenant Isolation

All calendar and calendar event data MUST be scoped to `organizationId`. The existing Prisma Extension (`lib/tenant-db.ts`) and PostgreSQL RLS policies must automatically enforce isolation. No events from one organization may be visible to another.

### Requirement: Stand-Alone Component

The calendar component MUST be designed as a standalone, reusable component in `components/calendar/`. It accepts data via props and/or SWR/data hooks. It MUST NOT be tightly coupled to the Integrated Super Admin Dashboard — it can be integrated into any organization context in the future.

### Requirement: RBAC Enforcement

All calendar operations MUST be gated by the new `calendar:*` permissions. The permission resolution follows the existing pattern: users need the appropriate `calendar:<action>` permission in their assigned roles to perform calendar operations.

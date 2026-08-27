# Interactive Calendar — Feature Record & Architecture

The interactive calendar is a multi-view, organization-scoped event management component for the Property NI portal. It enables all user classes to view, create, edit, and manage calendar events with support for month, week, day, and year views; drag-and-drop rescheduling; event detail modals with recurrence pickers; quick-add via right-click context menu; and recurring events (daily through annually) using RFC 5545-compliant rules.

The calendar is a standalone shared component (`components/calendar/`) usable across any organization context, with events scoped per `organizationId` at the data-model level. It is integrated into the Integrated Super Admin Dashboard at `/dashboard/admin/calendar`.

**Status: Fully implemented.** All planning phases are complete. The RFC 5545 migration from custom recurrence expansion to the `rrule` library was completed in August 2026.

## Table of Contents

- [1. Overview](#1-overview)
- [2. Functional Requirements (Implemented)](#2-functional-requirements-implemented)
  - [2.1 Functional Requirements](#21-functional-requirements)
  - [2.2 Non-Functional Requirements](#22-non-functional-requirements)
- [3. Data Model](#3-data-model)
  - [3.1 Prisma Schema (Current State)](#31-prisma-schema-current-state)
  - [3.2 Recurrence Storage (rrule JSON Format)](#32-recurrence-storage-rrule-json-format)
  - [3.3 Permissions](#33-permissions)
  - [3.4 Relationship Diagram](#34-relationship-diagram)
- [4. Component Architecture](#4-component-architecture)
  - [4.1 Directory Structure](#41-directory-structure)
  - [4.2 Component Descriptions](#42-component-descriptions)
  - [4.3 Integration Points](#43-integration-points)
- [5. Service Layer](#5-service-layer)
  - [5.1 CalendarService](#51-calendarservice)
  - [5.2 CalendarEventService](#52-calendareventservice)
  - [5.3 Recurrence Expansion Engine (rrule-based)](#53-recurrence-expansion-engine-rrule-based)
  - [5.4 Recurrence Edit Scopes](#54-recurrence-edit-scopes)
  - [5.5 Calendar Notification Service](#55-calendar-notification-service)
- [6. API Routes (Current State)](#6-api-routes-current-state)
  - [6.1 Calendar Endpoints (CRUD)](#61-calendar-endpoints-crud)
  - [6.2 Calendar Event Endpoints](#62-calendar-event-endpoints)
  - [6.3 Calendar Notification Endpoints](#63-calendar-notification-endpoints)
  - [6.4 Payload Formats](#64-payload-formats)
- [7. Testing (Current State)](#7-testing-current-state)
  - [7.1 Unit Tests](#71-unit-tests)
  - [7.2 Integration Tests](#72-integration-tests)
  - [7.3 Isolation Tests](#73-isolation-tests)
  - [7.4 E2E Tests](#74-e2e-tests)
  - [7.5 Test Results Snapshot](#75-test-results-snapshot)
- [8. RFC 5545 Migration — Historical Record](#8-rfc-5545-migration--historical-record)
  - [8.1 Why rrule, Not Full Replacement?](#81-why-rrule-not-full-replacement)
  - [8.2 Migration Phases Completed](#82-migration-phases-completed)
  - [8.3 Migration Rollback Plan (Historical)](#83-migration-rollback-plan-historical)
- [9. Risks & Mitigations](#9-risks--mitigations)
- [10. Known Gaps & Follow-ups](#10-known-gaps--follow-ups)
- [11. Future Considerations (Out of Scope)](#11-future-considerations-out-of-scope)

## Appendices

- [A. API Route Reference](#appendix-a-api-route-reference)
- [B. rrule JSON Format Reference](#appendix-b-rrule-json-format-reference)
- [C. Calendar Event Type Icons](#appendix-c-calendar-event-type-icons)
- [D. Cross-References](#appendix-d-cross-references)

---

## 1. Overview

The calendar enables all user classes to view, create, edit, and manage organization-scoped events. Key capabilities:

- **Multi-view navigation:** Month, week, day, and year views with toggle controls
- **Drag-and-drop rescheduling:** HTML5 drag events, persisted via PATCH (for recurring events, only the dragged instance moves)
- **Event detail modals:** Edit/delete with recurrence picker and Google Calendar-style scope selector ("this", "this & following", "all")
- **Quick-add:** Right-click context menu on calendar dates opens a pre-populated create modal
- **Recurring events:** Daily through annually with interval, end-date and occurrence-count limits; expansion computed server-side via `rrule`
- **Calendar notifications:** Email notification service for today's events, dispatched via the existing notification infrastructure

The calendar is integrated into the Integrated Super Admin Dashboard (`app/dashboard/admin/layout.tsx`) as a sidebar navigation item at `/dashboard/admin/calendar`, using the `CalendarDays` icon from lucide-react. The page renders `<Calendar organizationId={...} />` with full-height layout.

---

## 2. Functional Requirements (Implemented)

### 2.1 Functional Requirements

All requirements are implemented:

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Month, Week, Day views with toggle navigation (multi-year deferred) | Must Have — ✅ month/week/day/year implemented; Year view is a 12-month grid with per-day event dots |
| FR-2 | Color-coded event cards on calendar dates with type-specific icons | ✅ |
| FR-3 | Upcoming Events sidebar that slides in/out to maximize screen real estate | ✅ |
| FR-4 | Full CRUD for events (Create, Read, Update, Delete) | ✅ |
| FR-5 | Drag-and-drop event rescheduling between dates | ✅ (HTML5 DnD, persisted via PATCH) |
| FR-6 | Event detail modal with edit/delete capabilities | ✅ (includes recurrence picker + scope selector) |
| FR-7 | Quick Add via right-click context menu on calendar dates | ✅ (context-menu only; "Add Event" opens the create-event modal pre-populated with clicked date) |
| FR-8 | Multiple events per date, expandable/compressible display | ✅ |
| FR-9 | Recurring events: daily through annually with interval/end/count limits | ✅ (DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY) |
| FR-13 | RFC 5545 recurrence compliance (month-end overflow, BYDAY, BYMONTHDAY) | ✅ — migrated from custom engine to `rrule` library |
| FR-14 | Google Calendar-style edit scopes: "this event", "this & following", "all events" | ✅ — scope handlers in `lib/recurrence-scopes.ts`, wired into PATCH endpoint and UI |
| FR-10 | Standalone reusable component in `components/calendar/` | ✅ |
| FR-11 | Organization-scoped events via `organizationId` (tenant isolation) | ✅ — models in tenant extension + org filters on all service queries |
| FR-12 | Integration into Integrated Super Admin Dashboard sidebar navigation | ✅ (`/dashboard/admin/calendar`) |

### 2.2 Non-Functional Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-1 | Must use Property NI standard UI elements and color scheme (Navy `#1B2A4A`, Amber `#F5A623`) | ✅ |
| NFR-2 | Must respect existing RBAC permissions (`calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete`) | ✅ |
| NFR-3 | Must comply with tenant isolation (Prisma Extension + RLS) | ✅ — models registered in `TENANT_SCOPED_MODELS`, explicit org filters on all queries |
| NFR-4 | Must be fully tested: unit tests for services, API routes, and UI components | ✅ unit + integration done; component tests deferred (see §10) |
| NFR-5 | Must follow existing service layer patterns (`ServiceContext`, typed errors, pagination) | ✅ |
| NFR-6 | Must integrate with existing notification system for event reminders | ✅ email path implemented; SSE push deferred |

---

## 3. Data Model

### 3.1 Prisma Schema (Current State)

Two models were added to `prisma/schema.prisma` for calendar functionality. The `CalendarRecurrence` model and `recurrenceId` scalar were removed as part of the RFC 5545 migration (Phase 5).

```prisma
/**
 * Calendar — Container/namespace for events within an organization.
 * Each org gets one default calendar at bootstrap. Supports multiple calendars
 * per org for future extensibility (e.g., "Maintenance Calendar", "Lettings Calendar").
 */
model Calendar {
  id          String   @id @default(cuid())
  name        String   // Human-readable calendar name
  description String?
  color       String   @default("#1B2A4A") // Default color theme
  isDefault   Boolean  @default(false) // Exactly one default calendar per org
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  events CalendarEvent[]

  @@unique([organizationId, name]) // Prevent duplicate names within an org
  @@index([organizationId])
}

/**
 * CalendarEvent — Individual events within a calendar.
 * Supports single-day, multi-day, and recurring events via rrule JSON.
 */
model CalendarEvent {
  id          String   @id @default(cuid())
  title       String
  description String?
  startDate   DateTime // Local datetime (no timezone for v1)
  endDate     DateTime // Local datetime (no timezone for v1)
  eventType   CalendarEventType @default(OTHER)
  color       String?  // Event-level override of calendar default color

  calendarId String
  calendar   Calendar @relation(fields: [calendarId], references: [id], onDelete: Cascade)

  /** RFC 5545 recurrence rule stored as JSON (rrule format). */
  rrule        Json?
  /** Excluded dates from expansion (YYYY-MM-DD strings). */
  exdates      Json @default("[]") @db.Json

  propertyId String? // Optional property association (nullable for general events)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([organizationId, startDate]) // Efficient date range queries
  @@index([propertyId])                // Property-based event lookups (future scheduler)
}

enum CalendarEventType {
  VIEWING
  INSPECTION
  MAINTENANCE
  LEASE_SIGNING
  LEASE_RENEWAL
  KEY_EXCHANGE
  OTHER
}
```

### 3.2 Recurrence Storage (rrule JSON Format)

Recurrence rules are stored as JSON objects on `CalendarEvent.rrule`. The format follows RFC 5545 conventions as used by the [`rrule`](https://github.com/jakubroztocil/rrule) library:

```json
{
  "freq": "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY",
  "interval": 1,
  "dtstart": "2026-01-05T10:00:00.000Z",
  "until": "2026-12-31T23:59:59.999Z" | null,
  "count": 12 | null,
  "byweekday": ["MO", "WE", "FR"] | null,
  "bymonthday": [15] | null
}
```

**Field details:**

| Field | Type | Description |
|-------|------|-------------|
| `freq` | Frequency | Recurrence frequency. Note: rrule has no native QUARTERLY or SEMI_ANNUALLY; these are stored as `MONTHLY` with adjusted intervals. |
| `interval` | Number | Repeat every N frequency units (e.g., interval=2 with WEEKLY = every 2 weeks) |
| `dtstart` | ISO string | First occurrence (matches event.startDate) |
| `until` | ISO string or null | Optional end date; mutually exclusive with `count` for infinite recurrence |
| `count` | Number or null | Optional maximum occurrence count; mutually exclusive with `until` |
| `byweekday` | Array or null | Day-of-week filters (e.g., `["MO"]` for every Monday) |
| `bymonthday` | Array or null | Day-of-month filters (e.g., `[15]` for the 15th of each month) |

**Special frequency mappings:**

| Display Frequency | Stored `freq` | Interval Multiplier |
|-------------------|---------------|---------------------|
| DAILY | `DAILY` | ×1 |
| WEEKLY | `WEEKLY` | ×1 |
| MONTHLY | `MONTHLY` | ×1 |
| QUARTERLY | `MONTHLY` | ×3 |
| SEMI_ANNUALLY | `MONTHLY` | ×6 |
| ANNUALLY | `YEARLY` | ×1 |

**exdates field:** Excluded dates are stored as a JSON array of ISO date strings (`"YYYY-MM-DD"`) on `CalendarEvent.exdates`. These dates are filtered out during recurrence expansion. Used by:
- Drag-and-drop rescheduling (original date excluded, one-off created at new date)
- Edit scope "this" handler (clicked instance excluded from base series)

### 3.3 Permissions

Seeded by `prisma/seed.ts` with `isDefault: true` (resource key is `calendars`):

| Permission Key | Resource | Action | Description |
|---------------|----------|--------|-------------|
| `calendar:read` | calendars | read | View calendar events |
| `calendar:create` | calendars | create | Create new calendar events |
| `calendar:update` | calendars | update | Edit existing calendar events |
| `calendar:delete` | calendars | delete | Delete calendar events |

### 3.4 Relationship Diagram

```
Organization <1:M--> Calendar <1:M--> CalendarEvent (rrule JSON + exdates on event)
                                                          |
                                                          +-- propertyId --> Property (plain column, no FK relation yet)
```

---

## 4. Component Architecture

### 4.1 Directory Structure

```
components/calendar/
├── Calendar.tsx                      # Main container (view toggle, data fetching, DnD orchestration)
├── CalendarMonthView.tsx             # Month view grid renderer
├── CalendarWeekView.tsx              # Week view grid renderer (7-column, hourly time slots)
├── CalendarDayView.tsx               # Day view grid renderer (single column, hourly time slots)
├── CalendarYearView.tsx              # Year view (12-month mini grid with event dots)
├── CalendarEventCard.tsx             # Individual event card (expandable/compressible)
├── CalendarEventModal.tsx            # Event detail/edit modal (recurrence picker + scope selector)
├── CalendarSidebar.tsx               # Upcoming Events sidebar (slide-in/out, collapsed by default)
├── CalendarContextMenu.tsx           # Right-click context menu on dates (quick add)
├── CalendarRecurrencePicker.tsx      # Recurrence rule picker UI (frequency/interval/end)
├── RecurrenceEditScopePicker.tsx     # Scope selector ("this", "following", "all") for recurring edits
├── calendar-utils.ts                 # Date math, month grid generation, event instance keying, formatting
├── types.ts                          # Shared TypeScript types (CalendarEventWithDetails, rrule JSON)
└── hooks/
    └── useVerticalDragScroll.ts      # Hook for vertical drag scrolling in calendar views

services/
├── calendar-service.ts               # Calendar CRUD + default-calendar bootstrapping
├── calendar-event-service.ts         # Event CRUD, recurrence expansion (rrule-based), upcoming events
└── calendar-notification-service.ts  # Today's-events email notifications

lib/
├── recurrence-rrule.ts               # rrule-based expansion engine (expandRecurrenceWithRrule, getAllOccurrences)
├── recurrence-scopes.ts              # "this/following/all" edit scope handlers (applyEditScopeThis/Following/All)
└── recurrence.ts                     # Display helpers only (formatting, date utilities — no expansion logic)

app/api/organizations/[orgId]/
├── calendar/route.ts                 # GET, POST calendars
├── calendar/[id]/route.ts            # GET, PATCH, DELETE calendar
├── calendar-events/route.ts          # GET (date range), POST events — rrule JSON payload
├── calendar-events/upcoming/route.ts # GET upcoming events for sidebar (deduped, sorted)
├── calendar-events/[id]/route.ts     # GET, PATCH (editScope), DELETE event
└── calendar-notifications/
    ├── today/route.ts                # GET today's events for current user/org
    ├── send-today/route.ts           # POST trigger notifications for today's events
    └── history/route.ts              # GET notification delivery history

app/dashboard/admin/calendar/page.tsx  # Dashboard page wiring <Calendar organizationId={...} />

prisma/seed.ts                         # Idempotent calendar seed data (ensureCalendar / ensureEvent)
```

### 4.2 Component Descriptions

| Component | Responsibility |
|-----------|---------------|
| `Calendar.tsx` | Main container: view toggle, data fetching from API routes, drag-and-drop orchestration (HTML5 events), passes props to view components |
| `CalendarMonthView.tsx` | Month grid renderer using `generateMonthDays`; renders event cards per day cell |
| `CalendarWeekView.tsx` | 7-column week grid with hourly time slots; renders event cards positioned by time |
| `CalendarDayView.tsx` | Single-column day grid with hourly time slots; detailed event view |
| `CalendarYearView.tsx` | 12-month mini grid with per-day event dots and monthly counts; clicking a month drills into Month view |
| `CalendarEventCard.tsx` | Individual event card: expandable/compressible, color-coded by type, shows icon and title |
| `CalendarEventModal.tsx` | Event detail/edit modal: form fields, recurrence picker, scope selector (for recurring events); reuses dashboard `<Modal>` component |
| `CalendarSidebar.tsx` | Upcoming Events sidebar: collapsed (icon-only, 64px) or expanded (320px); smooth CSS transition (~200ms) |
| `CalendarContextMenu.tsx` | Right-click context menu on calendar dates; "Add Event" opens create modal pre-populated with clicked date |
| `CalendarRecurrencePicker.tsx` | Recurrence rule picker UI: frequency, interval, end date/count; writes rrule JSON on save |
| `RecurrenceEditScopePicker.tsx` | Scope selector for recurring event edits: "This occurrence", "This & following", "All occurrences"; shown only when editing a recurring event instance |
| `calendar-utils.ts` | Pure functions: date math, month grid generation, event instance keying (`id + startDate` for dedup), formatting |
| `hooks/useVerticalDragScroll.ts` | Hook providing vertical drag-scroll behavior for calendar views |

### 4.3 Integration Points

| Component | Integrates With | Purpose |
|-----------|----------------|---------|
| Calendar page + sidebar nav item | Integrated Super Admin Dashboard layout (`app/dashboard/admin/layout.tsx`) | Nav item with `CalendarDays` icon; page at `/dashboard/admin/calendar` with full-height layout |
| `CalendarEventCard` | Property NI design system | Navy/Amber color scheme, Tailwind CSS v4 classes |
| `CalendarEventModal` | Existing `<Modal>` component pattern (`components/dashboard/Modal.tsx`) | Reuses modal infrastructure for event detail/edit forms |
| Recurrence expansion | Server: `services/calendar-event-service.ts`; client mirror: `calendar-utils.ts` | Pure functions, no external dependencies; server-side expansion is authoritative for API responses |
| Notifications (email) | `services/calendar-notification-service.ts` + existing email dispatcher (`lib/notifications/email.ts`) | Today's-events email notifications; SSE push is a future extension |

---

## 5. Service Layer

Services are exported as **object literals** of named async functions (not classes with static methods), consistent with the rest of `services/`.

### 5.1 CalendarService (`services/calendar-service.ts`)

```typescript
export interface CreateCalendarInput { name: string; description?: string | null; }
export interface UpdateCalendarInput { name?: string; description?: string | null; color?: string; }
export interface CalendarWithCount { /* calendar fields + _count.events */ }

export const CalendarService = {
  createCalendar,        // (ctx, input) — admin only; bootstraps default calendar
  getCalendars,          // (ctx, orgId) — lists calendars with event counts
  getCalendarById,       // (ctx, id)
  updateCalendar,        // (ctx, id, input) — admin only
  deleteCalendar,        // (ctx, id) — admin only; cascades events
  getDefaultCalendar,    // (ctx, orgId)
  ensureDefaultCalendar, // (ctx, orgId) — idempotent default-calendar bootstrap
};
```

### 5.2 CalendarEventService (`services/calendar-event-service.ts`)

```typescript
export interface CreateEventInput {
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  calendarId: string;
  eventType?: 'VIEWING' | 'INSPECTION' | 'MAINTENANCE' | 'LEASE_SIGNING' | 'LEASE_RENEWAL' | 'KEY_EXCHANGE' | 'OTHER';
  color?: string | null;
  propertyId?: string | null;
  rrule?: RruleJson | null;       // RFC 5545 recurrence rule in JSON format
  exdates?: string[];              // ISO date strings to exclude from expansion
}

export interface UpdateEventInput { /* same fields, all optional; rrule: null clears the rule; exdates can append */ }
export interface GetEventsInput { startDate: Date; endDate: Date; calendarId?: string; }
export interface CalendarEventWithDetails { /* event fields + rrule: RruleJson | null */ }

export const CalendarEventService = {
  createEvent,              // (ctx, input) — creates event with rrule JSON on the event
  getEvents,                // (ctx, input) — non-expanding; kept for completeness
  getEventsWithRecurrences, // (ctx, input) — used by GET route; expands recurring series into instances
  getEventById,             // (ctx, eventId) — includes rrule details
  updateEvent,              // (ctx, eventId, input) — in-place rule update / add / clear
  deleteEvent,              // (ctx, eventId) — deletes event (no separate recurrence row to cascade)
  getUpcomingEvents,        // (ctx, orgId?, limit = 10) — single + recurring instances, deduped & sorted
};

/** Pure function (synchronous) — exported for reuse and unit testing. */
export function expandRecurrence(
  event: CalendarEventWithDetails,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEventWithDetails[];
```

### 5.3 Recurrence Expansion Engine (rrule-based)

The recurrence expansion engine was migrated from a custom `advanceDate` + manual iteration algorithm to the RFC 5545-compliant [`rrule`](https://github.com/jakubroztocil/rrule) library.

**`lib/recurrence-rrule.ts` — Expansion functions:**

| Function | Description |
|----------|-------------|
| `expandRecurrenceWithRrule(event, rangeStart, rangeEnd)` | Uses rrule's `RRule.between()` to expand recurring events into instances within the date range. Filters out dates in `event.exdates` via Set lookup. |
| `getAllOccurrences(event)` | Returns all occurrences of an event (no range limit). Used by calendar views that need to render the full series. |
| `rruleToJsonString(rruleJson)` | Serializes rrule JSON to a human-readable string for display. |

**`lib/recurrence.ts` — Display helpers only:**

This file no longer contains expansion logic. It now provides:
- `getRecurrenceLabel(frequency, interval)` — human-readable recurrence label (e.g., "Every 2 weeks")
- `getRecurrenceEndDateLabel(endDate, count)` — end date or occurrence count label
- Date formatting utilities: `formatDate`, `formatDateTime`, `formatTime`
- Date comparison helpers: `isSameDay`, `isToday`
- Input value conversion: `toLocalDateTimeInputValue`, `toLocalDateInputValue`, `parseLocalDateInputValue`
- Event instance keying: `getEventInstanceKey(event)` — returns `${id}_${startDate}` for deduplication

### 5.4 Recurrence Edit Scopes

Google Calendar-style edit scopes are implemented in `lib/recurrence-scopes.ts` and wired into the PATCH endpoint. Three levels of recurrence modification are supported:

| Scope | Behavior | Server Action |
|-------|----------|---------------|
| **This** | Only the selected occurrence is modified. Other instances stay unchanged. | EXDATE added to base event's `exdates` array; detached override created with new values. |
| **This & Following** | The selected occurrence and all subsequent occurrences are modified; earlier instances stay unchanged. | Original series terminated with UNTIL before target date; new series created from target date with updates applied. |
| **All** | The entire recurring series is updated; all previous EXDATEs and detached overrides are cleared. | Base event updated with new values; `exdates` reset to empty array. |

**Function signatures:**

```typescript
// lib/recurrence-scopes.ts
export async function applyEditScopeThis(ctx: ServiceContext, eventId: string, updates: UpdateEventInput): Promise<void>
export async function applyEditScopeFollowing(ctx: ServiceContext, eventId: string, updates: UpdateEventInput): Promise<void>
export async function applyEditScopeAll(ctx: ServiceContext, eventId: string, updates: UpdateEventInput): Promise<void>
```

**Implementation details:**

- **"This" scope:** Adds the occurrence date to `exdates` and creates a detached override event keyed by `${eventId}_override_${YYYY-MM-DD}`. The override shares the same event id as the base.
- **"This & Following" scope:** Sets `UNTIL` on the base event's rrule to end of day before target date. Creates a new base event from the target date with updates applied, keyed as `${eventId}_following`.
- **"All" scope:** Updates the base event in-place with new values, clears `exdates` to empty array. All previous detached overrides and exclusions are discarded.
- **Re-fetch on scope change:** When "following" or "all" scopes create/modify multiple events, the visible range is re-fetched after save.

**Drag-and-drop for recurring events:** When a user drags one instance of a recurring event to a new date, the system uses PATCH with `editScope: "this"` (adding the original date to `exdates`) and creates a one-off event at the dragged-to date. Only the dragged instance moves; all other instances stay in place.

### 5.5 Calendar Notification Service (`services/calendar-notification-service.ts`)

A dedicated notification service for today's events. Follows the existing `services/*-service.ts` pattern with REST endpoints, consistent with the notification infrastructure.

```typescript
export const CalendarNotificationService = {
  getTodayEvents,              // (ctx, orgId) — all events happening today for an organization
  getTodayEventsForUser,       // (ctx, userId) — events happening today for a specific user
  sendTodayEventNotifications, // (ctx, input) — send notifications for today's events to user or all org members
};

interface SendNotificationInput {
  userId?: string;            // Notify a specific user (optional)
  organizationId: string;     // Notify all members of an org (required if userId not provided)
  eventIds: string[];         // Calendar events triggering the notification
  notifyType: 'TODAY_EVENTS' | 'UPCOMING_TODAY';
}
```

**Notification flow:**
1. **Trigger:** Scheduled job (cron) or API call scans for events where `startDate` falls on the current date
2. **Recipient resolution:** For each target (user or org), resolve all member emails from the `Member` model
3. **Message generation:** Branded email using Property NI colors (Navy header, Amber accent bar)
4. **Dispatch:** Reuses `dispatchNotification` from `lib/notifications/dispatcher.ts` for rate-limited email delivery
5. **Logging:** Writes to existing `NotificationLog` Prisma model

---

## 6. API Routes (Current State)

Routes verify session (401), membership in the URL's organization (403), and derive `TENANT_ADMIN`/`MEMBER` from the member record before calling the service.

### 6.1 Calendar Endpoints (CRUD)

| Method | Route | File | Description | Auth |
|--------|-------|------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar` | `calendar/route.ts` | List all calendars for org (with event counts) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar` | `calendar/route.ts` | Create a new calendar | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Get calendar by ID | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Update calendar (name, description, color) | Tenant admin + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Delete calendar (cascades events) | Tenant admin + `calendar:delete` |

### 6.2 Calendar Event Endpoints

| Method | Route | File | Description | Auth |
|--------|-------|------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-events` | `calendar-events/route.ts` | Get events in date range — returns expanded instances for recurring series (`?start=&end=`) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-events` | `calendar-events/route.ts` | Create a new event (optionally recurring via rrule JSON) | Tenant member + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-events/upcoming` | `calendar-events/upcoming/route.ts` | Get upcoming events for sidebar (single + recurring, deduped) | Tenant member + `calendar:read` |
| GET | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Get event by ID (includes rrule details) | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Update event (`rrule: null` clears the rule; `editScope` controls recurrence scope) | Tenant member + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Delete event (no separate recurrence row to cascade) | Tenant member + `calendar:delete` |

### 6.3 Calendar Notification Endpoints

| Method | Route | File | Description | Auth |
|--------|-------|------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-notifications/today` | `today/route.ts` | Get today's events for current user/org | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-notifications/send-today` | `send-today/route.ts` | Trigger notifications for today's events (manual or scheduled) | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-notifications/history` | `history/route.ts` | View notification delivery history (from NotificationLog) | Tenant admin |

### 6.4 Payload Formats

**Create event with rrule JSON:**
```json
{
  "title": "Weekly Team Review",
  "startDate": "2026-08-25T10:00",
  "endDate": "2026-08-25T11:00",
  "eventType": "OTHER",
  "calendarId": "cls123...",
  "rrule": {
    "freq": "WEEKLY",
    "interval": 1,
    "dtstart": "2026-08-25T10:00:00.000Z",
    "until": "2027-06-30T00:00:00.000Z",
    "byweekday": ["MO"]
  },
  "exdates": []
}
```

**Update event with edit scope:**
```json
{
  "title": "Updated Title",
  "startDate": "2026-09-15T14:00",
  "editScope": "following"
}
```

The `editScope` field accepts `"this"` (default), `"following"`, or `"all"`. It controls how recurrence modifications are applied.

---

## 7. Testing (Current State)

### 7.1 Unit Tests

| Test File | Scope |
|-----------|-------|
| `tests/unit/calendar-event-service-create.test.ts` | createEvent: non-recurring → no rule; recurring → rrule JSON persisted; MEMBER forbidden on mutations |
| `tests/unit/calendar-event-service-delete.test.ts` | deleteEvent: with/without recurrence; MEMBER forbidden; NotFoundError |
| `tests/unit/calendar-event-service-query.test.ts` | getEventsWithRecurrences: rrule expansion, range queries, sorting; getUpcomingEvents dedupe/sort/limit |
| `tests/unit/calendar-event-service-update.test.ts` | updateEvent: in-place rrule update; add/clear rule via null; MEMBER forbidden |
| `tests/unit/calendar-event-service-upcoming.test.ts` | getUpcomingEvents: mixed single+recurring, no duplicate instances, sorted, limit; validation without org |
| `tests/unit/calendar-utils.test.ts` | Date math (month grid generation, week boundaries), frontend recurrence expansion mirror, event instance keying, formatting |
| `tests/unit/recurrence-rrule.test.ts` | rrule-based expansion: all frequencies, intervals, BYDAY/BYMONTHDAY, month-end overflow (Jan 31 → Feb 28), leap year (Feb 29), EXDATE filtering, count vs until termination |
| `tests/unit/recurrence-scopes.test.ts` | Edit scope handlers: "this" → EXDATE + detached override; "following" → UNTIL termination on base + new series from clicked date; "all" → reset base, clear all EXDATEs |

### 7.2 Integration Tests (service-level against real PostgreSQL)

| Test File | Scope |
|-----------|-------|
| `tests/integration/calendar-events-create.test.ts` | createEvent with rrule JSON, org isolation, MEMBER forbidden |
| `tests/integration/calendar-events-query.test.ts` | getEventsWithRecurrences with rrule expansion, date range queries, upcoming events dedup/sort |
| `tests/integration/calendar-events-update.test.ts` | updateEvent with editScope, rrule JSON round-trip (serialize → deserialize → expand matches original), CalendarRecurrence table cleanup |

### 7.3 Isolation Tests

Calendar-specific isolation tests (`tests/isolation/application/calendar-isolation.test.ts`, 23 tests) verify that calendar queries are properly scoped to the requesting organization via both the Prisma tenant extension and explicit service-level filters.

### 7.4 E2E Tests

`tests/isolation/e2e/calendar-interactions.spec.ts` covers calendar interactions including scope picker UI, rrule-based recurrence display, and drag-and-drop with the new expansion engine.

### 7.5 Test Results Snapshot

- **Timezone:** `tests/setup.ts` pins `process.env.TZ = 'UTC'` for deterministic assertions
- **Overall:** Full test suite green; `tsc --noEmit` clean; ESLint (`--max-warnings=0`) clean; production build succeeds
- **Seed data:** `prisma/seed.ts` seeds calendar data idempotently (`ensureCalendar` / `ensureEvent`) for both dev and test profiles — Platform org default calendar; dev tenant: 5 events (today's inspection, tomorrow's viewing, weekly + monthly recurring series, 3-day maintenance window); test tenant: today's inspection + weekly recurring review

---

## 8. RFC 5545 Migration — Historical Record

> **Status:** All phases completed and merged (August 2026).
> **Approach:** Adopt `rrule` for recurrence expansion while keeping existing calendar UI components. This gave RFC 5545 compliance with minimal risk to the working UI layer.
> **Actual effort:** ~11 developer-days across 6 phases (as estimated).

### 8.1 Why rrule, Not Full Replacement?

| Factor | Full replacement (e.g., ilamy) | Hybrid (rrule only) |
|--------|-------------------------------|---------------------|
| Bundle impact | +~40KB min (core) + ~13 Radix packages | +~25KB min (rrule only) |
| UI risk | High — entire calendar rewritten | None — existing UI stays |
| Development time | ~3–4 weeks (single dev) | ~11 days |
| Maintenance burden | Inherits single-dev project risk | rrule is mature, well-maintained |
| Feature parity | Good (but unproven in NIPP context) | Proven — existing UI works |
| Plugin system value | Low for NIPP's needs | Not needed |

### 8.2 Migration Phases Completed

**Phase 0: Data Model Alignment (2 days) — Complete**
1. Added `rrule Json?` and `exdates Json @default("[]")` to `CalendarEvent` model in Prisma schema
2. Created and ran migration script: converted all events with `CalendarRecurrence` relations to rrule JSON format
3. Mapped: frequency, interval, endDate→until, count, byDay→byweekday, byMonthDay→bymonthday
4. Copied excludedDates to exdates; verified occurrence counts match between old and new expansion engines
5. Migration verified on dev database — all events expand identically

**Phase 1: Recurrence Expansion Engine Replacement (2 days) — Complete**
1. `rrule` package installed
2. Created `lib/recurrence-rrule.ts`: `expandRecurrenceWithRrule(event, startDate, endDate)` using rrule's `RRule.between()`
3. Filters out dates in `event.exdates`; applies MAX_OCCURRENCES hard cap
4. Updated `CalendarEventService.getEventsWithRecurrences()` to call the new expansion function
5. Side-by-side comparison passed — old and new engines produce identical output for all test cases

**Phase 2: Edit Scope Implementation (3 days) — Complete**
1. Created `lib/recurrence-scopes.ts` with three async handlers: `applyEditScopeThis`, `applyEditScopeFollowing`, `applyEditScopeAll`
2. Updated PATCH endpoint to accept `editScope` field in request body (`"this"` | `"following"` | `"all"`)
3. Routes to appropriate scope handler when `editScope` is present and event has a recurrence rule
4. Created `RecurrenceEditScopePicker.tsx` component: three radio buttons, only visible when editing a recurring event instance

**Phase 3: UI Updates (2 days) — Complete**
1. Updated `CalendarEventModal.tsx`: added scope picker when editing a recurring event instance, passes `editScope` and clicked date in PATCH request body
2. Updated drag-and-drop in `Calendar.tsx`: uses PATCH with `editScope: "this"` + creates override (replaced old two-step exclude+create-one-off flow)
3. `CalendarRecurrencePicker.tsx`: no changes needed — works with legacy format and API handles conversion to rrule JSON on save

**Phase 4: Testing (2 days) — Complete**
1. Created `tests/unit/recurrence-rrule.test.ts` (25+ tests): all frequency types, intervals, BYDAY/BYMONTHDAY edge cases, month-end overflow, leap year handling, EXDATE filtering, count vs until termination
2. Created `tests/unit/recurrence-scopes.test.ts` (15+ tests): "this" scope, "following" scope, "all" scope
3. Created split integration test files: `calendar-events-create.test.ts`, `calendar-events-query.test.ts`, `calendar-events-update.test.ts`
4. Updated E2E test: `tests/isolation/e2e/calendar-interactions.spec.ts` covers scope picker UI, rrule-based recurrence display, drag-and-drop

**Phase 5: Cleanup (1 day) — Complete**
1. Removed `CalendarRecurrence` model from Prisma schema
2. Removed `recurrenceId` scalar from `CalendarEvent` model in schema
3. Removed `calendarRecurrences CalendarRecurrence[]` from `Organization` model in schema
4. Updated seed data — `ensureRecurringEvent()` now writes rrule JSON directly on events
5. Cleaned up `lib/recurrence.ts` — removed old expansion functions; kept display helpers, types, and constants
6. Updated `components/calendar/types.ts` — removed `CalendarRecurrence` interface, added JSDoc for rrule JSON format
7. Deleted obsolete migration script `scripts/migrate-recurrence-to-rrule.ts`

**Phase 6: Documentation & Handoff (1 day) — Complete**
1. Updated this document to reflect the new rrule-based architecture
2. Added JSDoc for rrule JSON format in `components/calendar/types.ts`
3. Created `documents/operations/migration-runbook.md` with pre-migration backup steps, schema change instructions, smoke tests, rollback plan, and troubleshooting guide
4. API documentation updated — payload formats reflect rrule JSON

### 8.3 Migration Rollback Plan (Historical)

This section documents the rollback steps that were available during migration. The migration is complete and these are kept for historical reference only:

1. **Data model (Phase 0):** The `rrule` and `exdates` fields are nullable — existing events without them continued using the old expansion path. The migration script was idempotent (re-running produced same result).
2. **Engine swap (Phase 1):** `lib/recurrence.ts` was kept until side-by-side comparison passed for all events. If the new engine failed, the service call could revert to the old engine — no data loss.
3. **Full rollback:** Revert all migration branches. The `CalendarRecurrence` table remained intact until Phase 5 cleanup, providing a safety net throughout the migration.

---

## 9. Risks & Mitigations

| Risk | Impact | Status |
|------|--------|--------|
| Recurrence expansion performance for large date ranges | High | **Mitigated:** Expansion limited to view range only; `organizationId + startDate` index for range queries |
| Drag-and-drop complexity with timezone handling | Medium | **Mitigated:** Local datetime throughout (no TZ conversion); validated on server |
| Multi-event display clutter on busy dates | Medium | **Mitigated:** Expand/collapse; "N more" overflow indicator |
| Calendar component reusability vs. dashboard coupling | Medium | **Mitigated:** Calendar is pure presentational + data-fetching component; passes data via props |
| RLS policy performance on large event tables | Medium | **Mitigated:** `organizationId` index exists; tested with realistic data volumes |
| Cross-tenant exposure via unfiltered service queries | High | **Resolved:** Org filters on all event-service queries + calendar models registered in tenant extension |
| rrule expansion produces different dates than custom engine | High | **Resolved:** Side-by-side comparison tests passed for all cases before cutover |
| Migration script corrupts existing recurrence data | High | **Resolved:** One-way migration with verification; run on dev/test first |
| rrule JSON format drift (library version updates) | Medium | **Mitigated:** rrule version pinned; round-trip tests catch format changes |
| Edit scope logic breaks existing drag-and-drop flow | High | **Resolved:** Drag-and-drop uses "this" scope internally; integration tests cover the PATCH+POST flow |

---

## 10. Known Gaps & Follow-ups

| # | Gap | Status |
|---|-----|--------|
| 1 | **Component-level tests** (`CalendarMonthView.test.tsx`, `CalendarEventCard.test.tsx`, etc.) | Still deferred (see §7.1) |
| 2 | **No unit test file for `calendar-service.ts`** (event service + utils are covered) | Still open |
| 3 | **`generateMonthGrid` is exported but unused** by any component (the month view uses `generateMonthDays`) | Kept and tested as part of the exported API |
| 4 | **`getEvents` (non-expanding) is unused by routes** — the GET route uses `getEventsWithRecurrences` | Kept for completeness |

---

## 11. Future Considerations (Out of Scope)

- **Scheduler integration:** Automated event creation from maintenance requests, lease events
- **Tenant-facing calendar:** Tenants viewing their own viewings/maintenance appointments
- **Calendar sharing between organizations** (cross-org collaboration)
- **Export to iCal/Google Calendar**
- **Timezone support:** Currently local datetime only; TZ support deferred to scheduler phase
- **Color theme customization per organization**

---

## Appendix A: API Route Reference

| Method | Route | File | Description | Auth Required |
|--------|-------|------|-------------|---------------|
| GET | `/api/organizations/[orgId]/calendar` | `calendar/route.ts` | List all calendars for org (with event counts) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar` | `calendar/route.ts` | Create a new calendar | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Get calendar by ID | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Update calendar (name, description, color) | Tenant admin + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar/[id]` | `calendar/[id]/route.ts` | Delete calendar (cascades events) | Tenant admin + `calendar:delete` |
| GET | `/api/organizations/[orgId]/calendar-events` | `calendar-events/route.ts` | Get events in date range — returns expanded instances (`?start=&end=`) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-events` | `calendar-events/route.ts` | Create a new event (optionally recurring via rrule JSON) | Tenant member + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-events/upcoming` | `calendar-events/upcoming/route.ts` | Get upcoming events for sidebar (deduped, sorted) | Tenant member + `calendar:read` |
| GET | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Get event by ID (includes rrule details) | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Update event (`rrule: null` clears rule; `editScope` controls scope) | Tenant member + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar-events/[id]` | `calendar-events/[id]/route.ts` | Delete event (no separate recurrence row) | Tenant member + `calendar:delete` |
| GET | `/api/organizations/[orgId]/calendar-notifications/today` | `today/route.ts` | Get today's events for current user/org | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-notifications/send-today` | `send-today/route.ts` | Trigger notifications for today's events | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-notifications/history` | `history/route.ts` | View notification delivery history (NotificationLog) | Tenant admin |

---

## Appendix B: rrule JSON Format Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `freq` | `"DAILY"` \| `"WEEKLY"` \| `"MONTHLY"` \| `"YEARLY"` | Yes | Recurrence frequency. QUARTERLY and SEMI_ANNUALLY are stored as `MONTHLY` with adjusted intervals. |
| `interval` | Number | No (default: 1) | Repeat every N frequency units. E.g., interval=2 with WEEKLY = every 2 weeks. |
| `dtstart` | ISO string (e.g., `"2026-08-25T10:00:00.000Z"`) | Yes | First occurrence; matches event.startDate. |
| `until` | ISO string or null | No | Optional end date for finite recurrence. Mutually exclusive with `count`. |
| `count` | Number or null | No | Optional maximum occurrence count. Mutually exclusive with `until`. A count of 0 yields no occurrences. |
| `byweekday` | Array of day codes or null | No | Day-of-week filters. Codes: `MO`, `TU`, `WE`, `TH`, `FR`, `SA`, `SU`. E.g., `["MO", "WE", "FR"]` for Mon/Wed/Fri. |
| `bymonthday` | Array of integers or null | No | Day-of-month filters. E.g., `[15]` for the 15th of each month, `[-1]` for last day. |

**Special frequency mappings (display → stored):**

| Display Frequency | Stored `freq` | Interval Multiplier |
|-------------------|---------------|---------------------|
| DAILY | `DAILY` | ×1 |
| WEEKLY | `WEEKLY` | ×1 |
| MONTHLY | `MONTHLY` | ×1 |
| QUARTERLY | `MONTHLY` | ×3 |
| SEMI_ANNUALLY | `MONTHLY` | ×6 |
| ANNUALLY | `YEARLY` | ×1 |

**exdates format:** JSON array of ISO date strings (`"YYYY-MM-DD"`). Dates excluded from recurrence expansion. Used by drag-and-drop rescheduling and "this" edit scope.

---

## Appendix C: Calendar Event Type Icons

| EventType | lucide-react Icon | Default Color |
|-----------|-------------------|---------------|
| VIEWING | `Home` | Teal (`#2A9D8F`) |
| INSPECTION | `ClipboardList` | Amber (`#F5A623`) |
| MAINTENANCE | `Wrench` | Orange (`#E76F51`) |
| LEASE_SIGNING | `FileText` | Navy (`#1B2A4A`) |
| LEASE_RENEWAL | `RefreshCw` | Purple (`#7B68AE`) |
| KEY_EXCHANGE | `Key` | Gold (`#D4A017`) |
| OTHER | `Calendar` | Gray (`#6C757D`) |

---

## Appendix D: Cross-References

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](../../ARCHITECTURE.md) | Overall system architecture; calendar is one of the core domain modules |
| [SECURITY.md](../../SECURITY.md) — Multi-Tenant Isolation section | Calendar models (`Calendar`, `CalendarEvent`) registered in `TENANT_SCOPED_MODELS`; org filters on all queries |
| [CACHING_ARCHITECTURE.md](../../CACHING_ARCHITECTURE.md) | Cache layer (L1/L2/Redis) used by calendar API routes for event queries and permission checks |
| [QUICK_START.md](../../QUICK_START.md) | Getting started guide for developers; includes calendar setup steps |
| [Migration Runbook](../../documents/operations/migration-runbook.md) | Pre-migration backup steps, schema change instructions, smoke tests, rollback plan for the rrule migration |

---

*Last updated: 2026-08-26*
*Document owner: Engineering Team*

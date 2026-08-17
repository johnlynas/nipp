# Interactive Calendar — Feature Planning & Development

> **Status: Implemented (August 2026).** This document started as the feature plan and has been
> updated to reflect the shipped implementation. See [Current Status](#current-status-as-of-august-2026)
> and [Known Gaps & Follow-ups](#11-known-gaps--follow-ups).

## 1. Overview

An interactive, multi-view calendar component for the Property NI portal that enables all user classes to view, create, edit, and manage organization-scoped calendar events. The calendar supports month, week, and day views with drag-and-drop rescheduling, event detail modals, quick-add via sidebar or right-click context menu, and recurring events (daily through annually).

The calendar is a **standalone shared component** (`components/calendar/`) usable across any organization context, with events scoped per `organizationId` at the data-model level (see [Known Gaps](#11-known-gaps--follow-ups) for the current state of service-level tenant isolation).

The calendar is integrated into the **Integrated Super Admin Dashboard** (`/dashboard/admin`) as a sidebar navigation item at `/dashboard/admin/calendar`.

### Current Status (as of August 2026)

- **Implemented & integrated**: live at `/dashboard/admin/calendar` (sidebar nav item with `CalendarDays` icon in `app/dashboard/admin/layout.tsx`); the page renders `<Calendar organizationId={...} />`.
- **Views**: month, week, day. The multi-year view from FR-1 is **not implemented** (deferred).
- **Recurring events**: fully supported end-to-end — `DAILY`, `WEEKLY`, `MONTHLY`, `QUARTERLY`, `SEMI_ANNUALLY`, `ANNUALLY` with interval, end-date and occurrence-count limits. Expansion is computed server-side; a frontend mirror exists in `calendar-utils.ts` for client-side merging.
- **Drag-and-drop rescheduling**: implemented (HTML5 drag events, persisted via PATCH).
- **Calendar notifications**: email notification service for today's events is implemented (`services/calendar-notification-service.ts` + `/calendar-notifications/*` routes).
- **Test coverage**: 113 calendar-specific tests (86 unit + 27 integration), all passing. Full suite green: 902 unit / 181 integration tests, `tsc --noEmit` clean, ESLint (`--max-warnings=0`) clean, production build succeeds.
- **Known gaps**: service-level org filtering for several event queries is incomplete (security-relevant — see §11).

---

## 2. Requirements Summary

### 2.1 Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| FR-1 | Month, Week, Day views with toggle navigation (multi-year deferred) | Must Have | ✅ month/week/day; multi-year not implemented |
| FR-2 | Color-coded event cards on calendar dates with type-specific icons | Must Have | ✅ |
| FR-3 | Upcoming Events sidebar that slides in/out to maximize screen real estate | Must Have | ✅ |
| FR-4 | Full CRUD for events (Create, Read, Update, Delete) | Must Have | ✅ |
| FR-5 | Drag-and-drop event rescheduling between dates | Should Have | ✅ (HTML5 DnD, persisted via PATCH) |
| FR-6 | Event detail modal with edit/delete capabilities | Must Have | ✅ (includes recurrence picker) |
| FR-7 | Quick Add via sidebar form and right-click context menu on calendar dates | Must Have | ✅ (quick-add form lives in the sidebar and context menu; no standalone `CalendarQuickAdd` component) |
| FR-8 | Multiple events per date, expandable/compressible display | Must Have | ✅ |
| FR-9 | Recurring events: weekly, monthly, quarterly, semi-annually, annually | Should Have | ✅ (also DAILY; interval + endDate/count limits) |
| FR-10 | Standalone reusable component in `components/calendar/` | Must Have | ✅ |
| FR-11 | Organization-scoped events via `organizationId` (tenant isolation) | Must Have | ⚠️ data model is org-scoped; service-level org filtering incomplete (see §11) |
| FR-12 | Integration into Integrated Super Admin Dashboard sidebar navigation | Should Have | ✅ (`/dashboard/admin/calendar`) |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Must use Property NI standard UI elements and color scheme (Navy `#1B2A4A`, Amber `#F5A623`) |
| NFR-2 | Must respect existing RBAC permissions (`calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete`) |
| NFR-3 | Must comply with tenant isolation (Prisma Extension + RLS) — **partially met, see §11** |
| NFR-4 | Must be fully tested: unit tests for services, API routes, and UI components — **unit + integration done; component tests deferred** |
| NFR-5 | Must follow existing service layer patterns (`ServiceContext`, typed errors, pagination) |
| NFR-6 | Must integrate with existing notification system (SSE) for event reminders — **email path implemented; SSE deferred** |

---

## 3. Data Model

### 3.1 Prisma Schema Changes (Implemented)

Three models were added to `prisma/schema.prisma` (the original draft anticipated two; recurrence is a separate 1:1 model):

- **`Calendar`** — container/namespace for events within an organization. Each org gets one default calendar at bootstrap (or on first event creation). Supports multiple calendars per org for future extensibility.
- **`CalendarEvent`** — individual calendar events, linked to a `Calendar`, scoped to an organization.
- **`CalendarRecurrence`** — recurrence rule, 1:1 with an event via `eventId @unique`.

> **Note:** the calendar schema was applied to dev/test databases with `prisma db push`; there is no
> calendar-specific migration file in `prisma/migrations/`.

### 3.2 Schema Definition (As Implemented)

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
 * Supports single-day, multi-day, and recurring events via CalendarRecurrence.
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

  recurrenceId String?
  recurrence   CalendarRecurrence? @relation

  propertyId String? // Optional property association (plain column, no FK relation yet)

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([organizationId, startDate]) // Efficient date range queries
  @@index([propertyId])                // Property-based event lookups (future scheduler)
}

/**
 * CalendarRecurrence — Recurrence rules for recurring calendar events.
 * Uses iCal-inspired fields: frequency, interval, endDate/count, byDay, byMonthDay.
 */
model CalendarRecurrence {
  id         String   @id @default(cuid())
  frequency  CalendarRecurrenceFrequency
  interval   Int      @default(1) // Every N frequency units (e.g., interval=2 with WEEKLY = every 2 weeks)
  endDate    DateTime? // Hard end date (mutually exclusive with count)
  count      Int?     // Max occurrence count (mutually exclusive with endDate)
  byDay      String?  // iCal-style by-day rules (e.g., "MO,WE,FR" for Mon/Wed/Fri)
  byMonthDay Int?     // Specific day of month for monthly recurrences (1-31)

  eventId    String   @unique
  event      CalendarEvent @relation(fields: [eventId], references: [id])

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([organizationId])
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

enum CalendarRecurrenceFrequency {
  DAILY
  WEEKLY
  MONTHLY
  QUARTERLY
  SEMI_ANNUALLY
  ANNUALLY
}
```

Differences from the original draft: `CalendarEvent` has no `createdBy` column; default
`eventType` is `OTHER`; the recurrence relation is 1:1 (`eventId @unique`) rather than a
many-to-one `events` list; the frequency enum uses `SEMI_ANNUALLY`/`ANNUALLY` (not `YEARLY`).

### 3.3 Permissions in the Permission Catalog (Implemented)

Seeded by `prisma/seed.ts` with `isDefault: true` (resource key is `calendars`):

| Permission Key | Resource | Action | Description |
|---------------|----------|--------|-------------|
| `calendar:read` | calendars | read | View calendar events |
| `calendar:create` | calendars | create | Create new calendar events |
| `calendar:update` | calendars | update | Edit existing calendar events |
| `calendar:delete` | calendars | delete | Delete calendar events |

### 3.4 Relationship Diagram

```
Organization <1:M--> Calendar <1:M--> CalendarEvent <1:1>--> CalendarRecurrence (eventId @unique)
                                                          |
                                                          +-- propertyId --> Property (plain column, no FK relation yet)
```

---

## 4. Component Architecture

### 4.1 Directory Structure (As Implemented)

```
components/calendar/
├── Calendar.tsx                  # Main container (view toggle, data fetching, DnD orchestration)
├── CalendarMonthView.tsx         # Month view grid renderer
├── CalendarWeekView.tsx          # Week view grid renderer
├── CalendarDayView.tsx           # Day view grid renderer
├── CalendarEventCard.tsx         # Individual event card (expandable/compressible)
├── CalendarEventModal.tsx        # Event detail/edit modal (includes recurrence picker)
├── CalendarSidebar.tsx           # Upcoming Events sidebar + Quick Add form (slide-in/out)
├── CalendarContextMenu.tsx       # Right-click context menu on dates (quick add)
├── CalendarRecurrencePicker.tsx  # Recurrence rule picker UI (frequency/interval/end)
├── calendar-utils.ts             # Date math, month grid generation, recurrence expansion (frontend mirror), formatting
└── types.ts                      # Shared TypeScript types

services/
├── calendar-service.ts               # Calendar CRUD + default-calendar bootstrapping
├── calendar-event-service.ts         # Event CRUD, recurrence expansion, upcoming events
└── calendar-notification-service.ts  # Today's-events email notifications

app/api/organizations/[orgId]/
├── calendar/route.ts                 # GET, POST calendars
├── calendar/[id]/route.ts            # GET, PATCH, DELETE calendar
├── calendar-events/route.ts          # GET (date range), POST events
├── calendar-events/[id]/route.ts     # GET, PATCH, DELETE event
├── calendar-events/upcoming/route.ts # GET upcoming events for sidebar
└── calendar-notifications/           # today / send-today / history

app/dashboard/admin/calendar/page.tsx # Dashboard page wiring <Calendar organizationId={...} />

tests/unit/
├── calendar-event-service.test.ts    # 45 tests (service CRUD, expansion, upcoming)
└── calendar-utils.test.ts            # 41 tests (date math, grids, frontend expansion)

tests/integration/
└── calendar-events.test.ts           # 27 tests (service-level against real DB)

prisma/seed.ts                        # Idempotent calendar seed data (ensureCalendar / ensureEvent / ensureRecurringEvent)
```

### 4.2 Integration Points

| Component | Integrates With | Purpose |
|-----------|----------------|---------|
| `Calendar` page + sidebar nav item | Integrated Super Admin Dashboard layout (`app/dashboard/admin/layout.tsx`) | Nav item with `<CalendarDays />` icon from lucide-react; page at `/dashboard/admin/calendar` |
| `CalendarEventCard` | Property NI design system | Navy/Amber color scheme, Tailwind CSS v4 classes |
| `CalendarEventModal` | Existing `<Modal>` component pattern | Reuses modal infrastructure from `components/dashboard/Modal.tsx` |
| Recurrence expansion | Server: `services/calendar-event-service.ts`; client mirror: `calendar-utils.ts` | Pure functions, no external dependencies; server-side expansion is authoritative for API responses |
| Notifications (implemented) | `services/calendar-notification-service.ts` + existing email dispatcher | Today's-events email notifications; SSE push is a future extension |

---

## 5. Service Layer Design (As Implemented)

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
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUALLY' | 'ANNUALLY';
    interval?: number;
    endDate?: Date;
    count?: number;
    byDay?: string | null;
    byMonthDay?: number | null;
  } | null;
}

export interface UpdateEventInput { /* same fields, all optional; recurrence: null clears the rule */ }
export interface GetEventsInput { startDate: Date; endDate: Date; calendarId?: string; }
export interface CalendarEventWithDetails { /* event fields + recurrence: CalendarEventRecurrenceDetails | null */ }

export const CalendarEventService = {
  createEvent,              // (ctx, input) — admin only; creates recurrence row + syncs event.recurrenceId
  getEvents,                // (ctx, input) — non-expanding; not used by routes (kept for completeness)
  getEventsWithRecurrences, // (ctx, input) — used by GET route; expands recurring series into instances
  getEventById,             // (ctx, eventId) — includes recurrence details
  updateEvent,              // (ctx, eventId, input) — admin only; in-place rule update / add / clear
  deleteEvent,              // (ctx, eventId) — admin only; deletes recurrence row first (FK Restrict)
  getUpcomingEvents,        // (ctx, orgId?, limit = 10) — single + recurring instances, deduped & sorted
};

/** Pure function (synchronous) — exported for reuse and unit testing. */
export function expandRecurrence(
  event: CalendarEventWithDetails,
  rangeStart: Date,
  rangeEnd: Date,
): CalendarEventWithDetails[];
```

### 5.3 Recurrence Expansion Logic (As Implemented)

`expandRecurrence` takes an event (with optional recurrence details) and returns all instances falling within the requested view range. Computed server-side so clients never receive raw recurrence rules for rendering.

**Algorithm:**
1. **Non-recurring events**: returned as-is (single instance) if they overlap the range; otherwise nothing.
2. **Recurring events**: iterate from the base event's `startDate`, advancing by frequency + interval (`advanceDate`), up to a hard cap of **52 × 12 occurrences** (~10 years) so open-ended series always terminate.
3. **Rule bounds**: stop when the rule's `endDate` is passed, or when the occurrence count reaches `count` (`count != null`; a `count` of 0 yields no occurrences).
4. **Duration preservation**: every instance keeps the base event's duration — `instanceEnd = instanceStart + (baseEnd − baseStart)`. This is what makes later occurrences visible in range queries.
5. **Range filter**: an instance is included only if it overlaps `[rangeStart, rangeEnd]`.

The `getEventsWithRecurrences` where-clause selects (a) non-recurring events overlapping the range, or (b) any recurring series that has started by the range end — expansion then applies the rule's own bounds.

### 5.4 Recurring Events — Implementation Notes

- **End-to-end flow**: `CalendarRecurrencePicker` (in the event modal) → POST/PATCH with a `recurrence` object → service creates/updates the `CalendarRecurrence` row and syncs the event's `recurrenceId` scalar → GET range queries return expanded instances.
- **Clearing a rule**: PATCH with `recurrence: null` deletes the recurrence row and nulls the scalar.
- **Frontend mirror**: `calendar-utils.ts` contains its own `expandRecurrence` plus `getEventInstanceKey` (`id + startDate`) used to dedupe/merge instances when navigating between views.
- **Legacy rows**: `prisma/seed.ts`'s `ensureRecurringEvent` does not set the event's `recurrenceId` scalar, so "legacy" rows (rule exists, scalar null) exist in dev databases. The service branches on the `recurrence` relation rather than the scalar, so legacy rows work; update/delete handle both shapes.
- **Bugs found & fixed during test development (August 2026)** — all covered by regression tests:
  1. Instance `endDate` was not shifted by the base duration → later occurrences were filtered out of every range query.
  2. `getEventsWithRecurrences` excluded recurring series whose base range didn't overlap the query window → now includes any active series started before range end.
  3. `createEvent` never persisted the event's `recurrenceId` scalar → now synced after rule creation.
  4. `getUpcomingEvents` used a no-op filter (`recurrenceId: { not: undefined }`) → non-recurring events were double-counted; now `recurrence: null` / `{ isNot: null }`.
  5. `generateMonthGrid` (frontend util) broke before pushing the last row, dropping a month's final day when it falls in week 5/6 (e.g. Aug 31). Fixed; note the month view itself uses `generateMonthDays`, so this only affected the exported API.

---

## 6. API Routes Design (As Implemented)

### 6.1 Calendar Endpoints

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar` | List all calendars for org (with event counts) | Tenant member |
| POST | `/api/organizations/[orgId]/calendar` | Create a new calendar | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar/[id]` | Get calendar by ID | Tenant member |
| PATCH | `/api/organizations/[orgId]/calendar/[id]` | Update calendar | Tenant admin + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar/[id]` | Delete calendar (cascades events) | Tenant admin + `calendar:delete` |

### 6.2 Calendar Event Endpoints

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-events` | Get events in date range — **returns expanded instances** for recurring series (query params: `start`, `end`) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-events` | Create a new event (optionally recurring) | Tenant member + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-events/[id]` | Get event by ID (includes recurrence details) | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar-events/[id]` | Update event (`recurrence: null` clears the rule) | Tenant member + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar-events/[id]` | Delete event (and its recurrence rule) | Tenant member + `calendar:delete` |
| GET | `/api/organizations/[orgId]/calendar-events/upcoming` | Get upcoming events for sidebar (single + recurring instances, deduped) | Tenant member + `calendar:read` |

Routes verify session (401), membership in the URL's organization (403), and derive `TENANT_ADMIN`/`MEMBER` from the member record before calling the service.

### 6.3 Query Parameters (Event List)

```
GET /api/organizations/[orgId]/calendar-events?start=2026-08-01&end=2026-08-31&calendarId=xxx
```

### 6.4 Calendar Notification Service (Implemented)

A dedicated notification service that enables the calendar to notify users or organizations about events happening today. Follows the existing notification patterns (`lib/notifications/dispatcher.ts`, `lib/notifications/email.ts`) as a proper service layer with REST endpoints, consistent with the `services/*-service.ts` pattern.

#### 6.4.1 Service Design (`services/calendar-notification-service.ts`)

```typescript
interface SendNotificationInput {
  userId?: string;        // Notify a specific user (optional)
  organizationId: string; // Notify all members of an org (required if userId not provided)
  eventIds: string[];     // Calendar events triggering the notification
  notifyType: 'TODAY_EVENTS' | 'UPCOMING_TODAY';
}

class CalendarNotificationService {
  /** Send notifications for events happening today (specific user or all org members). */
  static sendTodayEventNotifications(ctx: ServiceContext, input: SendNotificationInput): Promise<NotificationResult[]>;
  /** Get all events happening today for a given organization. */
  static getTodayEvents(ctx: ServiceContext, orgId: string): Promise<CalendarEvent[]>;
  /** Get all events happening today for a specific user within their org. */
  static getTodayEventsForUser(ctx: ServiceContext, userId: string): Promise<CalendarEvent[]>;
  /** Build notification message for today's events. */
  static buildTodayEventsMessage(events: CalendarEvent[], recipientName: string): { subject: string; html: string; text: string };
}
```

#### 6.4.2 Notification Flow

1. **Trigger**: A scheduled job (cron) or API call scans for events where `startDate` falls on the current date
2. **Recipient Resolution**: For each target (user or org), resolve all member emails from the `Member` model
3. **Message Generation**: Build a branded email using Property NI colors (Navy header, Amber accent bar)
4. **Dispatch**: Use the existing `dispatchNotification` from `lib/notifications/dispatcher.ts` for rate-limited email delivery
5. **Logging**: Log each notification to `NotificationLog` (existing model)
6. **SSE Broadcast** (optional future): Push a real-time notification via SSE to in-app notification center

#### 6.4.3 REST Endpoints (Implemented)

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-notifications/today` | Get today's events for the current user/org | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-notifications/send-today` | Trigger notifications for today's events (manual or scheduled) | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-notifications/history` | View notification delivery history (from NotificationLog) | Tenant admin |

#### 6.4.4 Integration with Existing Infrastructure

- **Email delivery**: Reuses `lib/notifications/email.ts` (`sendEmail`) and `lib/notifications/dispatcher.ts` (`dispatchNotification`, rate limiting)
- **Logging**: Writes to existing `NotificationLog` Prisma model
- **Rate limiting**: Uses the same Redis-based rate limiter (`NOTIFICATION_RATE_LIMIT`)
- **Branding**: Email templates use Property NI colors (Navy `#1B2A4A` header, Amber `#F5A623` accent bar)
- **SSE** (future): Can push to existing SSE notification system for in-app alerts

---

## 7. UI Design Details

### 7.1 Color Scheme (Property NI Standard)

| Element | Color | Usage |
|---------|-------|-------|
| Primary background | `#1B2A4A` (Navy) | Sidebar, headers |
| Accent / CTA | `#F5A623` (Amber) | Buttons, active states, highlights |
| Content background | `#f8f9fa` (Light) | Main content area |
| Card background | `#ffffff` (White) | Event cards, panels |
| Border | `#dee2e6` (Gray) | Subtle borders |

### 7.2 Event Type Icons (lucide-react)

| EventType | Icon | Default Color |
|-----------|------|---------------|
| VIEWING | `Home` | Teal (`#2A9D8F`) |
| INSPECTION | `ClipboardList` | Amber (`#F5A623`) |
| MAINTENANCE | `Wrench` | Orange (`#E76F51`) |
| LEASE_SIGNING | `FileText` | Navy (`#1B2A4A`) |
| LEASE_RENEWAL | `RefreshCw` | Purple (`#7B68AE`) |
| KEY_EXCHANGE | `Key` | Gold (`#D4A017`) |
| OTHER | `Calendar` | Gray (`#6C757D`) |

### 7.3 View Toggles (As Implemented)

- **Month**: Standard calendar grid (Sun–Sat), event cards with color coding
- **Week**: 7-column layout with hourly time slots
- **Day**: Single column with hourly time slots, detailed view
- **Multi-Year**: *not implemented* (deferred — see §11)

### 7.4 Sidebar Behavior

- Default state: **collapsed** (icon-only, width 64px)
- Expanded state: full sidebar with Upcoming Events list and Quick Add form (width 320px)
- Toggle button in sidebar header
- Smooth CSS transition (~200ms)

---

## 8. Testing Strategy (As Implemented)

### 8.1 Unit Tests (Implemented — Vitest, `@/lib/global-db` mocked)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/unit/calendar-event-service.test.ts` | 45 | `expandRecurrence` (all frequencies, intervals, endDate/count bounds, duration shift, 10-year cap), event CRUD with role checks (MEMBER forbidden on mutations), recurrence rule persistence/clearing incl. legacy rows, `getEventsWithRecurrences` query shape + expansion, `getUpcomingEvents` dedupe/sort/limit/validation |
| `tests/unit/calendar-utils.test.ts` | 41 | Date math (month grid generation, week boundaries), frontend recurrence expansion mirror, event instance keying, formatting |

Note: `calendar-service.ts` has no dedicated unit test file (gap — see §11).

### 8.2 Component Tests (Vitest + Testing Library) — *Deferred, not yet written*

| Planned Test File | Coverage |
|-----------|----------|
| `CalendarMonthView.test.tsx` | Grid rendering, event card display, view toggle |
| `CalendarEventCard.test.tsx` | Expand/collapse, icon rendering, color coding |
| `CalendarSidebar.test.tsx` | Slide in/out toggle, upcoming events list rendering |
| `CalendarEventModal.test.tsx` | Open/close, edit form validation, delete confirmation |
| `CalendarContextMenu.test.tsx` | Right-click trigger, quick-add form in context menu |

### 8.3 Integration Tests (Implemented — service-level against real PostgreSQL)

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `tests/integration/calendar-events.test.ts` | 27 | Service-level tests via `CalendarEventService` + mocked `ServiceContext` (no HTTP/auth layer, matching existing integration conventions). Org created per test in `beforeEach`, all orgs cleaned up in `afterAll`. Covers: createEvent (MEMBER forbidden; non-recurring → no rule row; recurring → `recurrenceId` scalar persisted [regression]; endDate+count stored), getEventsWithRecurrences (later occurrences of a May-started weekly series queried in August with shifted end dates [regression]; count limit; rule endDate bound; non-recurring in/out of range; sorting), getEventById (rule details / null / NotFoundError), updateEvent (in-place rule update without a second row [regression]; add rule + scalar sync; clear via `null` → row deleted + scalar nulled; legacy null-scalar rows [regression]; MEMBER forbidden), deleteEvent (recurring → both rows gone [regression: FK Restrict]; non-recurring; MEMBER forbidden; NotFoundError), getUpcomingEvents (mixed single+recurring: no duplicate instances by `id + start` key, sorted, limit; ValidationError without org), DB constraints (unique `eventId` violation; direct delete of event with recurrence throws Restrict) |

### 8.4 Isolation Tests — *No calendar-specific tests yet*

The generic app-layer isolation suite (`tests/isolation/application/`) covers the Prisma extension, tenant context propagation, and global-DB guard. Calendar models are **not** in the extension's `TENANT_SCOPED_MODELS` list, so calendar-specific isolation tests are blocked on the service-level org filtering work in §11.

### 8.5 Test Environment Notes & Results Snapshot (August 2026)

- **Timezone**: `tests/setup.ts` pins `process.env.TZ = 'UTC'` so `toISOString`-based assertions are deterministic regardless of the developer's local zone (verified: no pre-existing test depends on the local zone).
- **Results**: `npm test` → 48 files / 902 tests passing; `npm run test:integration` (integration + isolation) → 17 files / 181 tests passing; `npx tsc --noEmit` clean; `npx eslint . --max-warnings=0` clean; `npm run build` succeeds.
- **Seed data**: `prisma/seed.ts` seeds calendar data idempotently (`ensureCalendar` / `ensureEvent` / `ensureRecurringEvent`) for both dev and test profiles — Platform org default calendar; dev tenant: 5 events (today's inspection, tomorrow's viewing, weekly + monthly recurring series, 3-day maintenance window); test tenant: today's inspection + weekly recurring review. No seed changes were needed for the test suites (tests are self-contained).

---

## 9. Implementation Plan (Status)

### Phase 1: Foundation (Data + Services) — ✅ Complete
1. ✅ Prisma schema with `Calendar`, `CalendarEvent`, `CalendarRecurrence` models + enums (applied via `prisma db push`)
2. ✅ Schema pushed to dev/test databases (no calendar-specific migration file)
3. ✅ `CalendarService` with full CRUD + default calendar bootstrapping
4. ✅ `CalendarEventService` with CRUD, date range queries, recurrence expansion
5. ✅ Permission catalog entries for `calendar:*` permissions (seeded)
6. ✅ Seed data with test calendars and events

### Phase 2: API Routes — ✅ Complete
7. ✅ `/api/organizations/[orgId]/calendar` endpoints (CRUD)
8. ✅ `/api/organizations/[orgId]/calendar-events` endpoints (CRUD + upcoming)
9. ✅ Membership/role guards on all routes (RBAC permission enforcement per §11 follow-up)
10. ✅ API integration tests (`tests/integration/calendar-events.test.ts`)

### Phase 3: Calendar UI Components — ✅ Complete
11. ✅ `components/calendar/types.ts` and `calendar-utils.ts` (pure functions)
12. ✅ `CalendarMonthView.tsx` — core grid rendering with event cards
13. ✅ `CalendarWeekView.tsx` and `CalendarDayView.tsx`
14. ✅ `CalendarEventCard.tsx` — expandable/compressible event display
15. ✅ `CalendarSidebar.tsx` — slide-in/out upcoming events panel (quick-add form included)
16. ✅ `CalendarEventModal.tsx` — event detail/edit modal (with recurrence picker)
17. ✅ `CalendarContextMenu.tsx` — right-click quick add (no standalone `CalendarQuickAdd.tsx`; the form lives in sidebar + context menu)

### Phase 4: Integration & Polish — ✅ Complete
18. ✅ Calendar nav item in Integrated Super Admin Dashboard sidebar (`<CalendarDays />` icon)
19. ✅ Calendar page at `/dashboard/admin/calendar`
20. ✅ Drag-and-drop rescheduling (HTML5 drag events, persisted via PATCH)
21. ✅ Recurrence picker UI (`CalendarRecurrencePicker.tsx`)
22. ⏳ Component unit tests — deferred (see §8.2)
23. ✅ Full test suite, build, lint, type-check all green

**Deferred**: multi-year view (FR-1), component tests (§8.2), calendar-specific isolation tests (§8.4).

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Recurrence expansion performance for large date ranges | High | Limit expansion to view range only; hard cap of 52×12 occurrences per series; `organizationId + startDate` index for range queries |
| Drag-and-drop complexity with timezone handling | Medium | Use local datetime throughout (no TZ conversion); validate on server |
| Multi-event display clutter on busy dates | Medium | Implement expand/collapse; show "N more" overflow indicator |
| Calendar component reusability vs. dashboard coupling | Medium | Keep calendar as pure presentational + data-fetching component; pass data via props or SWR hooks |
| RLS policy performance on large event tables | Medium | Ensure `organizationId` index exists; test with realistic data volumes |
| Cross-tenant exposure via unfiltered service queries | High | **Open** — see §11; add org filters to event-service queries and register calendar models in the tenant extension |

---

## 11. Known Gaps & Follow-ups

1. **Service-level org isolation for event queries (security-relevant, open).**
   The calendar models are **not** in `TENANT_SCOPED_MODELS` (`lib/tenant-db.ts`), and the event service queries by `id` / `calendarId` without an `organizationId` filter:
   - `getEventsWithRecurrences` — no org filter (only optional `calendarId`)
   - `getEventById`, `updateEvent`, `deleteEvent` — lookup by `id` only
   - `getUpcomingEvents` — computes a target org id but never uses it in the queries
   Routes verify membership in the URL's organization, so a member of Org A could read or modify Org B events by supplying their IDs/calendarId. **Follow-up**: add `organizationId` filters to these queries (and/or register the calendar models in the tenant extension), then add calendar-specific isolation tests (§8.4).
2. **Multi-year view** (FR-1) not implemented — views are month/week/day only.
3. **Component-level tests** (§8.2) not yet written.
4. **No unit test file for `calendar-service.ts`** (event service + utils are covered).
5. **Seed legacy rows**: `ensureRecurringEvent` does not set the event's `recurrenceId` scalar. The service handles these rows (branches on the relation), but the seed helper should be updated to keep dev data consistent.
6. **`generateMonthGrid` is exported but unused** by any component (the month view uses `generateMonthDays`). Kept and tested as part of the exported API.
7. **`getEvents` (non-expanding) is unused by routes** — the GET route uses `getEventsWithRecurrences`. Kept for completeness.

---

## 12. Future Considerations (Out of Scope)

- **Scheduler integration**: Automated event creation from maintenance requests, lease events
- **Tenant-facing calendar**: Tenants viewing their own viewings/maintenance appointments
- **Calendar sharing between organizations** (cross-org collaboration)
- **Export to iCal/Google Calendar**
- **Timezone support**: Currently local datetime only; TZ support deferred to scheduler phase
- **Color theme customization per organization**

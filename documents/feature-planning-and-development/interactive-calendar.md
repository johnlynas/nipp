# Interactive Calendar — Feature Planning & Development

## 1. Overview

An interactive, multi-view calendar component for the Property NI portal that enables all user classes to view, create, edit, and manage organization-scoped calendar events. The calendar supports month, week, day, and multi-year views with drag-and-drop rescheduling, event detail modals, quick-add via sidebar or right-click context menu, and recurring events (weekly through annually).

The calendar is a **standalone shared component** (`components/calendar/`) usable across any organization context, with events scoped per `organizationId` via the existing tenant isolation strategy (Prisma Extension + PostgreSQL RLS).

Initially, the calendar will be integrated into the **Integrated Super Admin Dashboard** (`/dashboard/admin`) as a new sidebar navigation item.

---

## 2. Requirements Summary

### 2.1 Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1 | Month, Week, Day, and Multi-Year views with toggle navigation | Must Have |
| FR-2 | Color-coded event cards on calendar dates with type-specific icons | Must Have |
| FR-3 | Upcoming Events sidebar that slides in/out to maximize screen real estate | Must Have |
| FR-4 | Full CRUD for events (Create, Read, Update, Delete) | Must Have |
| FR-5 | Drag-and-drop event rescheduling between dates | Should Have |
| FR-6 | Event detail modal with edit/delete capabilities | Must Have |
| FR-7 | Quick Add via sidebar form and right-click context menu on calendar dates | Must Have |
| FR-8 | Multiple events per date, expandable/compressible display | Must Have |
| FR-9 | Recurring events: weekly, monthly, quarterly, semi-annually, annually | Should Have |
| FR-10 | Standalone reusable component in `components/calendar/` | Must Have |
| FR-11 | Organization-scoped events via `organizationId` (tenant isolation) | Must Have |
| FR-12 | Integration into Integrated Super Admin Dashboard sidebar navigation | Should Have |

### 2.2 Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Must use Property NI standard UI elements and color scheme (Navy `#1B2A4A`, Amber `#F5A623`) |
| NFR-2 | Must respect existing RBAC permissions (`calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete`) |
| NFR-3 | Must comply with tenant isolation (Prisma Extension + RLS) |
| NFR-4 | Must be fully tested: unit tests for services, API routes, and UI components |
| NFR-5 | Must follow existing service layer patterns (`ServiceContext`, typed errors, pagination) |
| NFR-6 | Must integrate with existing notification system (SSE) for event reminders |

---

## 3. Data Model

### 3.1 Prisma Schema Changes

Two new models are required:

#### `Calendar` (Organization-scoped)
- Acts as the container/namespace for events within an organization.
- Each organization gets one default calendar at bootstrap (or on first event creation).
- Supports multiple calendars per org for future extensibility (e.g., "Maintenance Calendar", "Lettings Calendar").

#### `CalendarEvent` (Organization-scoped)
- Represents individual calendar events.
- Linked to a `Calendar` via FK, and scoped to an organization.
- Supports recurrence rules for recurring events.

### 3.2 Schema Definition (Draft)

```prisma
/**
 * Calendar — Container for organization-scoped calendar events.
 * Each organization has at least one default calendar.
 */
model Calendar {
  id          String   @id @default(cuid())
  name        String   // e.g., "Main Calendar", "Maintenance Schedule"
  description String?
  isDefault   Boolean  @default(false)
  color       String   @default("#1B2A4A") // Default calendar color
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  events CalendarEvent[]

  @@unique([organizationId, name])
  @@index([organizationId])
}

/**
 * CalendarEvent — Individual calendar event within a calendar.
 * Supports single-day, multi-day, and recurring events.
 */
model CalendarEvent {
  id          String   @id @default(cuid())
  title       String   // Event title (e.g., "Property Viewing - 42 Oak Street")
  description String?
  
  // Date/time fields
  startDate   DateTime // Event start (local datetime, no timezone)
  endDate     DateTime // Event end (local datetime, no timezone)
  
  // Recurrence
  recurrence  CalendarRecurrence? @relation(fields: [recurrenceId], references: [id])
  recurrenceId String? @map("recurrence_id")

  // Event type with icon mapping
  eventType   CalendarEventType @default(VIEWING)

  // Visual customization (per-event override of calendar color)
  color       String? @default(null) // Hex color, overrides calendar default

  // Associations
  calendarId  String @map("calendar_id")
  calendar    Calendar @relation(fields: [calendarId], references: [id], onDelete: Cascade)

  // Optional property association
  propertyId  String? @map("property_id")
  
  // Organizer/creator tracking
  createdBy   String @map("created_by")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([calendarId, startDate])
  @@index([organizationId, startDate])
  @@index([propertyId])
}

/**
 * CalendarRecurrence — Defines recurring event patterns.
 */
model CalendarRecurrence {
  id          String   @id @default(cuid())
  frequency   CalendarRecurrenceFrequency // DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY
  interval    Int      @default(1) // Every N frequency units (e.g., every 2 weeks)
  endDate     DateTime? // Recurrence end date (null = indefinite)
  count       Int?      // Max occurrences (alternative to endDate)
  byDay       String?   // e.g., "MO,WE,FR" for by-day rules (iCal-style)
  byMonthDay  Int?      // Day of month for monthly recurrences (1-31)
  
  events      CalendarEvent[]

  createdAt   DateTime @default(now())
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

### 3.3 Enums to Add to Permission Catalog

| Permission Key | Resource | Action | Description |
|---------------|----------|--------|-------------|
| `calendar:read` | calendar | read | View calendar events |
| `calendar:create` | calendar | create | Create new calendar events |
| `calendar:update` | calendar | update | Edit existing calendar events |
| `calendar:delete` | calendar | delete | Delete calendar events |

### 3.4 Relationship Diagram

```
Organization <1:M--> Calendar <1:M--> CalendarEvent <1:0..1--> CalendarRecurrence
                                                          |
                                                          +-- propertyId --> Property (optional, nullable FK)
```

---

## 4. Component Architecture

### 4.1 Directory Structure

```
components/calendar/
├── Calendar.tsx              # Main calendar container (view toggle, grid)
├── CalendarMonthView.tsx     # Month view grid renderer
├── CalendarWeekView.tsx      # Week view grid renderer
├── CalendarDayView.tsx       # Day view grid renderer
├── CalendarEventCard.tsx     # Individual event card (expandable/compressible)
├── CalendarEventModal.tsx    # Event detail/edit modal
├── CalendarSidebar.tsx       # Upcoming Events sidebar (slide-in/out)
├── CalendarQuickAdd.tsx      # Quick Add form component
├── CalendarContextMenu.tsx   # Right-click context menu on dates
├── CalendarRecurrencePicker.tsx  # Recurrence rule picker UI
├── calendar-utils.ts         # Date math, recurrence expansion, formatting
└── types.ts                  # Shared TypeScript types

services/
├── calendar-service.ts       # Calendar CRUD service
└── calendar-event-service.ts # CalendarEvent CRUD + recurrence service

app/api/organizations/[orgId]/
├── calendar/route.ts         # Calendar CRUD endpoints
└── calendar-events/
    └── route.ts              # Event CRUD + recurrence endpoints

tests/unit/
├── calendar-service.test.ts
├── calendar-event-service.test.ts
└── calendar-utils.test.ts

prisma/seed.ts                  # Updated with calendar + event seed data
```

### 4.2 Integration Points

| Component | Integrates With | Purpose |
|-----------|----------------|---------|
| `CalendarSidebar` | Integrated Super Admin Dashboard layout | New nav item with `<CalendarDays />` icon from lucide-react |
| `CalendarEventCard` | Property NI design system | Navy/Amber color scheme, Tailwind CSS v4 classes |
| `CalendarEventModal` | Existing `<Modal>` component pattern | Reuses modal infrastructure from `components/dashboard/Modal.tsx` |
| Recurrence expansion | `calendar-utils.ts` | Pure functions, no external dependencies |
| Notifications (future) | SSE notification system | Event reminder triggers |

---

## 5. Service Layer Design

### 5.1 CalendarService (`services/calendar-service.ts`)

```typescript
interface CreateCalendarInput {
  name: string;
  description?: string | null;
  color?: string;
}

interface UpdateCalendarInput {
  name?: string;
  description?: string | null;
  color?: string;
}

class CalendarService {
  static createCalendar(ctx: ServiceContext, input: CreateCalendarInput): Promise<Calendar>;
  static getCalendars(ctx: ServiceContext, orgId: string): Promise<Calendar[]>;
  static getCalendarById(ctx: ServiceContext, id: string): Promise<Calendar>;
  static updateCalendar(ctx: ServiceContext, id: string, input: UpdateCalendarInput): Promise<Calendar>;
  static deleteCalendar(ctx: ServiceContext, id: string): Promise<void>;
  static getDefaultCalendar(ctx: ServiceContext, orgId: string): Promise<Calendar | null>;
  static ensureDefaultCalendar(ctx: ServiceContext, orgId: string): Promise<Calendar>;
}
```

### 5.2 CalendarEventService (`services/calendar-event-service.ts`)

```typescript
interface CreateCalendarEventInput {
  title: string;
  description?: string | null;
  startDate: Date;
  endDate: Date;
  calendarId: string;
  eventType?: CalendarEventType;
  color?: string | null;
  propertyId?: string | null;
  recurrence?: {
    frequency: CalendarRecurrenceFrequency;
    interval?: number;
    endDate?: Date;
    count?: number;
    byDay?: string;
    byMonthDay?: number;
  };
}

interface UpdateCalendarEventInput {
  title?: string;
  description?: string | null;
  startDate?: Date;
  endDate?: Date;
  calendarId?: string;
  eventType?: CalendarEventType;
  color?: string | null;
  propertyId?: string | null;
  recurrence?: { ... } | null; // null = remove recurrence
}

interface CalendarEventQuery {
  startDate: Date;   // Start of view range (inclusive)
  endDate: Date;     // End of view range (inclusive)
  calendarId?: string;
}

class CalendarEventService {
  static createEvent(ctx: ServiceContext, input: CreateCalendarEventInput): Promise<CalendarEvent>;
  static getEvents(ctx: ServiceContext, query: CalendarEventQuery): Promise<CalendarEvent[]>;
  static getEventsWithRecurrences(ctx: ServiceContext, query: CalendarEventQuery): Promise<CalendarEvent[]>;
  static getEventById(ctx: ServiceContext, id: string): Promise<CalendarEvent>;
  static updateEvent(ctx: ServiceContext, id: string, input: UpdateCalendarEventInput): Promise<CalendarEvent>;
  static deleteEvent(ctx: ServiceContext, id: string): Promise<void>;
  static expandRecurrence(instance: CalendarEvent, viewStart: Date, viewEnd: Date): Promise<CalendarEvent[]>;
  static getUpcomingEvents(ctx: ServiceContext, orgId: string, limit?: number): Promise<CalendarEvent[]>;
}
```

### 5.3 Recurrence Expansion Logic

The `expandRecurrence` function takes a recurring event and returns all instances falling within the requested view range. This is computed server-side to avoid sending recurrence rules to the client.

**Algorithm:**
1. Start from `startDate` of the base event
2. Apply frequency + interval to generate next occurrence
3. Continue until `endDate` of view range or recurrence limit reached
4. Return array of expanded event instances (each with original `id` + instance-specific dates)

---

## 6. API Routes Design

### 6.1 Calendar Endpoints

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar` | List all calendars for org | Tenant member |
| POST | `/api/organizations/[orgId]/calendar` | Create a new calendar | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar/[id]` | Get calendar by ID | Tenant member |
| PATCH | `/api/organizations/[orgId]/calendar/[id]` | Update calendar | Tenant admin + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar/[id]` | Delete calendar (cascades events) | Tenant admin + `calendar:delete` |

### 6.2 Calendar Event Endpoints

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-events` | Get events in date range (query params: `start`, `end`) | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-events` | Create a new event | Tenant member + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-events/[id]` | Get event by ID | Tenant member + `calendar:read` |
| PATCH | `/api/organizations/[orgId]/calendar-events/[id]` | Update event | Tenant member + `calendar:update` |
| DELETE | `/api/organizations/[orgId]/calendar-events/[id]` | Delete event | Tenant member + `calendar:delete` |
| GET | `/api/organizations/[orgId]/calendar-events/upcoming` | Get upcoming events for sidebar | Tenant member + `calendar:read` |

### 6.3 Query Parameters (Event List)

```
GET /api/organizations/[orgId]/calendar-events?start=2026-08-01&end=2026-08-31&calendarId=xxx
```

---

## 6.4 Calendar Notification Service

A dedicated notification service that enables the calendar to notify users or organizations about events happening today. This service follows the existing notification patterns (`lib/notifications/dispatcher.ts`, `lib/notifications/email.ts`) but is structured as a proper service layer with REST endpoints, consistent with the `services/*-service.ts` pattern.

### 6.4.1 Service Design (`services/calendar-notification-service.ts`)

```typescript
interface SendNotificationInput {
  userId?: string;        // Notify a specific user (optional)
  organizationId: string; // Notify all members of an org (required if userId not provided)
  eventIds: string[];     // Calendar events triggering the notification
  notifyType: 'TODAY_EVENTS' | 'UPCOMING_TODAY';
}

interface NotificationRecipient {
  email: string;
  name: string;
  userId: string;
}

class CalendarNotificationService {
  /**
   * Send notifications for events happening today.
   * Notifies either a specific user or all org members.
   */
  static sendTodayEventNotifications(
    ctx: ServiceContext,
    input: SendNotificationInput
  ): Promise<NotificationResult[]>;

  /**
   * Get all events happening today for a given organization.
   */
  static getTodayEvents(
    ctx: ServiceContext,
    orgId: string
  ): Promise<CalendarEvent[]>;

  /**
   * Get all events happening today for a specific user within their org.
   */
  static getTodayEventsForUser(
    ctx: ServiceContext,
    userId: string
  ): Promise<CalendarEvent[]>;

  /**
   * Build notification message for today's events.
   */
  static buildTodayEventsMessage(
    events: CalendarEvent[],
    recipientName: string
  ): { subject: string; html: string; text: string };
}
```

### 6.4.2 Notification Flow

1. **Trigger**: A scheduled job (cron) or API call scans for events where `startDate` falls on the current date
2. **Recipient Resolution**: For each target (user or org), resolve all member emails from the `Member` model
3. **Message Generation**: Build a branded email using Property NI colors (Navy header, Amber accent bar)
4. **Dispatch**: Use the existing `dispatchNotification` from `lib/notifications/dispatcher.ts` for rate-limited email delivery
5. **Logging**: Log each notification to `NotificationLog` (existing model)
6. **SSE Broadcast** (optional future): Push a real-time notification via SSE to in-app notification center

### 6.4.3 REST Endpoints

| Method | Route | Description | Auth |
|--------|-------|-------------|------|
| GET | `/api/organizations/[orgId]/calendar-notifications/today` | Get today's events for the current user/org | Tenant member + `calendar:read` |
| POST | `/api/organizations/[orgId]/calendar-notifications/send-today` | Trigger notifications for today's events (manual or scheduled) | Tenant admin + `calendar:create` |
| GET | `/api/organizations/[orgId]/calendar-notifications/history` | View notification delivery history (from NotificationLog) | Tenant admin |

### 6.4.4 Integration with Existing Infrastructure

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

### 7.3 View Toggles

- **Month**: Standard calendar grid (Sun-Sat), event cards with color coding
- **Week**: 7-column layout with hourly time slots
- **Day**: Single column with hourly time slots, detailed view
- **Multi-Year**: Year grid (12 months) for navigation; same as month but with year selector

### 7.4 Sidebar Behavior

- Default state: **collapsed** (icon-only, width 64px)
- Expanded state: full sidebar with Upcoming Events list and Quick Add form (width 320px)
- Toggle button in sidebar header
- Smooth CSS transition (~200ms)

---

## 8. Testing Strategy

### 8.1 Unit Tests

| Test File | Coverage |
|-----------|----------|
| `calendar-service.test.ts` | Calendar CRUD, default calendar creation, authorization checks |
| `calendar-event-service.test.ts` | Event CRUD, recurrence expansion, date range queries, authorization |
| `calendar-utils.test.ts` | Date math (month grid generation, week boundaries), recurrence expansion logic, event type color/icon mapping |

### 8.2 Component Tests (Vitest + Testing Library)

| Test File | Coverage |
|-----------|----------|
| `CalendarMonthView.test.tsx` | Grid rendering, event card display, view toggle |
| `CalendarEventCard.test.tsx` | Expand/collapse, icon rendering, color coding |
| `CalendarSidebar.test.tsx` | Slide in/out toggle, upcoming events list rendering |
| `CalendarEventModal.test.tsx` | Open/close, edit form validation, delete confirmation |
| `CalendarContextMenu.test.tsx` | Right-click trigger, quick-add form in context menu |

### 8.3 Integration Tests

| Test File | Coverage |
|-----------|----------|
| `calendar-api.test.ts` | Full CRUD flow via API routes, tenant isolation verification |
| `calendar-recurrence.test.ts` | Recurring event creation, expansion across view ranges |

### 8.4 Isolation Tests

| Test File | Coverage |
|-----------|----------|
| `calendar-isolation.test.ts` | Events from Org A are not visible to Org B (RLS + Prisma Extension) |

---

## 9. Implementation Plan

### Phase 1: Foundation (Data + Services)
1. Update Prisma schema with `Calendar`, `CalendarEvent`, `CalendarRecurrence` models + enums
2. Run Prisma migration (`prisma migrate dev`)
3. Implement `CalendarService` with full CRUD + default calendar bootstrapping
4. Implement `CalendarEventService` with CRUD, date range queries, recurrence expansion
5. Add permission catalog entries for `calendar:*` permissions
6. Update seed data with test calendars and events

### Phase 2: API Routes
7. Create `/api/organizations/[orgId]/calendar` endpoints (CRUD)
8. Create `/api/organizations/[orgId]/calendar-events` endpoints (CRUD + upcoming)
9. Add RBAC guards to all routes
10. Write API integration tests

### Phase 3: Calendar UI Components
11. Create `components/calendar/types.ts` and `calendar-utils.ts` (pure functions)
12. Build `CalendarMonthView.tsx` — core grid rendering with event cards
13. Build `CalendarWeekView.tsx` and `CalendarDayView.tsx`
14. Build `CalendarEventCard.tsx` — expandable/compressible event display
15. Build `CalendarSidebar.tsx` — slide-in/out upcoming events panel
16. Build `CalendarEventModal.tsx` — event detail/edit modal
17. Build `CalendarQuickAdd.tsx` and `CalendarContextMenu.tsx`

### Phase 4: Integration & Polish
18. Add Calendar nav item to Integrated Super Admin Dashboard sidebar (with `<CalendarDays />` icon)
19. Wire up calendar page at `/dashboard/admin/calendar`
20. Implement drag-and-drop rescheduling (HTML5 DnD or pointer events)
21. Add recurrence picker UI (`CalendarRecurrencePicker.tsx`)
22. Write component unit tests
23. Run full test suite, build, lint, type-check

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Recurrence expansion performance for large date ranges | High | Limit expansion to view range only; paginate results; cache expanded instances |
| Drag-and-drop complexity with timezone handling | Medium | Use local datetime throughout (no TZ conversion); validate on server |
| Multi-event display clutter on busy dates | Medium | Implement expand/collapse; show "N more" overflow indicator |
| Calendar component reusability vs. dashboard coupling | Medium | Keep calendar as pure presentational + data-fetching component; pass data via props or SWR hooks |
| RLS policy performance on large event tables | Medium | Ensure `organizationId` index exists; test with realistic data volumes |

---

## 11. Future Considerations (Out of Scope)

- **Scheduler integration**: Automated event creation from maintenance requests, lease events
- **Tenant-facing calendar**: Tenants viewing their own viewings/maintenance appointments
- **Calendar sharing between organizations** (cross-org collaboration)
- **Export to iCal/Google Calendar**
- **Timezone support**: Currently local datetime only; TZ support deferred to scheduler phase
- **Color theme customization per organization**

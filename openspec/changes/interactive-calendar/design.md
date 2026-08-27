# Design: Interactive Calendar

## 1. Architecture Overview

The interactive calendar follows the existing Property NI architecture patterns:

```
┌─────────────────────────────────────────────────────┐
│  Integrated Super Admin Dashboard                    │
│  ┌──────────┐  ┌─────────────────────────────────┐  │
│  │ Sidebar   │  │  Calendar Page                  │  │
│  │           │  │  ┌───────────────────────────┐  │  │
│  │ 📅 Calendar◄──│  │  Calendar (Month/Week/Day)   │  │  │
│  │           │  │  │                           │  │  │
│  │ 👤 Users   │  │  │ ┌─────┐ ┌─────┐ ┌─────┐  │  │  │
│  │ 🏢 Orgs    │  │  │ │ 1   │ │ 2   │ │ 3   │ ...│  │  │
│  │ 👥 Teams   │  │  │ ├─────┤ ├─────┤ ├─────┤  │  │  │
│  │ 🛡️ Roles   │  │  │ │📅EVT│ │     │ │🏠VW │  │  │  │
│  │ 🔑 Perms   │  │  │ ├─────┤ ├─────┤ ├─────┤  │  │  │
│  └──────────┘  │  │ │ ... │ │...  │ │     │  │  │  │
│                │  │  └─────┴─┴─────┴─┴─────┘  │  │  │
│                │  │  ┌───────────────────────┐  │  │  │
│                │  │  │ Sidebar: Upcoming +    │  │  │  │
│                │  │  │ Quick Add              │  │  │  │
│                │  │  └───────────────────────┘  │  │  │
│                │  └───────────────────────────┘  │  │
│                └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘

                    ↓ API Calls

┌─────────────────────────────────────────────────────┐
│  API Routes                                          │
│  /api/organizations/[orgId]/calendar/*              │
│  /api/organizations/[orgId]/calendar-events/*       │
└─────────────────────────────────────────────────────┘

                    ↓ Service Layer

┌─────────────────────────────────────────────────────┐
│  Services                                            │
│  CalendarService                                     │
│  CalendarEventService                                │
└─────────────────────────────────────────────────────┘

                    ↓ Database (RLS enforced)

┌─────────────────────────────────────────────────────┐
│  PostgreSQL                                          │
│  Calendar (org-scoped)                               │
│  CalendarEvent (org-scoped, FK→Calendar)             │
│  CalendarRecurrence (org-scoped, FK→CalendarEvent)   │
└─────────────────────────────────────────────────────┘
```

## 2. Data Model Design

### Calendar Model

The `Calendar` model acts as a container/namespace for events within an organization. Each org gets one default calendar at bootstrap. The design supports multiple calendars per org for future extensibility (e.g., "Maintenance Calendar", "Lettings Calendar").

**Key design decisions:**
- `isDefault` flag ensures exactly one default calendar per org for backward compatibility
- `color` field provides a default color theme; individual events can override with their own `color`
- Unique constraint on `(organizationId, name)` prevents duplicate calendar names within an org

### CalendarEvent Model

The `CalendarEvent` model represents individual events. Key design decisions:

- **Local datetime**: `startDate` and `endDate` are stored as local datetimes (no timezone). This simplifies the initial implementation; timezone support is deferred to the scheduler phase.
- **Optional property association**: `propertyId` is nullable, allowing events that aren't tied to a specific property (e.g., general meetings).
- **Recurrence via separate model**: Recurrence rules are stored in a separate `CalendarRecurrence` model to avoid denormalization and allow multiple events to share the same recurrence rule.
- **Event type enum**: `CalendarEventType` provides a fixed set of types with associated icons and default colors.

### CalendarRecurrence Model

The `CalendarRecurrence` model stores recurrence rules using iCal-inspired fields:
- `frequency`: The base frequency (DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI_ANNUALLY, ANNUALLY)
- `interval`: Every N frequency units (e.g., interval=2 with WEEKLY = every 2 weeks)
- `endDate` or `count`: Either a hard end date or max occurrence count (mutually exclusive)
- `byDay`: iCal-style by-day rules (e.g., "MO,WE,FR" for weekly recurrence on Mon/Wed/Fri)
- `byMonthDay`: Specific day of month for monthly recurrences (1-31)

### Recurrence Expansion Strategy

Recurrence expansion is performed **server-side** in `CalendarEventService.expandRecurrence()`. The function:

1. Takes a recurring event and a date range (view start/end)
2. Iteratively generates occurrences by applying the frequency + interval
3. Stops when past the view end date or recurrence limit is reached
4. Returns an array of expanded event instances, each with the original `id` plus instance-specific dates

This approach keeps the client simple — it receives flat event instances, not recurrence rules. The expansion is cached via Redis for frequently accessed date ranges.

## 3. Component Design

### Calendar (Main Container)

```
Calendar
├── ViewToggle (Month | Week | Day | Today + prev/next)
├── CalendarGrid (delegates to MonthView / WeekView / DayView)
│   ├── DateCells (7 columns for month/week, 1 for day)
│   │   └── EventCards (one per event on that date)
│   │       ├── CalendarEventCard (expandable/compressible)
│   │       └── Overflow indicator ("N more")
├── CalendarSidebar (slide-in/out)
│   ├── UpcomingEventsList
│   └── QuickAddForm
├── CalendarEventModal (overlay, shown on event click)
└── CalendarContextMenu (right-click overlay on dates)
```

### State Management

The calendar uses React `useState` for local UI state (current view, selected date, sidebar open/closed) and direct API calls (or SWR hooks) for data fetching. No global state management is needed — the calendar is self-contained.

### Drag-and-Drop Implementation

HTML5 native drag-and-drop API:
- Event cards are `draggable`
- Date cells are drop targets with visual feedback (highlight on hover)
- On drop, the event's `startDate` and `endDate` are updated via PATCH API
- The calendar grid re-renders with the new data

### Sidebar Slide Behavior

The sidebar uses CSS transitions for smooth slide-in/out:
- Collapsed state: `width: 64px` (icon-only, minimal)
- Expanded state: `width: 320px` (full sidebar with events list and quick add)
- Transition duration: 200ms, ease-in-out

## 4. API Design

### Request/Response Patterns

All endpoints follow the existing Property NI patterns:
- Authenticated via BetterAuth session cookie
- Org-scoped via `[orgId]` in URL path (enforced by Prisma Extension + RLS)
- JSON request/response bodies with Zod validation on inputs
- Standard error responses: `{ error: string }` with appropriate HTTP status codes

### Event List Query Parameters

```
GET /api/organizations/[orgId]/calendar-events?start=2026-08-01T00:00&end=2026-08-31T23:59&calendarId=xxx
```

Response includes expanded recurring event instances within the date range. The `start` and `end` parameters define the view window for which events should be returned.

### Pagination

For the upcoming events sidebar, a `limit` parameter (default 10) controls how many events are returned. For the main calendar grid, all events in the view range are returned (no pagination needed for typical month/week/day views).

## 5. Security & Isolation

### Tenant Isolation

- All `Calendar` and `CalendarEvent` queries include `organizationId` filter
- Prisma Extension (`lib/tenant-db.ts`) automatically adds the filter at the query level
- PostgreSQL RLS policies enforce isolation at the database level (defense-in-depth)

### RBAC Enforcement

Each API route checks the user's permissions against the new `calendar:*` permission catalog:
- `calendar:read` — required for all GET endpoints
- `calendar:create` — required for POST endpoints
- `calendar:update` — required for PATCH endpoints
- `calendar:delete` — required for DELETE endpoints

Permission checks follow the existing pattern in `lib/authz-route.ts`.

### Input Validation

All API inputs are validated using Zod schemas defined in `lib/schemas/calendar.ts`. Invalid inputs return 400 with descriptive error messages.

## 6. Testing Strategy

### Unit Tests
- **Service layer**: Mock `globalDb` to test CRUD operations, authorization checks, and error handling
- **Utility functions**: Pure function tests for date math, recurrence expansion, icon/color mapping
- **UI components**: Testing Library tests for rendering, user interactions (clicks, drags), and state changes

### Integration Tests
- **API routes**: Full CRUD flow via HTTP, verifying correct status codes and response bodies
- **Recurrence expansion**: Create recurring events, verify expanded instances match expected dates

### Isolation Tests
- **Tenant isolation**: Create events in Org A, verify they are not returned when querying from Org B context

## 6. Calendar Notification Service Design

### 6.1 Architecture

The calendar notification service sits between the calendar event data and the existing email dispatch infrastructure:

```
┌──────────────────────────────────────┐
│  Calendar Event Service               │
│  (getTodayEvents, getTodayEventsForUser)│
└──────────┬───────────────────────────┘
           │ CalendarEvent[]
           ▼
┌──────────────────────────────────────┐
│  CalendarNotificationService          │
│                                      │
│  buildTodayEventsMessage()           │
│  sendTodayEventNotifications()       │
│    ├─ resolveRecipients()            │
│    ├─ buildEmailTemplate()           │
│    └─ dispatchNotification()         │
└──────────┬───────────────────────────┘
           │ Email + metadata
           ▼
┌──────────────────────────────────────┐
│  lib/notifications/dispatcher.ts      │
│  (rate limiting via Redis)           │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  lib/notifications/email.ts           │
│  (nodemailer, Property NI branding)  │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  SMTP Server                          │
│                                      │
│  + NotificationLog (Prisma)          │
└──────────────────────────────────────┘
```

### 6.2 Recipient Resolution

When notifying an organization, the service resolves all members from the `Member` model scoped to that organization:

```typescript
const recipients = await globalDb.member.findMany({
  where: { organizationId: orgId },
  include: { user: true },
});
```

Each recipient's email comes from the associated `User` model. The service sends one notification per recipient (with rate limiting applied individually).

### 6.3 Email Template

The notification email uses the same Property NI branding as the existing `lib/notifications/email.ts`:
- Navy (`#1B2A4A`) header with "Property NI — Today's Events"
- White body with event list (title, time, type icon/color)
- Amber (`#F5A623`) accent bar
- Gray footer with automated notification disclaimer

### 6.4 Rate Limiting

The existing `NOTIFICATION_RATE_LIMIT` (max 5 per event type per 24h) applies to calendar notifications. The rate limit key is `notif:rate:TODAY_EVENTS:{recipientEmail}`.

### 6.5 Logging

Each notification is logged to the existing `NotificationLog` model with:
- `recipientEmail`: The recipient's email
- `eventType`: "TODAY_EVENTS"
- `message`: Summary of events being notified about
- `status`: "SENT" or "FAILED"
- `organizationId`: The org context

---

## 7. Performance Considerations

### Recurrence Expansion
- Expansion is limited to the requested view range only (not expanded globally)
- Results are cached in Redis with a short TTL (5 minutes, matching existing permission cache pattern)
- For very large recurrence sets (e.g., annual events spanning 10+ years), the expansion is capped at a reasonable limit (e.g., 52 occurrences)

### Calendar Grid Rendering
- Month view: ~42 date cells maximum, each with a small event array — no performance concerns
- Week/Day views: Similar scale, hourly slots are rendered as static grid cells

### Database Indexes
- `CalendarEvent` has composite index on `(organizationId, startDate)` for efficient date range queries
- `CalendarEvent` has index on `propertyId` for property-based event lookups (future scheduler integration)
- `Calendar` has index on `organizationId` for org-scoped calendar lookups

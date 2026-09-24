# Tasks: Interactive Calendar

## Phase 1: Foundation — Data Model & Services (Estimated: 8 hours)

### Task 1.1: Update Prisma Schema
- [ ] Add `Calendar`, `CalendarEvent`, `CalendarRecurrence` models to `prisma/schema.prisma`
- [ ] Add enums: `CalendarEventType`, `CalendarRecurrenceFrequency`
- [ ] Ensure all models include `organizationId` with proper relation and index
- [ ] Run `prisma migrate dev` to create migration
- [ ] Run `prisma generate` to regenerate client

### Task 1.2: Add Permission Catalog Entries
- [ ] Add `calendar:read`, `calendar:create`, `calendar:update`, `calendar:delete` to seed permissions
- [ ] Add "calendars" resource entry to Resource catalog in seed

### Task 1.3: Implement CalendarService
- [ ] Create `services/calendar-service.ts`
- [ ] Implement `createCalendar`, `getCalendars`, `getCalendarById`, `updateCalendar`, `deleteCalendar`
- [ ] Implement `getDefaultCalendar` and `ensureDefaultCalendar` (bootstrapping)
- [ ] Add authorization checks using `ServiceContext`
- [ ] Write unit tests: `tests/unit/calendar-service.test.ts`

### Task 1.4: Implement CalendarEventService
- [ ] Create `services/calendar-event-service.ts`
- [ ] Implement `createEvent`, `getEvents`, `getEventById`, `updateEvent`, `deleteEvent`
- [ ] Implement `expandRecurrence` — server-side recurrence expansion within date range
- [ ] Implement `getUpcomingEvents` for sidebar display
- [ ] Add authorization checks using `ServiceContext`
- [ ] Write unit tests: `tests/unit/calendar-event-service.test.ts`

### Task 1.5: Implement Calendar Utility Functions
- [ ] Create `components/calendar/calendar-utils.ts`
- [ ] Implement date grid generation (month, week boundaries)
- [ ] Implement recurrence expansion logic (pure functions)
- [ ] Implement event type to icon/color mapping
- [ ] Write unit tests: `tests/unit/calendar-utils.test.ts`

## Phase 2: API Routes (Estimated: 6 hours)

### Task 2.1: Calendar CRUD Endpoints
- [ ] Create `app/api/organizations/[orgId]/calendar/route.ts`
- [ ] Implement GET (list calendars), POST (create calendar)
- [ ] Create `app/api/organizations/[orgId]/calendar/[id]/route.ts`
- [ ] Implement GET (get calendar), PATCH (update), DELETE (delete)
- [ ] Add RBAC guards for all endpoints

### Task 2.2: Calendar Event CRUD Endpoints
- [ ] Create `app/api/organizations/[orgId]/calendar-events/route.ts`
- [ ] Implement GET (list events with date range query params), POST (create event)
- [ ] Create `app/api/organizations/[orgId]/calendar-events/[id]/route.ts`
- [ ] Implement GET (get event), PATCH (update), DELETE (delete)
- [ ] Create `app/api/organizations/[orgId]/calendar-events/upcoming/route.ts`
- [ ] Implement GET (upcoming events for sidebar)
- [ ] Add RBAC guards for all endpoints

### Task 2.3: Calendar Notification Service
- [ ] Create `services/calendar-notification-service.ts`
- [ ] Implement `getTodayEvents` — query events where startDate falls on current date
- [ ] Implement `getTodayEventsForUser` — query events for a specific user within their org
- [ ] Implement `buildTodayEventsMessage` — build branded email (Navy header, Amber accent)
- [ ] Implement `sendTodayEventNotifications` — resolve recipients, dispatch via existing dispatcher, log to NotificationLog
- [ ] Add authorization checks using ServiceContext
- [ ] Write unit tests: `tests/unit/calendar-notification-service.test.ts`

### Task 2.4: Calendar Notification REST Endpoints
- [ ] Create `app/api/organizations/[orgId]/calendar-notifications/today/route.ts`
- [ ] Implement GET (today's events for current user/org)
- [ ] Create `app/api/organizations/[orgId]/calendar-notifications/send-today/route.ts`
- [ ] Implement POST (trigger notifications for today's events)
- [ ] Create `app/api/organizations/[orgId]/calendar-notifications/history/route.ts`
- [ ] Implement GET (notification delivery history from NotificationLog)
- [ ] Add RBAC guards for all endpoints

### Task 2.5: API Integration Tests
- [ ] Write `tests/integration/calendar-api.test.ts` — full CRUD flow via API routes
- [ ] Write `tests/integration/calendar-recurrence.test.ts` — recurring event creation and expansion
- [ ] Write `tests/integration/calendar-notifications.test.ts` — notification dispatch, rate limiting, tenant isolation
- [ ] Verify tenant isolation in API tests

## Phase 3: Calendar UI Components (Estimated: 16 hours)

### Task 3.1: Core Types & Utilities
- [ ] Create `components/calendar/types.ts` — shared TypeScript types for events, views, props
- [ ] Wire up `calendar-utils.ts` (from Task 1.5)

### Task 3.2: Calendar Month View
- [ ] Create `components/calendar/CalendarMonthView.tsx`
- [ ] Render 7-column grid (Sun-Sat) with proper date boundaries
- [ ] Display event cards on dates with color coding and icons
- [ ] Handle multi-day events (spanning cells)
- [ ] Navigate between months (prev/next buttons)

### Task 3.3: Calendar Week & Day Views
- [ ] Create `components/calendar/CalendarWeekView.tsx` — 7-column with hourly slots
- [ ] Create `components/calendar/CalendarDayView.tsx` — single column with hourly slots
- [ ] Implement view toggle state management in `Calendar.tsx`

### Task 3.4: Event Card Component
- [ ] Create `components/calendar/CalendarEventCard.tsx`
- [ ] Display event title, type icon, and color
- [ ] Implement expand/collapse for multi-event dates
- [ ] Show "N more" overflow indicator when collapsed

### Task 3.5: Calendar Sidebar
- [ ] Create `components/calendar/CalendarSidebar.tsx`
- [ ] Implement slide-in/out toggle (CSS transition ~200ms)
- [ ] Display Upcoming Events list with event type, date, property thumbnail
- [ ] Include Quick Add form (Event Type dropdown, Date input, Add Event button)

### Task 3.6: Event Modal & Context Menu
- [ ] Create `components/calendar/CalendarEventModal.tsx` — event detail/edit modal
- [ ] Implement edit form with validation (title, dates, type, recurrence)
- [ ] Include delete confirmation action
- [ ] Create `components/calendar/CalendarContextMenu.tsx` — right-click menu on dates
- [ ] Quick-add form within context menu

### Task 3.7: Recurrence Picker
- [ ] Create recurrence rule UI in `components/calendar/CalendarEventModal.tsx` (merged — no standalone `CalendarRecurrencePicker.tsx`)
- [ ] Frequency dropdown (Daily, Weekly, Monthly, Quarterly, Semi-Annually, Annually) behind "Repeat Event" toggle
- [ ] Ends strategy: Never / On Date (end date) / After Occurrences (count)

### Task 3.8: Main Calendar Container
- [ ] Create `components/calendar/Calendar.tsx` — orchestrates all sub-components
- [ ] View toggle (Month, Week, Day) with Today button and prev/next navigation
- [ ] Integrate sidebar toggle
- [ ] Wire up data fetching (SWR or direct API calls)

### Task 3.9: Drag-and-Drop Rescheduling
- [ ] Implement HTML5 drag-and-drop on event cards
- [ ] Handle drop target highlighting on dates
- [ ] Call update API to persist new date
- [ ] Handle keyboard accessibility

### Task 3.10: Component Unit Tests
- [ ] Write `tests/unit/CalendarMonthView.test.tsx`
- [ ] Write `tests/unit/CalendarEventCard.test.tsx`
- [ ] Write `tests/unit/CalendarSidebar.test.tsx`
- [ ] Write `tests/unit/CalendarEventModal.test.tsx`
- [ ] Write `tests/unit/CalendarContextMenu.test.tsx`

## Phase 4: Integration & Dashboard (Estimated: 4 hours)

### Task 4.1: Dashboard Sidebar Integration
- [ ] Add Calendar nav item to `app/dashboard/admin/layout.tsx`
- [ ] Use `<CalendarDays />` icon from lucide-react
- [ ] Add route: `/dashboard/admin/calendar`

### Task 4.2: Calendar Page
- [ ] Create `app/dashboard/admin/calendar/page.tsx`
- [ ] Render `<Calendar />` component with organization context
- [ ] Ensure proper data fetching and loading states

### Task 4.3: Prisma Seeding
- [ ] Update `prisma/seed.ts` with test calendars and events for dev profile
- [ ] Add test calendars and events for test tenant org in seed

## Phase 5: Testing & Validation (Estimated: 4 hours)

### Task 5.1: Isolation Tests
- [ ] Write `tests/isolation/calendar-isolation.test.ts` — verify events from Org A not visible to Org B

### Task 5.2: Full Validation
- [ ] Run `npm run test` — all unit tests pass
- [ ] Run `npm run build` — clean build with no errors
- [ ] Run `npx eslint . --max-warnings=0` — zero warnings
- [ ] Run `npx tsc --noEmit` — zero type errors

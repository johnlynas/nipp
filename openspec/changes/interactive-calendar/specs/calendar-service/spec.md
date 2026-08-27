# Delta for Interactive Calendar — Service Layer

## ADDED Requirements

### Requirement: CalendarService — Create Calendar
The system MUST provide a `CalendarService.createCalendar` method for creating new calendars within an organization.

#### Scenario: Create Calendar — Valid Input
- GIVEN a `ServiceContext` with a valid `userId` and `organizationId`
- WHEN `CalendarService.createCalendar(ctx, { name: "Maintenance Calendar", description: "Maintenance scheduling" })` is called
- THEN a new `Calendar` record MUST be created in the database with the provided name and description
- THEN the returned calendar MUST include `organizationId` set to the context's organization
- THEN the returned calendar MUST have `isDefault: false`

#### Scenario: Create Calendar — Duplicate Name
- GIVEN an organization already has a calendar named "Maintenance Calendar"
- WHEN `CalendarService.createCalendar(ctx, { name: "Maintenance Calendar" })` is called
- THEN a `ConflictError` MUST be thrown with message indicating duplicate name

#### Scenario: Create Calendar — Missing Name
- GIVEN a valid `ServiceContext`
- WHEN `CalendarService.createCalendar(ctx, { name: "" })` is called (empty name)
- THEN a `ValidationError` MUST be thrown

#### Scenario: Create Calendar — Authorization Check
- GIVEN a `ServiceContext` with role `MEMBER` (no admin privileges)
- WHEN `CalendarService.createCalendar(ctx, { name: "Test" })` is called
- THEN a `ForbiddenError` MUST be thrown

### Requirement: CalendarService — Get Calendars
The system MUST provide a `CalendarService.getCalendars` method for listing all calendars within an organization.

#### Scenario: Get Calendars — Returns All
- GIVEN a `ServiceContext` with valid `organizationId` containing 3 calendars
- WHEN `CalendarService.getCalendars(ctx, orgId)` is called
- THEN it MUST return all 3 calendars scoped to that organization

#### Scenario: Get Calendars — Tenant Isolation
- GIVEN `organizationId` is "org-a" with 2 calendars
- WHEN `CalendarService.getCalendars(ctx, "org-a")` is called (where ctx.organizationId = "org-b")
- THEN it MUST return only calendars belonging to "org-a" (Prisma Extension enforces isolation)

### Requirement: CalendarService — Get Default Calendar
The system MUST provide a `CalendarService.getDefaultCalendar` method for retrieving the default calendar of an organization.

#### Scenario: Get Default Calendar — Exists
- GIVEN an organization has a default calendar (isDefault = true)
- WHEN `CalendarService.getDefaultCalendar(ctx, orgId)` is called
- THEN it MUST return the default calendar

#### Scenario: Get Default Calendar — Does Not Exist
- GIVEN an organization has no default calendar
- WHEN `CalendarService.getDefaultCalendar(ctx, orgId)` is called
- THEN it MUST return `null`

### Requirement: CalendarService — Ensure Default Calendar
The system MUST provide a `CalendarService.ensureDefaultCalendar` method that creates a default calendar if one does not exist.

#### Scenario: Ensure Default — Already Exists
- GIVEN an organization has a default calendar
- WHEN `CalendarService.ensureDefaultCalendar(ctx, orgId)` is called
- THEN it MUST return the existing default calendar without creating a new one

#### Scenario: Ensure Default — Does Not Exist
- GIVEN an organization has no default calendar
- WHEN `CalendarService.ensureDefaultCalendar(ctx, orgId)` is called
- THEN a new default calendar MUST be created with name "Main Calendar", `isDefault: true`, and default color
- THEN the newly created calendar MUST be returned

### Requirement: CalendarService — Update Calendar
The system MUST provide a `CalendarService.updateCalendar` method for updating calendar properties.

#### Scenario: Update Calendar — Valid Update
- GIVEN a calendar exists with name "Old Name"
- WHEN `CalendarService.updateCalendar(ctx, calendarId, { name: "New Name" })` is called
- THEN the calendar's name MUST be updated to "New Name"
- THEN the `updatedAt` timestamp MUST reflect the change

#### Scenario: Update Calendar — Not Found
- GIVEN a non-existent calendar ID
- WHEN `CalendarService.updateCalendar(ctx, "nonexistent-id", { name: "Test" })` is called
- THEN a `NotFoundError` MUST be thrown

#### Scenario: Update Calendar — Tenant Isolation
- GIVEN calendar "cal-a" belongs to org-a
- WHEN a request from ctx with organizationId = "org-b" tries to update "cal-a"
- THEN a `NotFoundError` MUST be thrown (Prisma Extension filters by org)

### Requirement: CalendarService — Delete Calendar
The system MUST provide a `CalendarService.deleteCalendar` method for deleting calendars and cascading to events.

#### Scenario: Delete Calendar — Cascades Events
- GIVEN a calendar with 5 associated events
- WHEN `CalendarService.deleteCalendar(ctx, calendarId)` is called
- THEN the calendar MUST be deleted
- THEN all 5 associated events MUST also be deleted (cascade via Prisma relation)

#### Scenario: Delete Default Calendar — Prevented
- GIVEN a calendar is marked as `isDefault: true`
- WHEN `CalendarService.deleteCalendar(ctx, defaultCalendarId)` is called
- THEN a `ValidationError` MUST be thrown (cannot delete the last default calendar)

### Requirement: CalendarEventService — Create Event
The system MUST provide a `CalendarEventService.createEvent` method for creating new calendar events.

#### Scenario: Create Event — Single Day
- GIVEN a valid `ServiceContext` and a target calendar ID
- WHEN `CalendarEventService.createEvent(ctx, { title: "Property Viewing", startDate: new Date("2026-08-15T10:00"), endDate: new Date("2026-08-15T11:00"), calendarId: "cal-1", eventType: "VIEWING" })` is called
- THEN a new `CalendarEvent` record MUST be created with the provided details
- THEN the event MUST be scoped to the context's organization

#### Scenario: Create Event — Multi-Day
- GIVEN a valid `ServiceContext` and a target calendar ID
- WHEN `CalendarEventService.createEvent(ctx, { title: "Maintenance Window", startDate: new Date("2026-08-15"), endDate: new Date("2026-08-17"), calendarId: "cal-1", eventType: "MAINTENANCE" })` is called
- THEN the event MUST be created with startDate and endDate spanning 3 days

#### Scenario: Create Event — With Recurrence
- GIVEN a valid `ServiceContext` and a target calendar ID
- WHEN `CalendarEventService.createEvent(ctx, { title: "Weekly Inspection", startDate: new Date("2026-08-15"), endDate: new Date("2026-08-15T10:00"), calendarId: "cal-1", eventType: "INSPECTION", recurrence: { frequency: "WEEKLY", interval: 1 } })` is called
- THEN a `CalendarEvent` MUST be created with a linked `CalendarRecurrence` record
- THEN the recurrence record MUST have frequency = WEEKLY, interval = 1

#### Scenario: Create Event — With Property Association
- GIVEN a valid `ServiceContext` and a target calendar ID
- WHEN `CalendarEventService.createEvent(ctx, { title: "Viewing", startDate: ..., endDate: ..., calendarId: "cal-1", propertyId: "prop-123" })` is called
- THEN the event MUST be created with `propertyId` set to "prop-123"

#### Scenario: Create Event — Invalid Date Range
- GIVEN a valid `ServiceContext` and calendar ID
- WHEN `CalendarEventService.createEvent(ctx, { startDate: new Date("2026-08-20"), endDate: new Date("2026-08-15") })` (end before start)
- THEN a `ValidationError` MUST be thrown

#### Scenario: Create Event — Calendar Not Found
- GIVEN a valid `ServiceContext`
- WHEN `CalendarEventService.createEvent(ctx, { calendarId: "nonexistent", ... })` is called
- THEN a `NotFoundError` MUST be thrown

#### Scenario: Create Event — Authorization Check
- GIVEN a `ServiceContext` with role `MEMBER` lacking `calendar:create` permission
- WHEN `CalendarEventService.createEvent(ctx, { ... })` is called
- THEN a `ForbiddenError` MUST be thrown

### Requirement: CalendarEventService — Get Events (Date Range)
The system MUST provide a `CalendarEventService.getEvents` method for retrieving events within a date range.

#### Scenario: Get Events — Month Range
- GIVEN 5 events exist in August 2026 for the organization's calendar
- WHEN `CalendarEventService.getEvents(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN it MUST return all 5 events sorted by `startDate` ascending

#### Scenario: Get Events — Filtered by Calendar
- GIVEN an organization has 2 calendars with events in August 2026 (3 in cal-1, 2 in cal-2)
- WHEN `CalendarEventService.getEvents(ctx, { startDate: ..., endDate: ..., calendarId: "cal-1" })` is called
- THEN it MUST return only the 3 events from cal-1

#### Scenario: Get Events — Tenant Isolation
- GIVEN org-a has 3 events in August, org-b has 5 events in August
- WHEN a request from ctx with organizationId = "org-a" queries August 2026
- THEN it MUST return only org-a's 3 events (RLS + Prisma Extension enforce isolation)

### Requirement: CalendarEventService — Get Events With Recurrences
The system MUST provide a `CalendarEventService.getEventsWithRecurrences` method that expands recurring events within the date range.

#### Scenario: Get Events With Recurrences — Weekly Expansion
- GIVEN a weekly recurring event starting 2026-08-15 with no end date
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include:
  - The base event instance (2026-08-15)
  - Expanded instances for each subsequent Saturday in August (2026-08-22, 2026-08-29)
- THEN each expanded instance MUST have the same `id` as the base event but with instance-specific dates

#### Scenario: Get Events With Recurrences — Monthly Expansion
- GIVEN a monthly recurring event on the 15th starting 2026-06-15 with no end date
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include an instance for 2026-08-15

#### Scenario: Get Events With Recurrences — Quarterly Expansion
- GIVEN a quarterly recurring event starting 2026-01-15 with no end date
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include an instance for 2026-08-15 (Q3)

#### Scenario: Get Events With Recurrences — Semi-Annually Expansion
- GIVEN a semi-annually recurring event starting 2026-01-15 with no end date
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include an instance for 2026-08-15 (Semi-annual #3)

#### Scenario: Get Events With Recurrences — Annually Expansion
- GIVEN an annually recurring event starting 2026-08-15 with no end date
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include an instance for 2026-08-15

#### Scenario: Get Events With Recurrences — Interval > 1
- GIVEN a bi-weekly recurring event (interval=2) starting 2026-08-01
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST include instances for 2026-08-01, 2026-08-15, and 2026-08-29 (every 2 weeks)

#### Scenario: Get Events With Recurrences — Count Limit
- GIVEN a weekly recurring event with count=3 starting 2026-08-15
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-12-31") })` is called
- THEN the returned array MUST include exactly 3 instances (2026-08-15, 2026-08-22, 2026-08-29)
- THEN no instances beyond the count limit MUST be returned

#### Scenario: Get Events With Recurrences — End Date Limit
- GIVEN a weekly recurring event with endDate=2026-09-15 starting 2026-08-15
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-12-31") })` is called
- THEN the returned array MUST include instances up to and including 2026-09-12
- THEN no instances after 2026-09-15 MUST be returned

#### Scenario: Get Events With Recurrences — No Overlap with View Range
- GIVEN a weekly recurring event starting 2026-10-01
- WHEN `CalendarEventService.getEventsWithRecurrences(ctx, { startDate: new Date("2026-08-01"), endDate: new Date("2026-08-31") })` is called
- THEN the returned array MUST NOT include any instances from this event (all occurrences are outside the view range)

### Requirement: CalendarEventService — Get Event By ID
The system MUST provide a `CalendarEventService.getEventById` method for retrieving a single event.

#### Scenario: Get Event By ID — Exists
- GIVEN an event exists with ID "evt-1" in the organization's calendar
- WHEN `CalendarEventService.getEventById(ctx, "evt-1")` is called
- THEN it MUST return the event with all associated data (calendar, recurrence if applicable)

#### Scenario: Get Event By ID — Not Found
- GIVEN no event exists with ID "nonexistent"
- WHEN `CalendarEventService.getEventById(ctx, "nonexistent")` is called
- THEN a `NotFoundError` MUST be thrown

#### Scenario: Get Event By ID — Tenant Isolation
- GIVEN event "evt-a" belongs to org-a
- WHEN a request from ctx with organizationId = "org-b" tries to get "evt-a"
- THEN a `NotFoundError` MUST be thrown (Prisma Extension filters by org)

### Requirement: CalendarEventService — Update Event
The system MUST provide a `CalendarEventService.updateEvent` method for updating event properties.

#### Scenario: Update Event — Title Only
- GIVEN an event with title "Old Title"
- WHEN `CalendarEventService.updateEvent(ctx, eventId, { title: "New Title" })` is called
- THEN the event's title MUST be updated to "New Title"
- THEN other fields (description, dates, type) MUST remain unchanged

#### Scenario: Update Event — Reschedule (Drag-and-Drop)
- GIVEN an event on 2026-08-15T10:00 to 11:00
- WHEN `CalendarEventService.updateEvent(ctx, eventId, { startDate: new Date("2026-08-18T14:00"), endDate: new Date("2026-08-18T15:00") })` is called
- THEN the event's dates MUST be updated to the new date/time

#### Scenario: Update Event — Remove Recurrence
- GIVEN a recurring event with an associated CalendarRecurrence record
- WHEN `CalendarEventService.updateEvent(ctx, eventId, { recurrence: null })` is called
- THEN the event MUST become a single-event (recurrenceId set to null)
- THEN the associated CalendarRecurrence record MUST be deleted

#### Scenario: Update Event — Change Recurrence
- GIVEN a weekly recurring event
- WHEN `CalendarEventService.updateEvent(ctx, eventId, { recurrence: { frequency: "MONTHLY", interval: 1 } })` is called
- THEN the event's recurrence MUST be updated to monthly

#### Scenario: Update Event — Not Found
- GIVEN a non-existent event ID
- WHEN `CalendarEventService.updateEvent(ctx, "nonexistent", { title: "Test" })` is called
- THEN a `NotFoundError` MUST be thrown

### Requirement: CalendarEventService — Delete Event
The system MUST provide a `CalendarEventService.deleteEvent` method for deleting events.

#### Scenario: Delete Event — Single
- GIVEN a single (non-recurring) event exists
- WHEN `CalendarEventService.deleteEvent(ctx, eventId)` is called
- THEN the event MUST be deleted from the database

#### Scenario: Delete Event — Recurring (All Instances)
- GIVEN a recurring event with 5 expanded instances in the current view range
- WHEN `CalendarEventService.deleteEvent(ctx, eventId)` is called
- THEN the base event AND its recurrence rule MUST be deleted
- THEN ALL future instances of this recurring event MUST no longer appear

#### Scenario: Delete Event — Not Found
- GIVEN a non-existent event ID
- WHEN `CalendarEventService.deleteEvent(ctx, "nonexistent")` is called
- THEN a `NotFoundError` MUST be thrown

### Requirement: CalendarEventService — Get Upcoming Events
The system MUST provide a `CalendarEventService.getUpcomingEvents` method for retrieving upcoming events (for sidebar display).

#### Scenario: Get Upcoming Events — Default Limit
- GIVEN 15 events exist in the organization's calendar, 8 are upcoming (after today)
- WHEN `CalendarEventService.getUpcomingEvents(ctx, orgId)` is called (default limit = 10)
- THEN it MUST return the next 8 upcoming events sorted by `startDate` ascending

#### Scenario: Get Upcoming Events — Custom Limit
- GIVEN 15 events exist in the organization's calendar, 8 are upcoming
- WHEN `CalendarEventService.getUpcomingEvents(ctx, orgId, 5)` is called
- THEN it MUST return only the next 5 upcoming events

#### Scenario: Get Upcoming Events — With Recurrences
- GIVEN a weekly recurring event starting next week, and 3 single events in the next 2 weeks
- WHEN `CalendarEventService.getUpcomingEvents(ctx, orgId)` is called
- THEN the returned array MUST include expanded instances of the recurring event within the upcoming window

### Requirement: CalendarService — Authorization
All CalendarService methods MUST enforce authorization based on the `ServiceContext`.

#### Scenario: PLATFORM_ADMIN — Full Access
- GIVEN a `ServiceContext` with role `PLATFORM_ADMIN`
- WHEN any CalendarService method is called
- THEN the operation MUST proceed (platform admins have full access)

#### Scenario: TENANT_ADMIN — Access to Own Org
- GIVEN a `ServiceContext` with role `TENANT_ADMIN` and organizationId = "org-a"
- WHEN a CalendarService method is called targeting org-a's data
- THEN the operation MUST proceed

#### Scenario: MEMBER — Read Access
- GIVEN a `ServiceContext` with role `MEMBER` and organizationId = "org-a"
- WHEN a read CalendarService method (getCalendars, getDefaultCalendar) is called
- THEN the operation MUST proceed

#### Scenario: MEMBER — Write Access Denied
- GIVEN a `ServiceContext` with role `MEMBER` and organizationId = "org-a"
- WHEN a write CalendarService method (createCalendar, updateCalendar, deleteCalendar) is called
- THEN a `ForbiddenError` MUST be thrown

### Requirement: Calendar Utility Functions
The system MUST provide pure utility functions in `components/calendar/calendar-utils.ts` for date math and recurrence expansion.

#### Scenario: Month Grid Generation
- GIVEN August 2026 (starts on Sunday, ends on Tuesday)
- WHEN `generateMonthGrid(new Date("2026-08-01"))` is called
- THEN it MUST return a 6-row grid (42 cells) starting from the previous month's Sunday
- THEN the first cell MUST be 2026-07-27 (previous month, grayed out)
- THEN the last cell MUST be 2026-08-30 (next month, grayed out)

#### Scenario: Week Grid Generation
- GIVEN the week containing 2026-08-15 (Saturday)
- WHEN `generateWeekGrid(new Date("2026-08-15"))` is called
- THEN it MUST return a 7-element array starting from Sunday 2026-08-10 through Saturday 2026-08-16

#### Scenario: Event Type to Icon Mapping
- GIVEN `getEventIcon("VIEWING")` is called
- THEN it MUST return the lucide-react `Home` icon component

#### Scenario: Event Type to Color Mapping
- GIVEN `getEventColor("MAINTENANCE")` is called
- THEN it MUST return the hex color string `"#E76F51"`

#### Scenario: Recurrence Expansion — Weekly
- GIVEN a weekly recurring event starting 2026-08-15 with no end date
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return an array of 4 instances: 2026-08-15, 2026-08-22, 2026-08-29 (and one more if within range)

#### Scenario: Recurrence Expansion — Monthly
- GIVEN a monthly recurring event on the 15th starting 2026-06-15
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return an array with 1 instance: 2026-08-15

#### Scenario: Recurrence Expansion — Quarterly
- GIVEN a quarterly recurring event starting 2026-01-15
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return an array with 1 instance: 2026-08-15 (Q3)

#### Scenario: Recurrence Expansion — Semi-Annually
- GIVEN a semi-annually recurring event starting 2026-01-15
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return an array with 1 instance: 2026-08-15 (Semi-annual #3)

#### Scenario: Recurrence Expansion — Annually
- GIVEN an annually recurring event starting 2026-08-15
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return an array with 1 instance: 2026-08-15

#### Scenario: Recurrence Expansion — Bi-Weekly
- GIVEN a bi-weekly recurring event (interval=2) starting 2026-08-01
- WHEN `expandRecurrence(event, new Date("2026-08-01"), new Date("2026-08-31"))` is called
- THEN it MUST return instances for 2026-08-01, 2026-08-15, and 2026-08-29

# Delta for Interactive Calendar — Notification Service

## ADDED Requirements

### Requirement: CalendarNotificationService — Get Today Events
The system MUST provide a `CalendarNotificationService.getTodayEvents` method for retrieving all calendar events happening on the current date within an organization.

#### Scenario: Get Today Events — No Events
- GIVEN no calendar events exist for today in the organization
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called with today's date
- THEN it MUST return an empty array

#### Scenario: Get Today Events — Single Event
- GIVEN one calendar event exists with `startDate` equal to today's date in the organization
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called
- THEN it MUST return an array containing that single event

#### Scenario: Get Today Events — Multiple Events
- GIVEN three calendar events exist with `startDate` equal to today's date in the organization
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called
- THEN it MUST return all three events sorted by `startDate` ascending

#### Scenario: Get Today Events — Multi-Day Events
- GIVEN a multi-day event with `startDate` = yesterday and `endDate` = tomorrow (spanning today)
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called
- THEN it MUST include this event (it overlaps with today)

#### Scenario: Get Today Events — Recurring Event Instance
- GIVEN a weekly recurring event with an instance on today's date
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called
- THEN it MUST include the expanded instance for today

#### Scenario: Get Today Events — Tenant Isolation
- GIVEN org-a has 2 events today, org-b has 5 events today
- WHEN a request from ctx with organizationId = "org-a" queries today's events
- THEN it MUST return only org-a's 2 events (RLS + Prisma Extension enforce isolation)

#### Scenario: Get Today Events — Exclude Future Events
- GIVEN an event with `startDate` = tomorrow in the organization
- WHEN `CalendarNotificationService.getTodayEvents(ctx, orgId)` is called
- THEN it MUST NOT include this event (startDate is not today)

### Requirement: CalendarNotificationService — Get Today Events For User
The system MUST provide a `CalendarNotificationService.getTodayEventsForUser` method for retrieving today's events scoped to a specific user within their organization.

#### Scenario: Get Today Events For User — Basic
- GIVEN a user is a member of org-a which has 3 events today
- WHEN `CalendarNotificationService.getTodayEventsForUser(ctx, userId)` is called
- THEN it MUST return all 3 events (user has access to all org events)

#### Scenario: Get Today Events For User — Tenant Isolation
- GIVEN user-a is a member of org-a, and user-b is a member of org-b
- WHEN `CalendarNotificationService.getTodayEventsForUser(ctx, userId)` is called where ctx.organizationId = "org-a"
- THEN it MUST NOT return events from org-b

### Requirement: CalendarNotificationService — Build Today Events Message
The system MUST provide a `CalendarNotificationService.buildTodayEventsMessage` method for generating branded email content for today's events.

#### Scenario: Build Message — No Events
- GIVEN an empty array of events and recipient name "John"
- WHEN `CalendarNotificationService.buildTodayEventsMessage([], "John")` is called
- THEN it MUST return a message with subject indicating no events today
- THEN the HTML body MUST use Property NI branding (Navy header, Amber accent)

#### Scenario: Build Message — With Events
- GIVEN an array of 3 events and recipient name "John"
- WHEN `CalendarNotificationService.buildTodayEventsMessage(events, "John")` is called
- THEN it MUST return an object with:
  - `subject`: "Property NI — Today's Events" (or similar)
  - `html`: Full HTML email template with Property NI branding
  - `text`: Plain text version of the notification

#### Scenario: Build Message — Email Branding
- GIVEN a message is built for today's events
- THEN the HTML template MUST include:
  - Navy (`#1B2A4A`) header bar with "Property NI" branding
  - White body section listing each event (title, time, type)
  - Amber (`#F5A623`) accent bar after the event list
  - Gray footer with automated notification disclaimer

#### Scenario: Build Message — Event Type Display
- GIVEN events of different types (VIEWING, INSPECTION, MAINTENANCE)
- WHEN the message is built
- THEN each event MUST display its type label and associated icon/color

### Requirement: CalendarNotificationService — Send Today Event Notifications
The system MUST provide a `CalendarNotificationService.sendTodayEventNotifications` method for dispatching notifications about today's events to users or organizations.

#### Scenario: Send Notifications — To Specific User
- GIVEN 3 events exist today for the organization and a specific userId
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { userId: "user-1", organizationId: "org-a", eventIds: [...], notifyType: "TODAY_EVENTS" })` is called
- THEN a notification email MUST be sent to user-1's email address
- THEN the email MUST list all 3 events happening today
- THEN each notification MUST be logged to NotificationLog with status "SENT"

#### Scenario: Send Notifications — To Organization (All Members)
- GIVEN 3 events exist today and the organization has 5 members
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { organizationId: "org-a", eventIds: [...], notifyType: "TODAY_EVENTS" })` is called
- THEN a notification email MUST be sent to each of the 5 members
- THEN each member's email MUST receive a personalized notification (with their name)
- THEN 5 entries MUST be created in NotificationLog (one per recipient)

#### Scenario: Send Notifications — Rate Limiting
- GIVEN a recipient has already received 5 calendar notifications today (at the rate limit)
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { ... })` is called for that recipient
- THEN the notification MUST NOT be sent to that recipient (rate limited)
- THEN the dispatcher MUST return `{ sent: false, rateLimited: true }` for that recipient
- THEN the rate-limited notification MUST still be logged to NotificationLog

#### Scenario: Send Notifications — Failed Email Delivery
- GIVEN the SMTP server is unavailable (email send fails)
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { ... })` is called
- THEN the notification MUST be logged to NotificationLog with status "FAILED"
- THEN the method MUST continue processing remaining recipients (not abort on failure)

#### Scenario: Send Notifications — Tenant Isolation
- GIVEN org-a has events today and org-b has different events today
- WHEN a request from ctx with organizationId = "org-a" triggers notifications
- THEN only org-a's events MUST be included in the notification content
- THEN no events from org-b may appear in any notification

#### Scenario: Send Notifications — Authorization Check
- GIVEN a `ServiceContext` with role `MEMBER` (no admin privileges)
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { ... })` is called (write operation)
- THEN a `ForbiddenError` MUST be thrown

#### Scenario: Send Notifications — Result Tracking
- GIVEN 5 recipients are targeted for notification
- WHEN `CalendarNotificationService.sendTodayEventNotifications(ctx, { ... })` is called
- THEN the method MUST return an array of `NotificationResult` objects:
  - `{ email, status: "SENT" }` for successfully delivered notifications
  - `{ email, status: "RATE_LIMITED" }` for rate-limited recipients
  - `{ email, status: "FAILED", error?: string }` for failed deliveries

### Requirement: Calendar Notification REST Endpoints — Get Today
The system MUST provide a GET endpoint at `/api/organizations/[orgId]/calendar-notifications/today` for retrieving today's events.

#### Scenario: Get Today — Returns Events
- GIVEN 3 calendar events exist today for the organization
- WHEN a tenant member with `calendar:read` permission sends GET to `/api/organizations/[orgId]/calendar-notifications/today`
- THEN the response MUST include all 3 events with full details (title, start/end time, type, color)

#### Scenario: Get Today — No Events
- GIVEN no events exist today for the organization
- WHEN GET to `/api/organizations/[orgId]/calendar-notifications/today` is called
- THEN the response MUST return an empty array `[]`

#### Scenario: Get Today — Permission Denied
- GIVEN a user without `calendar:read` permission sends GET to the endpoint
- THEN the response MUST return 403 Forbidden

#### Scenario: Get Today — Tenant Isolation
- GIVEN org-a has events today, org-b has different events today
- WHEN a request from ctx with organizationId = "org-a" hits the endpoint
- THEN only org-a's events MUST be returned

### Requirement: Calendar Notification REST Endpoints — Send Today
The system MUST provide a POST endpoint at `/api/organizations/[orgId]/calendar-notifications/send-today` for triggering today's event notifications.

#### Scenario: Send Today — Success
- GIVEN 3 events exist today and the organization has 5 members
- WHEN a tenant admin with `calendar:create` permission sends POST to `/api/organizations/[orgId]/calendar-notifications/send-today`
- THEN the response MUST return a summary of notification results (sent, rate-limited, failed counts)
- THEN email notifications MUST be dispatched to all eligible recipients

#### Scenario: Send Today — Permission Denied
- GIVEN a user without `calendar:create` permission sends POST to the endpoint
- THEN the response MUST return 403 Forbidden

#### Scenario: Send Today — No Events
- GIVEN no events exist today for the organization
- WHEN POST to `/api/organizations/[orgId]/calendar-notifications/send-today` is called
- THEN the response MUST return a summary indicating 0 notifications sent (no events to notify about)

#### Scenario: Send Today — Tenant Isolation
- GIVEN org-a has events today, org-b has different events today
- WHEN a request from ctx with organizationId = "org-a" triggers notifications
- THEN only org-a's events MUST be included in the notification content

### Requirement: Calendar Notification REST Endpoints — History
The system MUST provide a GET endpoint at `/api/organizations/[orgId]/calendar-notifications/history` for viewing notification delivery history.

#### Scenario: Get History — Returns Entries
- GIVEN 10 notification log entries exist for the organization's calendar notifications
- WHEN a tenant admin sends GET to `/api/organizations/[orgId]/calendar-notifications/history`
- THEN the response MUST include the notification log entries with: recipient email, event type, message preview, status, timestamp

#### Scenario: Get History — Filtered by Event Type
- GIVEN multiple notification types exist in the log (TODAY_EVENTS, MASS_DELETION, etc.)
- WHEN GET to `/api/organizations/[orgId]/calendar-notifications/history?eventType=TODAY_EVENTS` is called
- THEN the response MUST include only TODAY_EVENTS entries

#### Scenario: Get History — Permission Denied
- GIVEN a user without admin privileges sends GET to the history endpoint
- THEN the response MUST return 403 Forbidden

### Requirement: Notification Service — Integration with Existing Infrastructure
The calendar notification service MUST reuse existing notification infrastructure components.

#### Scenario: Reuses Email Dispatch
- GIVEN the calendar notification service sends a notification
- THEN it MUST call `dispatchNotification` from `lib/notifications/dispatcher.ts` (not implement its own email sending)

#### Scenario: Reuses Rate Limiting
- GIVEN the calendar notification service sends notifications to a recipient who has already received 5 notifications today
- THEN the existing Redis-based rate limiter MUST prevent further delivery (same `NOTIFICATION_RATE_LIMIT` config)

#### Scenario: Reuses NotificationLog
- GIVEN the calendar notification service sends a notification
- THEN it MUST create an entry in the existing `NotificationLog` Prisma model (not a new table)

#### Scenario: Reuses Email Branding
- GIVEN the calendar notification service builds an email template
- THEN it MUST use Property NI colors: Navy (`#1B2A4A`) header, Amber (`#F5A623`) accent bar
- THEN the footer MUST include "This is an automated notification from Property NI. Do not reply."

### Requirement: Notification Service — Unit Tests
The system MUST include comprehensive unit tests for the calendar notification service.

#### Scenario: Service Unit Tests Exist
- GIVEN the project structure includes `tests/unit/calendar-notification-service.test.ts`
- THEN it MUST contain tests for:
  - `getTodayEvents`: empty results, single event, multiple events, multi-day overlap, tenant isolation
  - `getTodayEventsForUser`: basic query, tenant isolation
  - `buildTodayEventsMessage`: no events, with events, email branding verification
  - `sendTodayEventNotifications`: single user, organization-wide, rate limiting, failed delivery, tenant isolation, result tracking
  - Authorization checks for all methods

#### Scenario: Integration Tests Exist
- GIVEN the project structure includes `tests/integration/calendar-notifications.test.ts`
- THEN it MUST contain tests for:
  - Full notification dispatch flow via API routes
  - Rate limiting behavior across multiple requests
  - Tenant isolation (org-a notifications don't leak to org-b)

# Delta for Interactive Calendar — UI

## ADDED Requirements

### Requirement: Stand-Alone Calendar Component
The system MUST provide a standalone, reusable calendar component at `components/calendar/Calendar.tsx` that can be integrated into any organization context.

#### Scenario: Calendar Component Renders
- GIVEN a page renders the `<Calendar />` component with an `organizationId` prop
- WHEN the component mounts
- THEN it MUST display a month view by default
- THEN it MUST show navigation controls (Month/Week/Day toggle, Today button, prev/next arrows)

#### Scenario: Calendar View Toggle — Month
- GIVEN the calendar is in month view
- WHEN the user clicks "Week"
- THEN the view MUST switch to week view with 7-column layout and hourly time slots

#### Scenario: Calendar View Toggle — Week
- GIVEN the calendar is in week view
- WHEN the user clicks "Day"
- THEN the view MUST switch to day view with single-column hourly time slots

#### Scenario: Calendar View Toggle — Day
- GIVEN the calendar is in day view
- WHEN the user clicks "Month"
- THEN the view MUST switch to month view with 7-column grid

#### Scenario: Today Button
- GIVEN the calendar is viewing any date range
- WHEN the user clicks "Today"
- THEN the view MUST navigate to and display the current month

#### Scenario: Prev/Next Navigation
- GIVEN the calendar is in any view
- WHEN the user clicks the prev arrow
- THEN the view MUST navigate to the previous period (month/week/day)
- WHEN the user clicks the next arrow
- THEN the view MUST navigate to the next period (month/week/day)

### Requirement: Calendar Grid Rendering
The system MUST render a calendar grid with proper date boundaries and event display.

#### Scenario: Month Grid — 7 Columns
- GIVEN the calendar is in month view
- THEN the grid MUST display 7 columns (Sunday through Saturday)
- THEN each column header MUST show "Sun-Sat" or the day abbreviation

#### Scenario: Month Grid — Date Boundaries
- GIVEN a month view is rendered for August 2026
- THEN cells BEFORE the first day of the month MUST show the previous month's dates (grayed out)
- THEN cells AFTER the last day of the month MUST show the next month's dates (grayed out)
- THEN cells FOR August 2026 MUST show the correct day numbers

#### Scenario: Week Grid — Hourly Slots
- GIVEN the calendar is in week view
- THEN each day column MUST display hourly time slots (e.g., 00:00, 01:00, ..., 23:00)
- THEN events MUST be positioned at the correct time slot

#### Scenario: Day Grid — Hourly Slots
- GIVEN the calendar is in day view
- THEN the column MUST display hourly time slots (00:00 through 23:00)
- THEN events MUST be positioned at the correct time slot

### Requirement: Event Card Display
The system MUST display events on calendar dates with color coding and type-specific icons.

#### Scenario: Event Card — Color Coding
- GIVEN a date has events of different types
- THEN each event card MUST display with its type-specific color:
  - VIEWING → Teal (`#2A9D8F`)
  - INSPECTION → Amber (`#F5A623`)
  - MAINTENANCE → Orange (`#E76F51`)
  - LEASE_SIGNING → Navy (`#1B2A4A`)
  - LEASE_RENEWAL → Purple (`#7B68AE`)
  - KEY_EXCHANGE → Gold (`#D4A017`)
  - OTHER → Gray (`#6C757D`)

#### Scenario: Event Card — Type Icon
- GIVEN an event card is rendered
- THEN it MUST display the correct icon from lucide-react:
  - VIEWING → `Home`
  - INSPECTION → `ClipboardList`
  - MAINTENANCE → `Wrench`
  - LEASE_SIGNING → `FileText`
  - LEASE_RENEWAL → `RefreshCw`
  - KEY_EXCHANGE → `Key`
  - OTHER → `Calendar`

#### Scenario: Multiple Events Per Date — Expandable
- GIVEN a date has multiple events
- THEN the calendar MUST show all event titles in a compressed single-line format by default
- WHEN the user clicks to expand
- THEN each event MUST display with full details (title, description, time, icon)

#### Scenario: Multiple Events Per Date — Overflow Indicator
- GIVEN a date has more events than can be displayed
- THEN an overflow indicator MUST show (e.g., "+3 more")

#### Scenario: Multi-Day Events
- GIVEN an event spans multiple days (e.g., a 3-day maintenance window)
- THEN the event card MUST visually span across all relevant date cells in the grid

### Requirement: Collapsible Upcoming Events Sidebar
The system MUST provide a sidebar that slides in and out to maximize screen real estate.

#### Scenario: Sidebar Collapsed State (Default)
- GIVEN the calendar page loads
- THEN the sidebar MUST be collapsed by default (icon-only, width 64px)

#### Scenario: Sidebar Expanded State
- GIVEN the sidebar is collapsed
- WHEN the user clicks the toggle button
- THEN the sidebar MUST expand to full width (320px) with smooth CSS transition (~200ms)
- THEN the Upcoming Events list MUST be visible
- THEN the Quick Add form MUST be visible

#### Scenario: Sidebar Collapsed from Expanded
- GIVEN the sidebar is expanded
- WHEN the user clicks the toggle button
- THEN the sidebar MUST collapse to icon-only (width 64px) with smooth CSS transition (~200ms)

#### Scenario: Upcoming Events List
- GIVEN the sidebar is expanded
- THEN it MUST display a list of upcoming events sorted by date (ascending)
- THEN each event entry MUST show: event type label, date, and property thumbnail (if associated)

### Requirement: Quick Add via Sidebar
The system MUST provide a quick-add form in the sidebar for creating new events.

#### Scenario: Quick Add Form Fields
- GIVEN the sidebar is expanded and the Quick Add section is visible
- THEN it MUST contain:
  - An "Event Type" dropdown selector (VIEWING, INSPECTION, MAINTENANCE, LEASE_SIGNING, LEASE_RENEWAL, KEY_EXCHANGE, OTHER)
  - A "Date" input field (date picker)
  - An "Add Event" button styled with Amber (`#F5A623`) background

#### Scenario: Quick Add — Submit
- GIVEN the user fills in the Event Type and Date fields
- WHEN the user clicks "Add Event"
- THEN a new event MUST be created with the selected type and date
- THEN the calendar grid MUST update to show the new event

#### Scenario: Quick Add — Validation
- GIVEN the user clicks "Add Event" without filling required fields
- THEN a validation error MUST be displayed
- THEN no event MUST be created

### Requirement: Right-Click Context Menu
The system MUST provide a right-click context menu on calendar dates for quick event creation.

#### Scenario: Context Menu Trigger
- GIVEN a user right-clicks on any date cell in the calendar grid
- THEN a context menu MUST appear at the cursor position

#### Scenario: Context Menu — Quick Add Option
- GIVEN the context menu is open on a date
- THEN it MUST contain an "Add Event" option
- WHEN the user selects "Add Event"
- THEN a quick-add form MUST appear pre-populated with the clicked date

#### Scenario: Context Menu — Close
- GIVEN the context menu is open
- WHEN the user clicks anywhere outside the menu or presses Escape
- THEN the context menu MUST close

### Requirement: Event Detail Modal
The system MUST provide a modal for viewing and editing event details.

#### Scenario: Open Event Detail Modal
- GIVEN an event card is displayed on the calendar grid
- WHEN the user clicks on the event card
- THEN a modal MUST open showing the full event details

#### Scenario: Modal — Event Details Display
- GIVEN the event detail modal is open
- THEN it MUST display: title, description, start/end date and time, event type with icon, associated property (if any), recurrence rule (if applicable)

#### Scenario: Modal — Edit Mode
- GIVEN the event detail modal is open in view mode
- WHEN the user clicks "Edit"
- THEN the modal MUST switch to edit mode with editable fields for all event properties

#### Scenario: Modal — Save Changes
- GIVEN the modal is in edit mode with modified fields
- WHEN the user clicks "Save"
- THEN the event MUST be updated via PATCH API
- THEN the modal MUST close
- THEN the calendar grid MUST reflect the changes

#### Scenario: Modal — Delete Confirmation
- GIVEN the event detail modal is open
- WHEN the user clicks "Delete"
- THEN a confirmation dialog MUST appear asking to confirm deletion

#### Scenario: Modal — Confirm Delete
- GIVEN the delete confirmation dialog is shown
- WHEN the user confirms deletion
- THEN the event MUST be deleted via DELETE API
- THEN the modal MUST close
- THEN the calendar grid MUST no longer show the event

#### Scenario: Modal — Cancel Edit
- GIVEN the modal is in edit mode with unsaved changes
- WHEN the user clicks "Cancel" or closes the modal
- THEN no changes MUST be persisted to the server

### Requirement: Drag-and-Drop Rescheduling
The system MUST support drag-and-drop rescheduling of events between dates.

#### Scenario: Drag Start
- GIVEN an event card is displayed on the calendar grid
- WHEN the user clicks and holds on the event card
- THEN the event card MUST become draggable (visual feedback: opacity change, shadow)

#### Scenario: Drop Target Highlight
- GIVEN the user is dragging an event card
- WHEN the cursor enters a date cell
- THEN that date cell MUST highlight to indicate it is a valid drop target

#### Scenario: Drop — Reschedule Event
- GIVEN the user drags an event card and drops it on a different date cell
- THEN the event's `startDate` and `endDate` MUST be updated via PATCH API to the new date
- THEN the calendar grid MUST re-render with the event at its new position

#### Scenario: Drop — Invalid Target
- GIVEN the user drags an event card
- WHEN the drop target is outside a valid date cell
- THEN the event MUST NOT be moved (snap back to original position)

### Requirement: Recurrence Display
The system MUST display recurring events with appropriate visual indicators.

#### Scenario: Recurring Event — Base Display
- GIVEN a recurring event is displayed on the calendar grid
- THEN it MUST show the same visual appearance as a single-event (color, icon)

#### Scenario: Recurring Event — Indicator
- GIVEN a recurring event is displayed
- THEN a small recurrence indicator icon MUST appear on the event card (e.g., a circular arrow)

#### Scenario: Recurring Event — Modal Display
- GIVEN the event detail modal is open for a recurring event
- THEN it MUST display the recurrence rule (frequency, interval, end date/count)

### Requirement: Property NI Design System Compliance
All calendar UI components MUST use the Property NI standard color scheme and design elements.

#### Scenario: Sidebar Background
- GIVEN any calendar component is rendered within the Integrated Super Admin Dashboard
- THEN the sidebar background MUST be `#1B2A4A` (Navy) with white text

#### Scenario: Primary Button Styling
- GIVEN an "Add Event" or primary action button is rendered in the calendar UI
- THEN its background MUST be `#F5A623` (Amber) with appropriate text color

#### Scenario: Content Area Background
- GIVEN the calendar content area is rendered
- THEN its background MUST be `#f8f9fa` (light)

#### Scenario: Card Styling
- GIVEN an event card or panel is rendered in the calendar UI
- THEN it MUST have a white background (`#ffffff`), subtle border (`#dee2e6`), and rounded corners

#### Scenario: Active Navigation Highlight
- GIVEN the Calendar nav item is active in the sidebar
- THEN it MUST have an Amber (`#F5A623`) left border or background highlight

### Requirement: Calendar Nav Item in Dashboard
The system MUST include a Calendar navigation item in the Integrated Super Admin Dashboard sidebar.

#### Scenario: Calendar Nav Item Present
- GIVEN a Super Admin visits `/dashboard/admin`
- THEN the sidebar MUST contain a Calendar navigation item

#### Scenario: Calendar Nav Item — Icon
- GIVEN the Calendar nav item is rendered in the sidebar
- THEN it MUST use the `<CalendarDays />` icon from lucide-react

#### Scenario: Calendar Nav Item — Navigation
- GIVEN the user clicks the Calendar nav item
- THEN they MUST be navigated to `/dashboard/admin/calendar`

#### Scenario: Calendar Nav Item — Active State
- GIVEN the user is on `/dashboard/admin/calendar`
- THEN the Calendar nav item MUST be highlighted as active (Amber accent)

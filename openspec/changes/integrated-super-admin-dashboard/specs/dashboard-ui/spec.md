# Delta for Integrated Super Admin Dashboard — UI

## ADDED Requirements

### Requirement: Collapsible Sidebar Navigation
The system MUST provide a collapsible sidebar navigation on the integrated dashboard.

#### Scenario: Sidebar Expanded State
- GIVEN a Super Admin visits `/dashboard/admin`
- WHEN the page loads
- THEN the sidebar MUST be expanded (width 256px / `w-64`)
- THEN all navigation labels MUST be visible

#### Scenario: Sidebar Collapsed State
- GIVEN the sidebar is expanded
- WHEN the user clicks the collapse toggle button
- THEN the sidebar MUST collapse to icon-only (width 64px / `w-16`)
- THEN navigation labels MUST be hidden
- THEN icon buttons MUST remain visible

#### Scenario: Sidebar Transition Animation
- GIVEN the sidebar is in any state
- WHEN the user toggles collapse/expand
- THEN the width change MUST animate smoothly (CSS transition, ~200ms)

#### Scenario: Sidebar Navigation Items
- GIVEN the sidebar is visible
- THEN it MUST contain navigation items for: Users, Organizations, Teams, Roles, Permissions
- THEN each item MUST use a `lucide-react` icon and text label (when expanded)
- THEN the active item MUST have an Amber (`#F5A623`) left border or background highlight

### Requirement: Super Admin Access Gate
The integrated dashboard MUST be restricted to Platform (Super Admin) users only.

#### Scenario: Super Admin Access
- GIVEN a verified Super Admin (Platform Organization member) visits `/dashboard/admin`
- WHEN the page loads
- THEN the dashboard content MUST render

#### Scenario: Non-Super-Admin Access Blocked
- GIVEN a non-Super-Admin user visits `/dashboard/admin`
- WHEN the page loads
- THEN the `<RequireSuperAdmin>` component MUST redirect to `/login` with `callbackUrl`
- THEN the dashboard content MUST NOT render

#### Scenario: Unauthenticated Access Blocked
- GIVEN an unauthenticated user visits `/dashboard/admin`
- WHEN the page loads
- THEN the middleware MUST redirect to `/login` with `callbackUrl`

### Requirement: Corporate/Enterprise Aesthetic
The integrated dashboard MUST follow a corporate/enterprise visual style.

#### Scenario: Content Area Background
- GIVEN any panel is rendered on the integrated dashboard
- THEN the content area background MUST be `#f8f9fa` (light)

#### Scenario: Card Styling
- GIVEN a card component is rendered on the integrated dashboard
- THEN it MUST have a white background (`#ffffff`), subtle border (`#dee2e6`), and rounded corners

#### Scenario: Sidebar Background
- GIVEN the sidebar is rendered on the integrated dashboard
- THEN its background MUST be `#1B2A4A` (Navy) with white text

#### Scenario: Primary Button Styling
- GIVEN a primary action button is rendered on the integrated dashboard
- THEN its background MUST be `#F5A623` (Amber) with dark text

### Requirement: Stat Cards
Each panel MUST display stat cards summarizing key metrics.

#### Scenario: Stat Card Grid Layout
- GIVEN a panel is rendered on the integrated dashboard
- THEN stat cards MUST be displayed in a responsive grid (4 columns on desktop, 2 on tablet, 1 on mobile)
- THEN each stat card MUST show: a label, a numeric value, and an icon

#### Scenario: Stat Card Color Coding
- GIVEN stat cards are rendered on a panel
- THEN primary metrics MUST use blue accent borders/icons
- THEN success metrics (active, verified) MUST use green accents
- THEN warning/error metrics (banned, suspended) MUST use red accents

### Requirement: Data Tables
All list views MUST use consistent table components.

#### Scenario: Table Structure
- GIVEN a data table is rendered on the integrated dashboard
- THEN it MUST have: header row with column labels, data rows, loading state, empty state
- THEN each header cell MUST have `scope="col"` for accessibility

#### Scenario: Table Hover State
- GIVEN a data table has rows
- WHEN the user hovers over a row
- THEN the row background MUST change subtly (e.g., `bg-gray-50`)

#### Scenario: Table Action Buttons
- GIVEN a data table row has action buttons (View, Edit, Delete, etc.)
- THEN each icon-only button MUST include an `aria-label` attribute describing its action

### Requirement: Modal Dialogs
Create, Edit, and Detail views MUST use modal dialogs.

#### Scenario: Modal Open
- GIVEN a panel is rendered
- WHEN the user clicks "Create" or "View"
- THEN a modal MUST appear with an overlay backdrop
- THEN the modal content MUST be centered

#### Scenario: Modal Close
- GIVEN a modal is open
- WHEN the user clicks the backdrop, presses Escape, or clicks the close button
- THEN the modal MUST close

#### Scenario: Modal Focus Trap
- GIVEN a modal is open
- WHEN the user tabs through focusable elements
- THEN focus MUST remain within the modal (focus trap)

### Requirement: Search and Filter Controls
All list views MUST have search input and filter controls.

#### Scenario: Search Input
- GIVEN a panel with a data table is rendered
- THEN a search input MUST be displayed in the toolbar area
- THEN typing into the search input MUST filter table rows in real-time (debounced, ~300ms)

#### Scenario: Filter Dropdown
- GIVEN a panel supports filtering (e.g., by status, type)
- THEN a filter dropdown MUST be displayed in the toolbar area
- THEN selecting a filter value MUST update the table to show only matching rows

### Requirement: Toast Notifications
All user actions MUST provide visual feedback via toast notifications.

#### Scenario: Success Toast
- GIVEN a user performs a successful action (create, update, delete)
- WHEN the API response is received
- THEN a success toast MUST appear (top-right, using `sonner` Toaster)

#### Scenario: Error Toast
- GIVEN a user performs an action that fails (API error, validation error)
- WHEN the error is received
- THEN an error toast MUST appear with the error message

### Requirement: Loading States
All data-fetching operations MUST show loading indicators.

#### Scenario: Table Loading State
- GIVEN a panel is loading data
- THEN the table area MUST show a "Loading..." message or skeleton placeholders
- THEN no empty state or data rows MUST be visible during loading

#### Scenario: Action Loading State
- GIVEN a user clicks a submit button in a form modal
- THEN the button MUST show a loading spinner or be disabled
- THEN the form MUST NOT submit twice

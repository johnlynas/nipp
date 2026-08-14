# Delta for Resource Data Model — UI

## ADDED Requirements

### Requirement: Resources Page Route
The system MUST provide a dedicated page at `/dashboard/admin/resources` for managing resources.

#### Scenario: Resources Page Renders
- GIVEN a verified Super Admin navigates to `/dashboard/admin/resources`
- WHEN the page loads
- THEN the page MUST render with a `PageHeader` showing title "Resources" and description "Feature modules and their role-based access control"
- THEN the page MUST display stat cards showing: total resources count, total role assignments count

#### Scenario: Resources Page — Non-Super-Admin Access
- GIVEN a non-Super-Admin user navigates to `/dashboard/admin/resources`
- WHEN the page loads
- THEN the `<RequireSuperAdmin>` component MUST render `<AccessDenied />` instead of page content
- THEN the user MUST NOT see any resource management UI

#### Scenario: Resources Page — Unauthenticated Access
- GIVEN an unauthenticated user navigates to `/dashboard/admin/resources`
- WHEN the page loads
- THEN the middleware MUST redirect to `/login` with `callbackUrl`

### Requirement: Resources List View
The system MUST display a paginated list of all resources with search capability.

#### Scenario: Resources List Loads
- GIVEN a Super Admin is on the Resources page
- WHEN the page loads
- THEN an API call MUST be made to `GET /api/dashboard/admin/resources?page=1&pageSize=20`
- THEN the response MUST be rendered in a `DataTable` component

#### Scenario: Resources List — Search
- GIVEN a Super Admin is on the Resources page with resources displayed
- WHEN the user types "maint" into the search input
- THEN after a ~200ms debounce, an API call MUST be made to `GET /api/dashboard/admin/resources?search=maint`
- THEN the table MUST update to show only matching resources

#### Scenario: Resources List — Pagination
- GIVEN a Super Admin is on the Resources page with more than 20 resources
- WHEN the user clicks "next" in the pagination controls
- THEN an API call MUST be made to `GET /api/dashboard/admin/resources?page=2&pageSize=20`
- THEN the table MUST update to show page 2 results

#### Scenario: Resources List — Empty State
- GIVEN a Super Admin is on the Resources page and no resources exist
- WHEN the API returns an empty list
- THEN the `DataTable` MUST display "No results found" in the empty state

#### Scenario: Resources List — Loading State
- GIVEN a Super Admin is on the Resources page
- WHEN data is being fetched
- THEN the `DataTable` MUST display a "Loading..." message
- THEN no data rows or empty state MUST be visible during loading

### Requirement: Resources Table Columns
The system MUST display a data table with the following columns for each resource.

#### Scenario: Table Column — Name
- GIVEN a resource list is displayed in the `DataTable`
- THEN each row MUST show the resource's `name`

#### Scenario: Table Column — Assigned Roles
- GIVEN a resource list is displayed in the `DataTable`
- THEN each row MUST show the assigned role names (comma-separated or as badges)
- THEN if no roles are assigned, the cell MUST display "None"

#### Scenario: Table Column — Actions
- GIVEN a resource list is displayed in the `DataTable`
- THEN each row MUST show action buttons: View (Eye icon), Edit (Pencil icon), Delete (Trash2 icon)
- THEN each icon-only button MUST include an `aria-label` attribute

### Requirement: Create Resource Modal
The system MUST provide a modal dialog for creating new resources.

#### Scenario: Open Create Modal
- GIVEN a Super Admin is on the Resources page
- WHEN the user clicks the "+ Create Resource" button in the `PageHeader`
- THEN a modal MUST appear with an overlay backdrop
- THEN the modal title MUST be "Create Resource"

#### Scenario: Create Resource Form Fields
- GIVEN the create modal is open
- THEN it MUST contain a required "Name" text input field
- THEN it MUST contain an optional "Description" textarea field

#### Scenario: Create Resource — Success
- GIVEN the create modal is open with valid data entered (name: "Maintenance", description: "Manage maintenance")
- WHEN the user clicks "Save"
- THEN a POST request MUST be sent to `/api/dashboard/admin/resources` with the form data
- THEN on success, the modal MUST close
- THEN a success toast notification MUST appear
- THEN the resources list MUST refresh to include the new resource

#### Scenario: Create Resource — Missing Name
- GIVEN the create modal is open with an empty name field
- WHEN the user clicks "Save"
- THEN a validation error MUST be displayed in the form
- THEN no API request MUST be sent

#### Scenario: Create Resource — Cancel
- GIVEN the create modal is open
- WHEN the user clicks "Cancel" or presses Escape
- THEN the modal MUST close without making any API requests

### Requirement: Edit Resource Modal
The system MUST provide a modal dialog for editing existing resources.

#### Scenario: Open Edit Modal
- GIVEN a Super Admin is viewing the resources list
- WHEN the user clicks the Edit (Pencil) button on a resource row
- THEN a modal MUST appear with the resource's current name and description pre-filled

#### Scenario: Edit Resource — Success
- GIVEN the edit modal is open with a resource's current data
- WHEN the user modifies the name and clicks "Save"
- THEN a PATCH request MUST be sent to `/api/dashboard/admin/resources/[id]` with the updated data
- THEN on success, the modal MUST close
- THEN a success toast notification MUST appear
- THEN the resources list MUST update to reflect the changes

#### Scenario: Edit Resource — Cancel
- GIVEN the edit modal is open with unsaved changes
- WHEN the user clicks "Cancel" or presses Escape
- THEN the modal MUST close without making any API requests

### Requirement: Delete Resource Confirmation
The system MUST require confirmation before deleting a resource.

#### Scenario: Open Delete Confirmation
- GIVEN a Super Admin is viewing the resources list
- WHEN the user clicks the Delete (Trash2) button on a resource row
- THEN a `ConfirmDialog` MUST appear with the message "Are you sure you want to delete this resource?"

#### Scenario: Delete Resource — Confirmed
- GIVEN the delete confirmation dialog is open for a resource with no assigned roles
- WHEN the user confirms deletion
- THEN a DELETE request MUST be sent to `/api/dashboard/admin/resources/[id]`
- THEN on success, the modal MUST close
- THEN a success toast notification MUST appear
- THEN the resource MUST be removed from the list

#### Scenario: Delete Resource — Has Assigned Roles (Blocked)
- GIVEN a resource exists with assigned roles
- WHEN the user clicks Delete on that resource
- THEN the confirmation dialog MUST display an additional message: "This resource has X roles assigned. Remove them first."
- THEN the DELETE API call MUST NOT be made until all role assignments are removed

#### Scenario: Delete Resource — Cancelled
- GIVEN the delete confirmation dialog is open
- WHEN the user cancels or presses Escape
- THEN the dialog MUST close without making any API requests

### Requirement: Resource Detail View
The system MUST provide a way to view detailed information about a resource including its assigned roles.

#### Scenario: Open Detail Modal
- GIVEN a Super Admin is viewing the resources list
- WHEN the user clicks the View (Eye) button on a resource row
- THEN a modal MUST appear showing: resource name, description, and list of assigned roles (name, organization)

#### Scenario: Detail Modal — No Assigned Roles
- GIVEN a resource exists with no assigned roles
- WHEN the user opens the detail modal for that resource
- THEN the assigned roles section MUST display "No roles assigned"

### Requirement: Sidebar Navigation Item
The system MUST include a "Resources" entry in the integrated dashboard sidebar.

#### Scenario: Sidebar Contains Resources Link
- GIVEN a Super Admin is on any integrated dashboard page (e.g., `/dashboard/admin/permissions`)
- THEN the sidebar MUST contain a navigation link with label "Resources" and `Layers` icon from lucide-react
- THEN the link MUST point to `/dashboard/admin/resources`

#### Scenario: Sidebar Resources Link Active State
- GIVEN a Super Admin is on `/dashboard/admin/resources`
- THEN the "Resources" sidebar link MUST be highlighted with Amber (`#F5A623`) left border and `bg-[#24355c]` background
- THEN all other sidebar links MUST NOT have the active highlight

#### Scenario: Sidebar Resources Link Inactive State
- GIVEN a Super Admin is on `/dashboard/admin/permissions` (not Resources)
- THEN the "Resources" sidebar link MUST display with `text-gray-300` color
- THEN hovering over the "Resources" link MUST change its background to `bg-[#24355c]` and text to white

### Requirement: Design System Compliance
The Resources page MUST follow the Property NI design system.

#### Scenario: Page Background
- GIVEN the Resources page is rendered
- THEN the content area background MUST be `#f8f9fa` (light)

#### Scenario: Sidebar Background
- GIVEN the sidebar is rendered on the Resources page
- THEN its background MUST be `#1B2A4A` (Navy) with white text

#### Scenario: Primary Button Styling
- GIVEN the "Create Resource" button is rendered on the Resources page
- THEN its background MUST be `#F5A623` (Amber)

#### Scenario: Table Header Styling
- GIVEN the resources data table is rendered
- THEN the header row background MUST be `#1B2A4A` (Navy) with white text

#### Scenario: Card Styling
- GIVEN a stat card is rendered on the Resources page
- THEN it MUST have a white background (`#ffffff`), subtle border (`#dee2e6`), and rounded corners

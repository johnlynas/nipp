# Delta for Auth — Teams Integration

## ADDED Requirements

### Requirement: BetterAuth Teams Mode Enablement
BetterAuth MUST be configured with teams mode enabled in the Organization plugin.

#### Scenario: Teams Configuration
- GIVEN BetterAuth is initialized in `lib/auth.ts`
- WHEN the organization plugin is configured
- THEN it MUST include `teams: { enabled: true }` in the configuration
- THEN the following optional team configurations MAY be set:
  - `maximumTeams` — limit on teams per organization (default: no limit)
  - `allowRemovingAllTeams` — whether the last team can be removed (default: true)

#### Scenario: Client-Side Teams Configuration
- GIVEN the BetterAuth client is configured
- WHEN the `organizationClient` plugin is initialized
- THEN it MUST include `teams: { enabled: true }` in the configuration

### Requirement: Team-Specific Hooks Scaffolding
BetterAuth MUST scaffold team-specific hooks in the organization plugin configuration.

#### Scenario: Team Creation Hooks
- GIVEN BetterAuth is initialized with teams enabled
- WHEN the organization plugin hooks are configured
- THEN `beforeCreateTeam` hook MUST be scaffolded (no-op stub)
- THEN `afterCreateTeam` hook MUST be scaffolded (no-op stub)

#### Scenario: Team Update Hooks
- GIVEN BetterAuth is initialized with teams enabled
- WHEN the organization plugin hooks are configured
- THEN `beforeUpdateTeam` hook MUST be scaffolded (no-op stub)
- THEN `afterUpdateTeam` hook MUST be scaffolded (no-op stub)

#### Scenario: Team Deletion Hooks
- GIVEN BetterAuth is initialized with teams enabled
- WHEN the organization plugin hooks are configured
- THEN `beforeDeleteTeam` hook MUST be scaffolded (no-op stub)
- THEN `afterDeleteTeam` hook MUST be scaffolded (no-op stub)

#### Scenario: Team Member Hooks
- GIVEN BetterAuth is initialized with teams enabled
- WHEN the organization plugin hooks are configured
- THEN `beforeAddTeamMember` hook MUST be scaffolded (no-op stub)
- THEN `afterAddTeamMember` hook MUST be scaffolded (no-op stub)
- THEN `beforeRemoveTeamMember` hook MUST be scaffolded (no-op stub)
- THEN `afterRemoveTeamMember` hook MUST be scaffolded (no-op stub)

### Requirement: Team Data in Session Augmentation
The BetterAuth session MUST include team membership information for the authenticated user.

#### Scenario: Session Team Data
- GIVEN a user is authenticated and belongs to one or more teams within their organization
- WHEN the BetterAuth session callback runs
- THEN the session object MUST include an array of team IDs the user belongs to
- THEN the session object MUST include the active team ID (if set)

### Requirement: Team Invitation Support
Invitations to an organization MAY specify a target team.

#### Scenario: Team-Specific Invitation
- GIVEN an invitation is being created for a new organization member
- WHEN the `teamId` field is provided in the invitation data
- THEN the invited user MUST be added to the specified team upon accepting the invitation

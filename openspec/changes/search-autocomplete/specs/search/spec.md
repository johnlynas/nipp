# Delta for Search

## ADDED Requirements

### Requirement: Organization Search API
The system MUST provide a search endpoint for organizations that returns prefix-matched results.

#### Scenario: Basic Search
- GIVEN a Super Admin sends `GET /api/admin/organizations/search?q=acme`
- WHEN the request is processed
- THEN it MUST return organizations whose `name` starts with "acme" (case-insensitive)
- THEN the response MUST include `id`, `name`, and `slug` for each match
- THEN results MUST be ordered alphabetically by name

#### Scenario: Search with Limit
- GIVEN a Super Admin sends `GET /api/admin/organizations/search?q=a&limit=5`
- WHEN the request is processed
- THEN it MUST return at most 5 results

#### Scenario: Search Limit Maximum
- GIVEN a Super Admin sends `GET /api/admin/organizations/search?q=a&limit=100`
- WHEN the request is processed
- THEN it MUST cap the limit at 50

#### Scenario: Missing Query Parameter
- GIVEN a Super Admin sends `GET /api/admin/organizations/search` (no `q` parameter)
- WHEN the request is processed
- THEN it MUST return a 400 Bad Request error

#### Scenario: Unauthorized Access
- GIVEN an unauthenticated user sends `GET /api/admin/organizations/search?q=acme`
- WHEN the request is processed
- THEN it MUST return a 401 Unauthorized error

#### Scenario: Non-Super Admin Access
- GIVEN a non-Super Admin user sends `GET /api/admin/organizations/search?q=acme`
- WHEN the request is processed
- THEN it MUST return a 403 Forbidden error

#### Scenario: Cache Hit
- GIVEN the search query `q=acme` has been executed previously
- AND the result is still within the 30-second cache TTL
- WHEN `GET /api/admin/organizations/search?q=acme` is called again
- THEN the response MUST be served from L1 cache (no database query)

### Requirement: User Search API
The system MUST provide a search endpoint for users that matches against name or email.

#### Scenario: Name Search
- GIVEN a Super Admin sends `GET /api/admin/users/search?q=john`
- WHEN the request is processed
- THEN it MUST return users whose `name` starts with "john" (case-insensitive)

#### Scenario: Email Search
- GIVEN a Super Admin sends `GET /api/admin/users/search?q=john@example`
- WHEN the request is processed
- THEN it MUST return users whose `email` starts with "john@example" (case-insensitive)

#### Scenario: Combined Match
- GIVEN users exist with name "John Smith" and email "jane@example.com"
- WHEN `GET /api/admin/users/search?q=j` is called
- THEN it MUST return both users (name "John Smith" matches, email "jane@example.com" matches)

#### Scenario: Response Shape
- GIVEN a search query returns results
- WHEN the response is parsed
- THEN each result MUST contain `id`, `name`, and `email` fields

### Requirement: Role Search API
The system MUST provide a search endpoint for roles scoped to an organization.

#### Scenario: Role Name Search
- GIVEN an authenticated user with `roles:view` permission in organization "org123"
- WHEN they send `GET /api/roles/search?q=prop&organizationId=org123`
- THEN it MUST return roles in "org123" whose `name` starts with "prop" (case-insensitive)

#### Scenario: Cross-Organization Isolation
- GIVEN an authenticated user with `roles:view` permission in organization "org123"
- WHEN they send `GET /api/roles/search?q=prop&organizationId=org456`
- AND the user does NOT have `roles:view` permission in "org456"
- THEN it MUST return a 403 Forbidden error

#### Scenario: Missing Organization ID
- GIVEN an authenticated user sends `GET /api/roles/search?q=prop` (no `organizationId`)
- WHEN the request is processed
- THEN it MUST return a 400 Bad Request error

#### Scenario: Response Shape
- GIVEN a role search query returns results
- WHEN the response is parsed
- THEN each result MUST contain `id`, `name`, and `description` fields

### Requirement: Permission Search API
The system MUST provide a search endpoint for permissions that matches against the permission key.

#### Scenario: Permission Key Search
- GIVEN a Super Admin sends `GET /api/admin/permissions/search?q=properties:view`
- WHEN the request is processed
- THEN it MUST return permissions whose `key` starts with "properties:view" (case-insensitive)

#### Scenario: Partial Key Search
- GIVEN permissions exist with keys "properties:view", "properties:create", "tenants:view"
- WHEN `GET /api/admin/permissions/search?q=prop` is called
- THEN it MUST return "properties:view" and "properties:create" (not "tenants:view")

#### Scenario: Response Shape
- GIVEN a permission search query returns results
- WHEN the response is parsed
- THEN each result MUST contain `id`, `key`, `resource`, `action`, and `description` fields

### Requirement: Search Cache Integration
All search endpoints MUST use the L1/L2 hybrid cache layer.

#### Scenario: Cache Key Format
- GIVEN a search request for organizations with `q=acme`
- WHEN the cache key is constructed
- THEN it MUST follow the pattern `search:org:{normalizedQ}` (lowercase, trimmed)

#### Scenario: Cache Key Format — Users
- GIVEN a search request for users with `q=john`
- WHEN the cache key is constructed
- THEN it MUST follow the pattern `search:user:{normalizedQ}` (lowercase, trimmed)

#### Scenario: Cache Key Format — Roles
- GIVEN a search request for roles with `q=prop` and `organizationId=org123`
- WHEN the cache key is constructed
- THEN it MUST follow the pattern `search:role:{organizationId}:{normalizedQ}` (lowercase, trimmed)

#### Scenario: Cache Key Format — Permissions
- GIVEN a search request for permissions with `q=prop:view`
- WHEN the cache key is constructed
- THEN it MUST follow the pattern `search:perm:{normalizedQ}` (lowercase, trimmed)

#### Scenario: Search Cache TTL
- GIVEN a search result is cached via `cacheSet`
- WHEN the cache entry is created
- THEN it MUST have a TTL of 30 seconds

#### Scenario: Cache Write-Through
- GIVEN a search query misses both L1 and L2 caches
- WHEN the database returns results
- THEN the results MUST be written to both L1 and L2 caches

### Requirement: Database Indexing
The system MUST have database indexes on all searchable columns to ensure efficient prefix matching.

#### Scenario: Role Name Index
- GIVEN the Prisma schema includes an index on `Role.name`
- WHEN a migration is applied
- THEN a B-tree index MUST exist on the `name` column of the `Role` table

#### Scenario: Prefix Search Uses Index
- GIVEN a search query executes `WHERE name ILIKE 'prefix%'`
- WHEN the query plan is analyzed (EXPLAIN ANALYZE)
- THEN it MUST use an index scan on the `name` column (not a sequential scan)

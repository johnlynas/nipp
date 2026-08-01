# Search-as-you-Type Autocomplete APIs

**Status:** Proposed  
**Author:** John Lynas  
**Created:** 2026-08-01  
**Last Updated:** 2026-08-01  
**Related Issues:** Cache architecture review (`documents/feature-planning-and-development/cache-upgrades.md`)

## Summary

Implement search-as-you-type autocomplete APIs for Organizations, Users, Roles, and Permissions. Each API accepts a text query parameter and returns matching results in real time as the user types. Results are served from an L1 in-memory cache (populated on first query) to eliminate database round-trips for repeated searches, providing sub-millisecond response times.

## Motivation

The current application has no search-as-you-type capability:

- **Organizations:** The admin list (`/api/admin/organizations`) returns a full paginated list with no search. Users must load all organizations to find one.
- **Users:** No dedicated user search endpoint exists. Finding a specific user requires loading all members or knowing their exact ID.
- **Roles:** No role search endpoint exists. The `/api/roles` route only supports creation, not listing or searching.
- **Permissions:** No permission search endpoint exists. The catalog is only accessible via admin routes with no text filtering.

For a multi-tenant portal with potentially hundreds of organizations and thousands of users, full-list pagination is unusable. Users need instant, incremental search results as they type — the same pattern found in Gmail contacts, Slack channels, and Jira issue selectors.

The L1 cache layer (from `l1-cache-layer` proposal) makes this viable: search queries for common prefixes (e.g., "Acme") will hit the L1 cache on repeat visits, returning results in <0.1ms without any database or Redis round-trip.

## Scope

**In scope:**
- `GET /api/admin/organizations/search` — Search organizations by name (prefix match), returns top N matches
- `GET /api/admin/users/search` — Search users by name or email (prefix match), returns top N matches
- `GET /api/roles/search` — Search roles by name within the user's organization (prefix match), returns top N matches
- `GET /api/admin/permissions/search` — Search permissions by key or description (prefix match), returns top N matches
- L1 cache integration for all search endpoints — results cached by query string key
- Debounced client-side usage pattern (documented, not implemented in API)
- Unit tests for all search endpoints and cache integration

**Out of scope (Non-goals):**
- Full-text search with fuzzy matching, typos, or relevance scoring (prefix match only)
- Search result pagination (returns top N results; use `limit` query param to adjust)
- Advanced filters (e.g., search by org status, user role, etc.) — can be added later
- Client-side autocomplete UI components (React hooks/components) — APIs are backend-only; UI is a separate effort
- Real-time search result updates (results are cached; stale data window is bounded by L1 TTL)

## Detailed Design Overview

Each search endpoint follows a consistent pattern:
1. Accept a `q` query parameter (search text) and optional `limit` (default 10, max 50).
2. Build a cache key from the normalized query: `search:{resource}:{normalizedQ}`.
3. Check L1 cache via the hybrid layer — if hit, return immediately.
4. If miss, execute a Prisma query with `startsWith` (case-insensitive via `mode: 'insensitive'`).
5. Write results through to both L1 and L2 caches with a 30-second TTL (search results are relatively stable).
6. Return JSON array of matching records with minimal fields (id, name/key, and one or two context fields).

All endpoints require appropriate authentication/authorization. Admin search endpoints (`/api/admin/*`) require Super Admin role. Org-scoped endpoints (`/api/roles/search`) require membership in the target organization with `roles:view` permission.

## Files to Create or Modify

| Type | File Path | Purpose |
|------|-----------|---------|
| New | `app/api/admin/organizations/search/route.ts` | Organization search endpoint |
| New | `app/api/admin/users/search/route.ts` | User search endpoint |
| New | `app/api/roles/search/route.ts` | Role search endpoint (org-scoped) |
| New | `app/api/admin/permissions/search/route.ts` | Permission search endpoint |
| Modified | `lib/cache/hybrid.ts` | Add TTL option for search-specific caching (30s) |
| New | `tests/unit/search/organizations.test.ts` | Unit tests for org search |
| New | `tests/unit/search/users.test.ts` | Unit tests for user search |
| New | `tests/unit/search/roles.test.ts` | Unit tests for role search |
| New | `tests/unit/search/permissions.test.ts` | Unit tests for permission search |

## Testing Plan

- **Unit tests:** Each endpoint tested with valid queries, empty queries, special characters, and cache hit/miss scenarios
- **Integration tests:** Verify database queries return correct prefix-matched results; verify cache write-through
- **Manual testing:** Start app locally, hit each search endpoint with various queries, verify response format and latency

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Database `startsWith` on large tables is slow | Medium | Add database indexes on searchable columns (`name`, `email`, `key`) |
| L1 cache stores many unique query keys (cache bloat) | Medium | Limit max entries in search sub-cache; use 30s TTL to auto-evict stale queries |
| Case sensitivity issues in search | Low | Use Prisma `mode: 'insensitive'` for all prefix matches |
| Authorization bypass on search endpoints | High | Apply same auth middleware as existing admin routes (`withSuperAdmin`, session checks) |

## Acceptance Criteria

- [ ] `GET /api/admin/organizations/search?q=acme` returns organizations whose name starts with "acme" (case-insensitive)
- [ ] `GET /api/admin/users/search?q=john` returns users whose name or email starts with "john" (case-insensitive)
- [ ] `GET /api/roles/search?q=prop` returns roles in the user's org whose name starts with "prop" (case-insensitive)
- [ ] `GET /api/admin/permissions/search?q=prop:view` returns permissions whose key starts with "prop:view" (case-insensitive)
- [ ] All search endpoints return results from L1 cache on repeat queries (verified via metrics)
- [ ] All search endpoints require appropriate authentication/authorization
- [ ] Search results are limited to top N matches (default 10, configurable via `limit` param, max 50)
- [ ] All unit tests pass; integration tests verify cache write-through

# Design: Search-as-you-Type Autocomplete APIs

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Client (Autocomplete Input)                        │
│       │                                             │
│       │ GET /api/admin/organizations/search?q=acme  │
│       ▼                                             │
│  ┌─────────────────────────────────────┐            │
│  │ Next.js API Route (Node Runtime)    │            │
│  │                                     │            │
│  │ 1. Auth check (withSuperAdmin)      │            │
│  │ 2. Normalize query: q → lowercase   │            │
│  │ 3. Build cache key: search:org:{q}  │            │
│  │                                     │            │
│  │  ┌──────────────┐                   │            │
│  │  │ L1: In-Mem   │── HIT ──▶ Return  │            │
│  │  │ Cache        │                   │            │
│  │  └──────┬───────┘                   │            │
│  │         │ MISS                      │            │
│  │         ▼                           │            │
│  │  ┌──────────────┐                   │            │
│  │  │ L2: Redis    │── HIT ──▶ Return  │            │
│  │  │ (30s TTL)    │                   │            │
│  │  └──────┬───────┘                   │            │
│  │         │ MISS                      │            │
│  │         ▼                           │            │
│  │  ┌──────────────┐                   │            │
│  │  │ Prisma       │──▶ DB query      │            │
│  │  │ startsWith   │   (case-insensitive)           │
│  │  └──────┬───────┘                   │            │
│  │         │                           │            │
│  │         ▼ (write-through)           │            │
│  │  ┌──────────────┐    ┌──────────┐   │            │
│  │  │ L1: In-Mem   │◀───│ L2: Redis│   │            │
│  │  └──────────────┘    └──────────┘   │            │
│  └─────────────────────────────────────┘            │
│       │                                             │
│       ▼ JSON Response                               │
│  { results: [{ id, name, ... }], total: N }         │
└─────────────────────────────────────────────────────┘
```

## Technical Decisions

### Decision 1: Prefix matching with `startsWith` (not full-text search)

**Context:** Search-as-you-type benefits from prefix matching — as the user types "Acme", they want results starting with "Acme". Full-text search (PostgreSQL `tsvector`, pg_trgm) adds complexity and is overkill for autocomplete.

**Decision:** Use Prisma's `startsWith` with `mode: 'insensitive'` for all search queries.

**Rationale:**
- Simple, predictable behavior — matches what users expect from autocomplete
- PostgreSQL indexes on `startsWith` columns are efficient (B-tree prefix scan)
- No need for full-text search infrastructure (pg_trgm, tsvector)
- Sufficient for the expected data volumes (hundreds to low thousands of records per entity)

**Alternatives considered:**
- Full-text search with relevance scoring — rejected: over-engineering for autocomplete; adds complexity and maintenance burden
- `ILIKE '%query%'` — rejected: cannot use indexes, O(N) scan on every query
- Fuzzy matching (Levenshtein distance) — rejected: too slow for real-time autocomplete; typos are rare in autocomplete (user corrects by retyping)

### Decision 2: 30-second TTL for search results (shorter than permission cache)

**Context:** Search results are query-specific and can become stale quickly as data changes (new orgs created, users added). Unlike permission caches (5-min TTL), search results should have a shorter lifetime.

**Decision:** Use 30-second TTL for all search result caches.

**Rationale:**
- Search results are ephemeral — a query for "Acme" today may return different results tomorrow
- 30 seconds is short enough that stale data is unlikely to cause issues in an autocomplete context
- Longer TTLs would increase cache hit rates but risk showing outdated results (e.g., an org that was just deleted)
- The L1 cache's 60-second max TTL is longer than the search TTL, so Redis (30s) becomes stale first — this is fine because L1 will return the 30s Redis value on miss

**Alternatives considered:**
- Match permission cache TTL (5 min) — rejected: search results change more frequently; stale data is more visible in autocomplete
- No TTL, only explicit invalidation — rejected: search queries are high-cardinality (each unique query is a different key); explicit invalidation is impractical

### Decision 3: Return minimal result fields (id + name/key + context)

**Context:** Autocomplete dropdowns display a compact list. Returning full entity objects wastes bandwidth and memory in the cache.

**Decision:** Each search endpoint returns only the fields needed for display:
- Organizations: `{ id, name, slug }`
- Users: `{ id, name, email }`
- Roles: `{ id, name, description }`
- Permissions: `{ id, key, resource, action, description }`

**Rationale:**
- Minimal payload reduces network transfer and cache memory usage
- If the user selects a result, a separate detail endpoint can fetch full data
- Consistent response shape across all search endpoints

**Alternatives considered:**
- Return full entity objects — rejected: unnecessary data transfer; cache memory waste
- Return only IDs — rejected: client would need a second API call to get display names; defeats the purpose of autocomplete

### Decision 4: Limit results to top N (default 10, max 50)

**Context:** Autocomplete dropdowns should not render hundreds of results. Limiting the result set improves UX and reduces cache/memory pressure.

**Decision:** Default limit of 10 results, configurable via `limit` query parameter (range: 1–50).

**Rationale:**
- 10 results is a standard autocomplete pattern (Gmail, Slack, Jira all use similar limits)
- `limit` parameter allows clients to adjust based on context (e.g., show 5 in a dropdown, 20 in a sidebar)
- `LIMIT` clause in SQL is efficient — PostgreSQL stops scanning after N matches

**Alternatives considered:**
- Return all matches — rejected: poor UX for large result sets; cache memory waste
- Fixed limit of 10 — rejected: less flexible for different UI contexts

### Decision 5: Consistent endpoint structure across all resources

**Context:** Four search endpoints will be created. They should follow a consistent pattern for maintainability and client-side code reuse.

**Decision:** All endpoints follow the same structure:
- Path pattern: `/api/{scope}/{resource}/search`
- Query params: `q` (required, search text), `limit` (optional, default 10)
- Response shape: `{ results: T[], total: number }`
- Auth: Admin endpoints use `withSuperAdmin`; org-scoped endpoints use session + permission check

**Rationale:**
- Predictable API design reduces client-side complexity
- Shared TypeScript types for response shape
- Consistent error handling (400 for missing `q`, 401/403 for auth failures)

## Data Flow

### Organization Search (Admin)

1. **Request:** `GET /api/admin/organizations/search?q=acme&limit=5`
2. **Auth:** `withSuperAdmin` middleware validates Super Admin session
3. **Cache key:** `search:org:acme` (normalized lowercase)
4. **L1 check → L2 check → DB query:** `WHERE name ILIKE 'acme%' ORDER BY name LIMIT 5`
5. **Response:** `[{ id, name, slug }, ...]`

### User Search (Admin)

1. **Request:** `GET /api/admin/users/search?q=john`
2. **Auth:** `withSuperAdmin` middleware validates Super Admin session
3. **Cache key:** `search:user:john` (normalized lowercase)
4. **L1 check → L2 check → DB query:** `WHERE name ILIKE 'john%' OR email ILIKE 'john%' ORDER BY name LIMIT 10`
5. **Response:** `[{ id, name, email }, ...]`

### Role Search (Org-scoped)

1. **Request:** `GET /api/roles/search?q=prop&organizationId=abc123`
2. **Auth:** Session validation + `roles:view` permission check in target org
3. **Cache key:** `search:role:abc123:prop` (normalized lowercase, includes orgId)
4. **L1 check → L2 check → DB query:** `WHERE organizationId = 'abc123' AND name ILIKE 'prop%' ORDER BY name LIMIT 10`
5. **Response:** `[{ id, name, description }, ...]`

### Permission Search (Admin)

1. **Request:** `GET /api/admin/permissions/search?q=prop:view`
2. **Auth:** `withSuperAdmin` middleware validates Super Admin session
3. **Cache key:** `search:perm:prop:view` (normalized lowercase)
4. **L1 check → L2 check → DB query:** `WHERE key ILIKE 'prop:view%' ORDER BY key LIMIT 10`
5. **Response:** `[{ id, key, resource, action, description }, ...]`

## Component Specifications

### `app/api/admin/organizations/search/route.ts`

**Purpose:** Search organizations by name (prefix match).

**Auth:** `withSuperAdmin` middleware.

**Query params:**
- `q`: string (required) — search text, trimmed and lowercased
- `limit`: number (optional, default 10, max 50)

**Response:**
```typescript
interface OrganizationSearchResult {
  id: string;
  name: string;
  slug: string | null;
}

interface OrganizationSearchResponse {
  results: OrganizationSearchResult[];
  total: number; // total matches (ignoring limit)
}
```

**Cache key:** `search:org:{normalizedQ}`  
**TTL:** 30 seconds

### `app/api/admin/users/search/route.ts`

**Purpose:** Search users by name or email (prefix match).

**Auth:** `withSuperAdmin` middleware.

**Query params:**
- `q`: string (required) — search text, trimmed and lowercased
- `limit`: number (optional, default 10, max 50)

**Response:**
```typescript
interface UserSearchResult {
  id: string;
  name: string;
  email: string;
}

interface UserSearchResponse {
  results: UserSearchResult[];
  total: number;
}
```

**Cache key:** `search:user:{normalizedQ}`  
**TTL:** 30 seconds

### `app/api/roles/search/route.ts`

**Purpose:** Search roles by name within the user's organization (prefix match).

**Auth:** Session validation + `roles:view` permission check in target org.

**Query params:**
- `q`: string (required) — search text, trimmed and lowercased
- `organizationId`: string (required) — target organization ID
- `limit`: number (optional, default 10, max 50)

**Response:**
```typescript
interface RoleSearchResult {
  id: string;
  name: string;
  description: string | null;
}

interface RoleSearchResponse {
  results: RoleSearchResult[];
  total: number;
}
```

**Cache key:** `search:role:{organizationId}:{normalizedQ}`  
**TTL:** 30 seconds

### `app/api/admin/permissions/search/route.ts`

**Purpose:** Search permissions by key or description (prefix match).

**Auth:** `withSuperAdmin` middleware.

**Query params:**
- `q`: string (required) — search text, trimmed and lowercased
- `limit`: number (optional, default 10, max 50)

**Response:**
```typescript
interface PermissionSearchResult {
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string | null;
}

interface PermissionSearchResponse {
  results: PermissionSearchResult[];
  total: number;
}
```

**Cache key:** `search:perm:{normalizedQ}`  
**TTL:** 30 seconds

## Database Index Requirements

To ensure `startsWith` queries are efficient, the following indexes should exist (or be added via migration):

| Table | Column | Index Type | Purpose |
|-------|--------|------------|---------|
| `Organization` | `name` | B-tree (existing) | Org name prefix search |
| `User` | `name` | B-tree (existing) | User name prefix search |
| `User` | `email` | B-tree (existing) | User email prefix search |
| `Role` | `name` | B-tree (new) | Role name prefix search |
| `Permission` | `key` | B-tree (existing) | Permission key prefix search |

**Note:** Prisma's `startsWith` with `mode: 'insensitive'` uses PostgreSQL's `ILIKE 'prefix%'` which can leverage B-tree indexes (unlike `%suffix%` or `%middle%`). The `Role.name` index is the only new one needed.

## Security Considerations

- All admin search endpoints require Super Admin authentication (`withSuperAdmin`)
- Org-scoped role search requires session validation + `roles:view` permission in the target organization
- Query parameter `q` is validated (non-empty, max 100 characters) to prevent abuse
- Cache keys include user/org context where applicable — no cross-org data leakage
- Search results are limited to prevent information disclosure (max 50 per query)

## Performance Considerations

| Metric | Expected Value |
|--------|---------------|
| L1 cache hit latency | <0.1ms |
| L2 (Redis) hit latency | ~5ms |
| DB query latency (with index) | ~2–10ms (depending on table size) |
| Cache TTL for search results | 30 seconds |
| Max cache entries per query type | Bounded by L1 max (1000 total) |
| Max results per query | 50 (configurable, default 10) |

## Dependencies

This proposal depends on the `l1-cache-layer` change being implemented first. The search endpoints use:
- `lib/cache/hybrid.ts` for L1→L2 read/write orchestration
- `lib/cache/lru.ts` for the in-memory cache singleton
- `lib/permissions/resolver.ts` patterns for auth middleware integration

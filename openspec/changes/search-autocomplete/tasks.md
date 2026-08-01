# Tasks: Search-as-you-Type Autocomplete APIs

## Phase 1: Database Indexes
- [ ] **Task 1.1:** Add B-tree index on `Role.name` column in Prisma schema (`prisma/schema.prisma`)
- [ ] **Task 1.2:** Generate and apply Prisma migration for the new index (`npx prisma migrate dev`)
- [ ] **Task 1.3:** Verify existing indexes on `Organization.name`, `User.name`, `User.email`, `Permission.key` exist

## Phase 2: Organization Search Endpoint
- [ ] **Task 2.1:** Create `app/api/admin/organizations/search/route.ts` — GET handler with `withSuperAdmin` auth
- [ ] **Task 2.2:** Implement query validation: `q` (required, trimmed, max 100 chars), `limit` (optional, default 10, max 50)
- [ ] **Task 2.3:** Build cache key `search:org:{normalizedQ}` and use hybrid layer (`cacheGet`/`cacheSet`) with 30s TTL
- [ ] **Task 2.4:** Execute Prisma query: `WHERE name ILIKE '{q}%' ORDER BY name LIMIT {limit}`
- [ ] **Task 2.5:** Return response: `{ results: [{ id, name, slug }], total: count }`
- [ ] **Task 2.6:** Write unit tests — valid query, empty query (400), auth failure (401/403), cache hit, cache miss

## Phase 3: User Search Endpoint
- [ ] **Task 3.1:** Create `app/api/admin/users/search/route.ts` — GET handler with `withSuperAdmin` auth
- [ ] **Task 3.2:** Implement query validation (same as org search)
- [ ] **Task 3.3:** Build cache key `search:user:{normalizedQ}` and use hybrid layer with 30s TTL
- [ ] **Task 3.4:** Execute Prisma query: `WHERE name ILIKE '{q}%' OR email ILIKE '{q}%' ORDER BY name LIMIT {limit}`
- [ ] **Task 3.5:** Return response: `{ results: [{ id, name, email }], total: count }`
- [ ] **Task 3.6:** Write unit tests — valid query, empty query (400), auth failure, cache hit/miss

## Phase 4: Role Search Endpoint
- [ ] **Task 4.1:** Create `app/api/roles/search/route.ts` — GET handler with session + permission check
- [ ] **Task 4.2:** Implement query validation: `q` (required), `organizationId` (required), `limit` (optional)
- [ ] **Task 4.3:** Validate user has `roles:view` permission in the target organization (reuse `resolvePermissions`)
- [ ] **Task 4.4:** Build cache key `search:role:{organizationId}:{normalizedQ}` and use hybrid layer with 30s TTL
- [ ] **Task 4.5:** Execute Prisma query: `WHERE organizationId = '{orgId}' AND name ILIKE '{q}%' ORDER BY name LIMIT {limit}`
- [ ] **Task 4.6:** Return response: `{ results: [{ id, name, description }], total: count }`
- [ ] **Task 4.7:** Write unit tests — valid query, missing orgId (400), insufficient permission (403), cache hit/miss

## Phase 5: Permission Search Endpoint
- [ ] **Task 5.1:** Create `app/api/admin/permissions/search/route.ts` — GET handler with `withSuperAdmin` auth
- [ ] **Task 5.2:** Implement query validation (same as org search)
- [ ] **Task 5.3:** Build cache key `search:perm:{normalizedQ}` and use hybrid layer with 30s TTL
- [ ] **Task 5.4:** Execute Prisma query: `WHERE key ILIKE '{q}%' ORDER BY key LIMIT {limit}`
- [ ] **Task 5.5:** Return response: `{ results: [{ id, key, resource, action, description }], total: count }`
- [ ] **Task 5.6:** Write unit tests — valid query, empty query (400), auth failure, cache hit/miss

## Phase 6: Testing & Validation
- [ ] **Task 6.1:** Run full test suite (`npm run test:all`) — ensure no regressions
- [ ] **Task 6.2:** Run type checking (`npm run type-check`) — ensure TypeScript strict mode passes
- [ ] **Task 6.3:** Run linting (`npm run lint`) — ensure no lint errors
- [ ] **Task 6.4:** Manual integration test — start app with Redis, hit each search endpoint, verify L1 cache metrics improve on repeat queries
- [ ] **Task 6.5:** Manual integration test — verify database query plans use indexes (explain analyze on search queries)

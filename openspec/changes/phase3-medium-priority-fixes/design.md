# Phase 3 Medium Priority Fixes - Design

## Architecture Overview

This change implements fixes for 6 medium-priority findings across performance, code quality, and security categories.

## Design Decisions

### 1. [P3] Session Invalidation Optimization
**Decision:** Use Redis batch DEL instead of sequential deletes.

**Rationale:** 
- Redis `DEL` accepts multiple keys as arguments
- Single network round-trip vs N round-trips
- No change to application logic, just optimization

**Trade-offs:**
- Minimal risk - drop-in replacement
- No backward compatibility concerns

### 2. [P7] API Route Caching & Invalidation
**Decision:** Use Next.js `revalidate` for static data, `unstable_cache` with tags for dynamic data.

**Rationale:**
- Built-in to Next.js, no external dependencies
- Conservative values (10-60s) minimize stale data risk
- User-specific routes explicitly set to `revalidate: 0`
- Dynamic routes use `unstable_cache` with tags for targeted invalidation on mutations

**Trade-offs:**
- Some data may be up to 60s stale (acceptable for role/permission catalogs)
- Mutation routes call `revalidateTag()` to ensure cache freshness after changes

### 3. [P9] RequirePermission Hooks Fix
**Decision:** Call all hooks unconditionally, use conditional logic for results.

**Rationale:**
- Complies with React's rules of hooks
- Hooks still return correct values based on input
- Empty defaults for unused hooks have no side effects

**Trade-offs:**
- Slight performance impact (unnecessary hook calls)
- Negligible for typical usage patterns

### 4. [S9] CSP unsafe-inline — Partial Implementation
**Decision:** Convert component inline styles to Tailwind, but keep `'unsafe-inline'` in CSP.

**Rationale:**
- React/Next.js dynamically apply inline styles at runtime (layout, transitions, animations)
- These internal React styles cannot be given nonces
- Removing `'unsafe-inline'` breaks the UI (white boxes, broken layouts)

**Trade-offs:**
- Partially addressed: Converted login page and ConfirmDialog to Tailwind
- `'unsafe-inline'` remains for React/Next.js runtime inline styles
- Future components should avoid inline styles to reduce attack surface

### 5. [S10] Health Endpoint Data Exposure Prevention
**Decision:** Remove version from response while keeping endpoint public.

**Rationale:**
- Endpoint must remain publicly accessible for monitoring systems
- Version aids attacker reconnaissance (reconnaissance data)
- Removed version, kept uptime as it's useful for admins

**Trade-offs:**
- Monitoring systems lose version data (acceptable trade-off)
- No configuration changes required
- Simple, low-risk change

### 6. [S12] Permission RLS Policy Fix
**Decision:** Organization-scoped RLS policy with platform admin override.

**Rationale:**
- Follows existing pattern used for other tables (Member, Role)
- Platform admins can still read all permissions
- Regular users restricted to their org's permissions

**Trade-offs:**
- Requires database migration
- Existing queries should continue to work (they already filter by orgId)

## Migration Plan

1. Deploy code changes
2. Run database migration for S12
3. Monitor for any caching issues (P7)

## Rollback Plan

All changes are backward compatible:
- P3: Batch DEL works same as sequential
- P7: `revalidate` and `unstable_cache` can be removed if issues arise
- P9: Hooks still return same values
- S9: Can revert to `'unsafe-inline'` if needed (already done)
- S10: Removed version, kept uptime - minimal impact
- S12: Migration can be rolled back if needed

# Design: Fix Super Admin Auth Bypass

## Architecture Overview
This design eliminates the email-based authorization fallback in admin API routes by enforcing database-only verification. When the database is unavailable, the system fails closed (denies access) rather than falling back to a static email check.

## Data Flow
1. **Request arrives** → Admin API route handler executes
2. **Authorization check** → `verifySuperAdmin()` queries the database for Platform Organization membership
3. **Success path** → User has valid membership → Request proceeds to business logic
4. **Failure path (DB error)** → Database unavailable or query fails → Log at `error` level, return `503 Service Unavailable`, deny access
5. **Failure path (No membership)** → User lacks Platform Org membership → Return `403 Forbidden`

## Technical Decisions

### 1. Centralized Authorization Utility
Create a dedicated function `verifySuperAdmin()` in `lib/authz.ts` that:
- Queries the database for Platform Organization membership using the existing `getPlatformOrgId()` function
- Wraps the query in a try/catch that logs errors at `error` level and returns `{ authorized: false, error: string }`
- Provides a consistent interface for all admin routes

```typescript
export async function verifySuperAdmin(userId: string): Promise<{ authorized: boolean; error?: string }> {
  try {
    const platformOrgId = await getPlatformOrgId();
    if (!platformOrgId) {
      return { authorized: false, error: 'Platform organization not configured' };
    }

    const member = await prisma.member.findFirst({
      where: { userId, orgId: platformOrgId },
    });

    return { authorized: !!member };
  } catch (error) {
    logger.error({ error, userId }, 'Super admin verification failed');
    return { authorized: false, error: 'Authorization service unavailable' };
  }
}
```

### 2. Fail-Closed Error Handling
When `verifySuperAdmin()` returns `{ authorized: false }`:
- Return HTTP 503 if the error was database-related (`Authorization service unavailable`)
- Return HTTP 401/403 if the user lacks membership (`Forbidden: Super Admin access required`)
- Never fall back to email-based checks

### 3. Logging Strategy
Use the existing structured logger (`lib/logger.ts`) to log authorization failures:
- Log at `error` level when database is unavailable (indicates system issue)
- Log at `warn` level when user lacks membership (normal access denial)
- Include userId, timestamp, and error context for auditability

### 4. Route Handler Updates
Replace all `try/catch` fallback patterns with calls to `verifySuperAdmin()`:

**Before:**
```typescript
try {
  const platformOrgId = await getPlatformOrgId();
  const superAdminCheck = await prisma.member.findFirst({ ... });
  isSuperAdmin = !!superAdminCheck;
} catch (error) {
  const knownSuperAdminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
  isSuperAdmin = userEmail === knownSuperAdminEmail; // ← Bypass
}
```

**After:**
```typescript
const { authorized, error } = await verifySuperAdmin(session.user.id);

if (!authorized) {
  if (error === 'Authorization service unavailable') {
    return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
  }
  return NextResponse.json({ error: 'Forbidden: Super Admin access required' }, { status: 403 });
}
```

## Security Considerations
- **No Hardcoded Defaults:** The `SUPER_ADMIN_EMAIL` environment variable is no longer used for authorization. If unset, the system simply denies access during DB errors.
- **Fail-Closed by Design:** Database unavailability results in denied access, not granted privileges. This aligns with security best practices for authorization systems.
- **Audit Trail:** All authorization failures are logged with sufficient context for security monitoring and incident response.

## Migration Path
1. Deploy the centralized `verifySuperAdmin()` utility
2. Update admin routes to use the new function (no behavioral change for healthy systems)
3. Verify fail-closed behavior in staging with simulated DB outage
4. Deploy to production

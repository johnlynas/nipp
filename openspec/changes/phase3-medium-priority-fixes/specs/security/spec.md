# Security Specifications - Phase 3 Fixes

## S9: Content Security Policy - Style Nonce Enforcement

### Requirement
The application must not allow `'unsafe-inline'` in the `style-src` CSP directive.

### Implementation
- Middleware generates a nonce for each request
- Nonce is included in `style-src` directive: `style-src 'self' 'nonce-${nonce}'`
- All inline styles converted to Tailwind CSS classes

### Verification
```bash
# Check CSP header in browser devtools or curl:
curl -I http://localhost:3000/login | grep content-security-policy
# Should NOT contain 'unsafe-inline' in style-src
```

---

## S10: Health Endpoint Data Exposure Prevention

### Requirement
The `/api/health` endpoint must not expose sensitive information (version, uptime, connection details) to external callers.

### Implementation
- External callers receive minimal response: `{ status }`
- Internal callers (with valid `x-internal-token`) receive full response including version, uptime, and detailed checks
- Token configured via `INTERNAL_HEALTH_TOKEN` environment variable

### Verification
```bash
# External call - should return minimal response
curl http://localhost:3000/api/health | jq .
# Expected: {"status":"healthy"}

# Internal call - should return full response  
curl -H "x-internal-token: $INTERNAL_HEALTH_TOKEN" http://localhost:3000/api/health | jq .
# Expected: {"status":"healthy","timestamp":"...","version":"0.1.0","uptime":12345,"checks":{...}}
```

---

## S12: Permission Table RLS Policy

### Requirement
The `Permission` table must have organization-scoped RLS that prevents users from enumerating the entire permission catalog.

### Implementation
- Old policy `permission_read_all` (USING true) replaced with `permission_org_isolation`
- New policy allows:
  - Users to read permissions in their own organization
  - Platform admins (members of platform org) to read all permissions

### Verification
```sql
-- As regular user in org-123:
SET app.current_org_id = 'org-123';
SELECT * FROM "Permission"; -- Should only return org-123 permissions

-- As platform admin:
SET app.current_org_id = 'org-platform';
SELECT * FROM "Permission"; -- Should return all permissions
```

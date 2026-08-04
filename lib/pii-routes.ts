/**
 * PII route configuration and matching.
 *
 * Provides exact and parameterized route matching with:
 * - Trailing slash normalization
 * - Query string stripping
 * - Case-sensitive matching
 * - No prefix overmatching (e.g. /api/passports does not match /api/passports-public)
 */

// ---------------------------------------------------------------------------
// Route patterns — add PII routes here as they are identified
// ---------------------------------------------------------------------------

/**
 * List of PII route patterns.
 * Supports exact paths and path parameters (e.g., :id).
 */
export const PII_ROUTE_PATTERNS: string[] = [
  // User management routes (contain names, emails)
  '/api/admin/users/search',

  // Organization member management routes (contain names, emails)
  '/api/admin/organizations/:orgId/members',
  '/api/admin/organizations/:orgId/members/:memberId',

  // Organization routes (contain adminEmail, member lists with PII)
  '/api/admin/organizations',
  '/api/admin/organizations/:orgId',

  // Auth routes (contain user identity data)
  '/api/auth/user-permissions',

  // Audit log routes (contain user names, emails, actions)
  '/api/admin/audit-logs',

  // System log routes (contain user agents, IPs)
  '/api/admin/system-logs',



  // Add more PII routes here as they are identified:
  // '/api/passports',
  // '/api/personal-details',
  // '/api/personal-details/:id',
];

// ---------------------------------------------------------------------------
// Route matcher
// ---------------------------------------------------------------------------

/**
 * Normalize a request path for matching:
 * - Strip query string
 * - Remove trailing slash (except root)
 */
function normalizePath(pathname: string): string {
  // Strip query string
  const clean = pathname.split('?')[0];

  // Remove trailing slash (except root)
  if (clean.length > 1 && clean.endsWith('/')) {
    return clean.slice(0, -1);
  }

  return clean;
}

/**
 * Check if a normalized path matches a route pattern.
 * Supports exact paths and patterns with :param segments.
 */
function matchesPattern(pathname: string, pattern: string): boolean {
  const pathParts = pathname.split('/').filter(Boolean);
  const patternParts = pattern.split('/').filter(Boolean);

  // Different segment counts → no match
  if (pathParts.length !== patternParts.length) {
    return false;
  }

  // Check each segment
  for (let i = 0; i < pathParts.length; i++) {
    const patternSegment = patternParts[i];

    if (patternSegment.startsWith(':')) {
      // Parameter segment — matches anything
      continue;
    }

    if (pathParts[i] !== patternSegment) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a request path matches any configured PII route.
 */
export function isPiiRoute(pathname: string): boolean {
  const normalized = normalizePath(pathname);

  return PII_ROUTE_PATTERNS.some((pattern) => matchesPattern(normalized, pattern));
}

/**
 * Get the matching PII route pattern for a path (for logging/debugging).
 */
export function getPiiRoutePattern(pathname: string): string | null {
  const normalized = normalizePath(pathname);

  for (const pattern of PII_ROUTE_PATTERNS) {
    if (matchesPattern(normalized, pattern)) {
      return pattern;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Prefix-overmatch guard
// ---------------------------------------------------------------------------

/**
 * Validate that no PII route pattern is a prefix of another, and that none
 * matches known non-PII routes. Call this during module initialization so
 * misconfigurations are caught at startup rather than in production.
 */
function validateRoutePatterns(): void {
  // Check that no pattern is a prefix of another (e.g. /api/admin should not
  // coexist with /api/admin/organizations).
  for (let i = 0; i < PII_ROUTE_PATTERNS.length; i++) {
    for (let j = 0; j < PII_ROUTE_PATTERNS.length; j++) {
      if (i === j) continue;
      const aParts = PII_ROUTE_PATTERNS[i].split('/').filter(Boolean);
      const bParts = PII_ROUTE_PATTERNS[j].split('/').filter(Boolean);

      // a is a prefix of b if all of a's segments match the start of b.
      let isPrefix = true;
      for (let k = 0; k < aParts.length; k++) {
        if (aParts[k] !== bParts[k]) {
          isPrefix = false;
          break;
        }
      }
      if (isPrefix && aParts.length < bParts.length) {
        console.warn(
          `[PII Routes] Pattern "${PII_ROUTE_PATTERNS[i]}" is a prefix of "${PII_ROUTE_PATTERNS[j]}", ` +
            'which may cause unintended overmatching.',
        );
      }
    }
  }

  // Check that no pattern matches known non-PII routes.
  const nonPiiRoutes = ['/api/health', '/api/auth/[...all]', '/api/security/payload-key'];
  for (const nonPii of nonPiiRoutes) {
    if (isPiiRoute(nonPii)) {
      console.warn(
        `[PII Routes] Pattern list matches non-PII route "${nonPii}" — this may cause ` +
          'unnecessary encryption overhead.',
      );
    }
  }
}

// Run validation at module load time.
validateRoutePatterns();

// ---------------------------------------------------------------------------
// Unit test helpers (exported for testing)
// ---------------------------------------------------------------------------

/** Normalize a path — exported for testing. */
export { normalizePath };

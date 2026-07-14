# Proposal: NIPP Health Endpoint

## Intent
This proposal outlines the addition of a `/api/health` endpoint to the Property NI portal. The primary goal is to provide a standardized health check response for use by load balancers, container orchestrators (Docker/Kubernetes), and uptime monitoring services.

### Motivation
**Current State:** The application currently has no dedicated health check endpoint. Monitoring services and load balancers have no reliable way to determine if the application is running correctly beyond checking if the HTTP server responds.

**Problems This Solves:**
1. **No Liveness Check:** Container orchestrators cannot distinguish between a running app and a crashed/unresponsive app.
2. **No Readiness Check:** Load balancers cannot determine if the application is ready to accept traffic (e.g., database connected, Redis available).
3. **No Dependency Monitoring:** There is no single endpoint that reports the status of critical downstream services (PostgreSQL, Redis).
4. **Code Review Recommendation:** The original architecture review identified this as a "Quick Win" for production readiness.

## Scope
**In scope:**
- Creation of `GET /api/health` endpoint in Next.js App Router.
- Database connectivity check (`SELECT 1`) with timeout handling.
- Redis connectivity check (`PING`) with graceful degradation (non-critical if Redis is optional).
- Standardized JSON response format including `status`, `timestamp`, `version`, `uptime`, and `checks`.
- Exclusion of `/api/health` from session validation in `middleware.ts` (added to `PUBLIC_PATTERNS`).
- Unit tests mocking Prisma and Redis clients.
- Integration tests against real PostgreSQL and Redis instances.

**Out of scope:**
- Advanced metrics collection (CPU, memory, request latency).
- Authentication or authorization for the health endpoint.
- Complex dependency checks (e.g., S3, external APIs).
- Rate limiting implementation (deferred to future proposal if abuse is detected).

## Detailed Design & Approach

### Endpoint Specification
- **Path:** `GET /api/health`
- **Authentication:** None (must be accessible without a session)
- **Middleware:** Excluded from session validation in `middleware.ts` via `PUBLIC_PATTERNS`
- **Cache Headers:** `Cache-Control: no-store, no-cache`

### Response Format

#### Healthy Response (HTTP 200)
```json
{
  "status": "healthy",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 12
    },
    "cache": {
      "status": "healthy",
      "latency_ms": 3
    }
  }
}
```

#### Degraded Response (HTTP 200)
Non-critical checks fail (e.g., Redis is down but database is up).
```json
{
  "status": "degraded",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "healthy",
      "latency_ms": 12
    },
    "cache": {
      "status": "unhealthy",
      "error": "Connection refused"
    }
  }
}
```

#### Unhealthy Response (HTTP 503)
Critical checks fail (e.g., database is unreachable).
```json
{
  "status": "unhealthy",
  "timestamp": "2026-07-14T12:00:00.000Z",
  "version": "0.1.0",
  "uptime": 3600,
  "checks": {
    "database": {
      "status": "unhealthy",
      "error": "Connection timeout after 5000ms"
    },
    "cache": {
      "status": "unhealthy",
      "error": "Connection refused"
    }
  }
}
```

### Health Check Logic
1. **Database Check:** Execute `prisma.$queryRaw`SELECT 1`` with a 5-second timeout.
2. **Redis Check:** Execute `redis.ping()` with a 3-second timeout (only if Redis is configured in environment).
3. **Status Determination:**
   - `healthy`: All checks pass.
   - `degraded`: Non-critical checks fail (e.g., Redis is down but database is up).
   - `unhealthy`: Critical checks fail (e.g., database is unreachable).

### Security Considerations
- **No Authentication:** The endpoint must be publicly accessible for load balancer health checks.
- **No Sensitive Data:** The response must NOT expose database connection strings, internal IPs, stack traces, or environment variables.
- **Rate Limiting:** Consider adding basic rate limiting to prevent abuse (e.g., max 10 requests/second per IP) in a future iteration if needed.
- **Middleware Exclusion:** The path `/api/health` must be added to `PUBLIC_PATTERNS` in `middleware.ts` to bypass session validation.

## Testing Plan
1. **Unit Tests:** Mock Prisma and Redis to test all three response states (`healthy`, `degraded`, `unhealthy`). Verify correct HTTP status codes and JSON structure.
2. **Integration Tests:** Run against real PostgreSQL and Redis instances to verify actual connectivity checks, timeout handling, and graceful degradation.
3. **Manual Testing:**
   - Verify `GET /api/health` returns 200 with correct JSON when all services are up.
   - Stop PostgreSQL and verify the endpoint returns 503 with `unhealthy` status.
   - Stop Redis and verify the endpoint returns 200 with `degraded` status.
   - Verify the endpoint is accessible without authentication.
   - Verify the endpoint is excluded from middleware session checks.

## Risks & Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Health check adds load to DB | Low (single `SELECT 1`) | Add response caching (TTL 10s) if needed |
| Endpoint exposes internal state | Medium | Strictly limit response to status/latency only |
| Redis check blocks if Redis is slow | Low | Enforce 3-second timeout on Redis ping |
| Endpoint used for DDoS | Low | Add rate limiting if abuse is detected |

## Implementation Timeline
- **Phase 1:** Create `app/api/health/route.ts` with database check only.
- **Phase 2:** Add Redis check with graceful degradation.
- **Phase 3:** Add `/api/health` exclusion to `PUBLIC_PATTERNS` in `middleware.ts`.
- **Phase 4:** Write unit and integration tests.
- **Phase 5:** Deploy and configure load balancer/monitoring to use the endpoint.

## Acceptance Criteria
- [ ] `GET /api/health` returns valid JSON with `status`, `timestamp`, `version`, `uptime`, and `checks`.
- [ ] Database connectivity is verified on each request.
- [ ] Redis connectivity is verified on each request (if configured).
- [ ] Endpoint returns HTTP 200 when healthy, HTTP 503 when unhealthy.
- [ ] Endpoint is accessible without authentication.
- [ ] Endpoint is excluded from middleware session validation.
- [ ] No sensitive information is exposed in the response.
- [ ] Unit tests pass with >80% coverage.
- [ ] Integration tests pass against real infrastructure.

---

*This proposal follows the OpenSpec format used by the Property NI project for tracking architectural changes and deferred improvements.*

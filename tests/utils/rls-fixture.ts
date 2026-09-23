/**
 * RLS-aware fixture helpers for integration tests (RLS plan Phase 2/4).
 *
 * The app DB role is `nipp_app` (non-owner): Postgres RLS applies to EVERY query,
 * and Organization INSERT/UPDATE/DELETE require the platform-admin GUC — raw
 * `prisma.*` fixture calls with no bound context fail closed (42501). These
 * helpers are the test analogue of the production route boundary:
 *
 *   - `rlsFixture(targetOrgId)` — a full PrismaClient surface where each MODEL
 *     OP runs on its own pinned interactive transaction with platform-admin GUCs
 *     (is_platform_admin=1) bound to that same connection, scoped to
 *     `targetOrgId` (or the platform org when null). That satisfies:
 *       • Organization INSERT    (WITH CHECK: flag only)
 *       • Organization UPDATE/DELETE  (qual: id = app.current_org_id AND flag —
 *         so pass the TARGET org id for ops on that specific row)
 *       • every other org-scoped model   (flag branch of the FOR ALL policies)
 *     Use `rlsFixture(null)` to CREATE an org; keep `rlsFixture(org.id)` as your
 *     working handle for everything else in the test.
 *
 *   - `withTenantAccess(orgId, isPlatformAdmin, op)` — mirrors the production
 *     route boundary for SERVICE-level integration tests: binds a verified
 *     tenant context (GUCs + ALS) around services that internally use tenantDb
 *     (e.g. CalendarEventService, which resolves models to the pinned tx), and
 *     asserts the same role matrix as lib/tenant-access at HTTP time.
 *
 *   - `deleteOrgsBySlugPrefix(prefixes, alsoDeleteCalendarData?)` — afterAll
 *     cleanup helper: Organization UPDATE/DELETE rows are only visible under a
 *     context bound to the TARGET org id (RLS qual), so each org is resolved
 *     platform-scoped and deleted under its own target context.
 *
 * Production callers NEVER use these — they are test-only and intentionally not
 * part of the app import surface beyond tests/.
 */
import type { PrismaClient } from '@prisma/client';
import prisma from '@/lib/db';
import { runWithRLS, withRLSContext, type RLSContext } from '@/lib/rls-transaction';

const FIXTURE_USER_ID = 'integration-fixture-user';

/** Platform org id (env-sourced; lib/env's test fixture provides a default). */
function platformOrgId(): string {
  return process.env.PLATFORM_ORGANIZATION_ID || 'ctestplatformorg000000000';
}

function ctxFor(targetOrgId: string | null): RLSContext {
  // INSERT policies only check the flag, so a null target (org creation) binds
  // the platform org as a harmless placeholder for app.current_org_id.
  return {
    userId: FIXTURE_USER_ID,
    orgId: targetOrgId ?? platformOrgId(),
    isPlatformAdmin: true,
    platformOrgId: platformOrgId(),
  };
}

/** Models the fixture proxy allows (everything integration fixtures create/read). */
const FIXTURE_MODELS = new Set([
  'organization',
  'team',
  'teamMember',
  'teamRole',
  'member',
  'memberRole',
  'role',
  'rolePermission',
  'calendar',
  'calendarEvent',
  'invitation',
  'sentInvitation',
  'notification',
  'user',
]);

/**
 * A PrismaClient-shaped handle: every op on the listed models executes on a
 * pinned interactive tx with platform-admin GUCs bound to that connection.
 * All other properties fall through to the base client (no GUCs — only use
 * for non-RLS targets, which none of these remain).
 */
export function rlsFixture(targetOrgId: string | null): PrismaClient {
  return new Proxy(prisma as unknown as Record<string, unknown>, {
    get(_t, prop) {
      if (typeof prop !== 'string' || !FIXTURE_MODELS.has(prop)) {
        return (prisma as unknown as Record<string, unknown>)[String(prop)];
      }
      // Per-access proxy: each method call = one bound interactive transaction.
      return new Proxy(
        {},
        {
          get(_m, mthd) {
            if (typeof mthd !== 'string') return undefined;
            return (...args: unknown[]) =>
              runWithRLS(prisma, ctxFor(targetOrgId), (tx) => {
                const model = (tx as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[prop];
                return model[mthd](...args);
              });
          },
        },
      ) as unknown;
    },
  }) as unknown as PrismaClient;
}

/**
 * Run a service call under a verified TENANT context — the exact shape the
 * route boundary establishes (lib/rls-transaction.withRLSContext): GUCs on one
 * pinned connection + ALS tenant context for app-layer extension scoping.
 * @param isPlatformAdmin mirrors verifySuperAdmin at HTTP time (true only for
 *   platform super admins; a TENANT_ADMIN stays false so org-scoped WITH CHECK
 *   applies — same as production).
 */
export function withTenantAccess<T>(
  orgId: string,
  isPlatformAdmin: boolean,
  op: () => T | Promise<T>,
): Promise<T> {
  return withRLSContext({ userId: FIXTURE_USER_ID, orgId, isPlatformAdmin }, op);
}

/**
 * afterAll cleanup for suites that created several orgs in beforeEach.
 * Resolves orgs matching the given slug prefixes (platform-scoped) and
 * deletes each under its OWN target-org context (the Organization UPDATE/
 * DELETE policy requires app.current_org_id = row id AND the platform flag).
 */
export async function deleteOrgsBySlugPrefix(
  prefixes: string[],
  opts?: { alsoDeleteCalendarData?: boolean },
): Promise<void> {
  const platform = rlsFixture(null);
  for (const prefix of prefixes) {
    const orgs = await platform.organization.findMany({ where: { slug: { startsWith: prefix } } });
    for (const org of orgs) {
      if (opts?.alsoDeleteCalendarData) {
        // Explicit cascade cleanup (Team relations are DB-cascaded; calendar
        // events/calendars are not, so delete them first under the same ctx).
        await rlsFixture(org.id).calendarEvent.deleteMany({ where: { organizationId: org.id } });
        await rlsFixture(org.id).calendar.deleteMany({ where: { organizationId: org.id } });
      }
      await rlsFixture(org.id).organization.delete({ where: { id: org.id } });
    }
  }
}

/**
 * Phase 3 (MCP authz) — portal negative tests: defense-in-depth proof.
 *
 * Requirement 3 of the original ask: "enforce scope checks in the app server."
 * These prove the PORTAL independently rejects unauthorized admin calls even
 * when the MCP layer is bypassed entirely — i.e. a tenant session held directly
 * against /api/admin/* gets 403, and only a platform admin passes. This is the
 * final authority that the MCP scope gate (phase 2) defers to for _dash tools
 * and that sits behind every forwarded caller token.
 *
 * Run against the docker test stack with ports from .env.test:
 *   set -a; source .env.test; set +a; npm run test:integration -- admin-api-negative
 *
 * Drives the REAL route handlers in-process (same pattern as bearer-tokens.test.ts):
 * sign in via auth.handler, capture set-auth-token, call the admin route with
 * only that bearer header. No mocks of requireSuperAdmin / RLS — the whole point
 * is to exercise the real verification + platform-context boundary.
 *
 * Fixtures are self-contained (seeded here with known passwords, no platform
 * membership) so the test never depends on pre-seeded credentials and never
 * mutates a real account: the ban negative test targets a SEEDDED user's row.
 * The 200 control uses the live Platform super-admin account.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { hashPassword } from 'better-auth/crypto';
import { resetAdminRateLimitStore } from '@/lib/rate-limiter';

const TENANT_A_EMAIL = 'neg.tenant.a@example.com';
const TENANT_A_PW = 'NegTenantA!2345';
const TENANT_B_EMAIL = 'neg.tenant.b@example.com';
const TENANT_B_PW = 'NegTenantB!2345';
// Live Platform super-admin (control: the only identity that may pass).
const ADMIN_EMAIL = 'johnlynas666@gmail.com';
const ADMIN_PW = 'RuthB3421';

/** Upsert a fixture user + credential account with a known password. */
async function seedUser(email: string, pw: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { name: email.split('@')[0], email },
    update: {},
  });
  await prisma.account.upsert({
    where: { providerId_accountId: { providerId: 'credential', accountId: user.id } },
    create: { userId: user.id, accountId: user.id, providerId: 'credential', password: await hashPassword(pw) },
    update: {},
  });
  // Ensure the fixture is NOT a platform member (negative tests need non-admins).
  const platformOrgId = process.env.PLATFORM_ORGANIZATION_ID;
  if (platformOrgId) {
    await prisma.member.deleteMany({ where: { userId: user.id, organizationId: platformOrgId } });
  }
  return user.id;
}

/** Real email/password sign-in via the auth handler, returns a bearer token. */
async function signInBearer(email: string, pw: string): Promise<string> {
  const handler = auth.handler as (req: Request) => Promise<Response>;
  const res = await handler(
    new Request('http://localhost/api/auth/sign-in/email', {
      method: 'POST',
      headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: pw }),
    }),
  );
  expect(res.status, 'sign-in ' + email + ' should succeed, got ' + res.status).toBeLessThan(300);
  const token = res.headers.get('set-auth-token');
  expect(token, 'no set-auth-token for ' + email).toBeTruthy();
  return token!;
}

/** GET /api/admin/users with ONLY the bearer header (no cookies). */
async function adminListUsers(token: string): Promise<Response> {
  const { GET } = await import('@/app/api/admin/users/route');
  return await GET(
    new NextRequest('http://localhost/api/admin/users?page=1', {
      headers: { Authorization: 'Bearer ' + token },
    }),
  );
}

/** POST /api/dashboard/admin/users/[id]/ban with ONLY the bearer header. */
async function banUser(token: string, userId: string): Promise<Response> {
  const { POST } = await import('@/app/api/dashboard/admin/users/[id]/ban/route');
  return await POST(
    new NextRequest('http://localhost/api/dashboard/admin/users/' + userId + '/ban', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned: true, banReason: 'negative-test' }),
    }),
    { params: Promise.resolve({ id: userId }) } as never,
  );
}

describe('portal admin-API negative authz (phase 3 MCP authz task 5)', () => {
  afterAll(async () => {
    resetAdminRateLimitStore();
    // Clean up fixtures so the shared dev DB stays tidy.
    for (const email of [TENANT_A_EMAIL, TENANT_B_EMAIL]) {
      const u = await prisma.user.findUnique({ where: { email } });
      if (u) {
        await prisma.session.deleteMany({ where: { userId: u.id } });
        await prisma.account.deleteMany({ where: { userId: u.id } });
        await prisma.member.deleteMany({ where: { userId: u.id } });
        await prisma.user.delete({ where: { id: u.id } });
      }
    }
  });

  it('tenant session to GET /api/admin/users returns 403 (not 2xx, not 5xx)', async () => {
    resetAdminRateLimitStore();
    await seedUser(TENANT_A_EMAIL, TENANT_A_PW);
    const tenantTok = await signInBearer(TENANT_A_EMAIL, TENANT_A_PW);

    const res = await adminListUsers(tenantTok);
    // THE invariant: a non-platform-admin is rejected. The portal answers 403
    // (requireSuperAdmin to verifySuperAdmin false) — never 2xx (data leak) and
    // never 5xx (crash). Record the actual status in the run log.
    expect(res.status, 'tenant admin-list should be forbidden, got ' + res.status).toBe(403);
    const body = await res.json().catch(() => ({}));
    expect(body.items ?? null, 'no user list may be returned to a tenant').toBeNull();
  }, 30_000);

  it('tenant session to POST ban returns non-2xx', async () => {
    resetAdminRateLimitStore();
    const targetId = await seedUser(TENANT_B_EMAIL, TENANT_B_PW);
    await seedUser(TENANT_A_EMAIL, TENANT_A_PW);
    const tenantTok = await signInBearer(TENANT_A_EMAIL, TENANT_A_PW);

    // A tenant must not be able to ban ANYONE — target a seeded user's row.
    const res = await banUser(tenantTok, targetId);
    expect(res.status, 'tenant ban should be rejected, got ' + res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500); // no crash
  }, 30_000);

  it('platform admin session to GET /api/admin/users returns 200 (control)', async () => {
    resetAdminRateLimitStore();
    const adminTok = await signInBearer(ADMIN_EMAIL, ADMIN_PW);

    const res = await adminListUsers(adminTok);
    expect(res.status, 'admin admin-list should succeed, got ' + res.status).toBe(200);
    const body = (await res.json()) as { items?: unknown[] };
    expect(Array.isArray(body.items), 'admin list returns an items array').toBe(true);
  }, 30_000);
});

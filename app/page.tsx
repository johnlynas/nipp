import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import tenantDb from '@/lib/tenant-db';
import { getPlatformOrgId } from '@/lib/authz';

/**
 * Root Page Server Component.
 * Acts as a secure gatekeeper. Runs on the server BEFORE any UI is rendered.
 *
 * Post-login landing: platform administrators go to the admin dashboard; every
 * other role lands directly on their tenant calendar page (the default page of
 * the /dashboard/tenant workspace — mapping lives in lib/dashboard-router.ts).
 *
 * "Platform team member" = a user whose active org is the platform org (their
 * User.activeOrganizationId — pinned at invite time by UserService.create and
 * backfilled on first sign-in by the session hook in lib/auth.ts — equals the
 * PLATFORM_ORGANIZATION_ID). This covers Google OIDC users: the provisioning
 * gate already requires an org membership, but their User.role is left at the
 * 'member' default, so they are caught here, not by the role check alone.
 * Local password logins hit this same page (router.push(callbackUrl ?? '/')),
 * so both doors share one decision point.
 */
export default async function HomePage() {
  // 1. SECURELY fetch the session to get the user ID and validate the cookie.
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // 2. If no session, redirect to login.
  if (!session) {
    redirect('/login');
  }

  // 3. THE CRITICAL CHECK: Query the database directly for the user's role and
  // the org they were provisioned into (their activeOrganizationId).
  const user = await tenantDb.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, activeOrganizationId: true },
  });

  // 4. Platform administrators land in the admin dashboard (users page —
  // its own default view, same target /dashboard/admin/page.tsx bounces to):
  // either by global role (admin-created users) or by membership in the
  // platform org (platform team members, incl. Google OIDC sign-ins).
  const isPlatformAdminRole = user?.role === 'super_admin' || user?.role === 'admin';
  let isPlatformOrgMember = false;
  if (!isPlatformAdminRole && user?.activeOrganizationId) {
    const platformOrgId = await getPlatformOrgId();
    isPlatformOrgMember = platformOrgId !== null && user.activeOrganizationId === platformOrgId;
  }
  if (isPlatformAdminRole || isPlatformOrgMember) {
    redirect('/dashboard/admin/users');
  }

  // 5. Every other role lands on the tenant workspace calendar — the
  // default page of the /dashboard/tenant section (calendar, org chart,
  // members, roles, organization setup).
  redirect('/dashboard/tenant/calendar');
}
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import tenantDb from '@/lib/tenant-db';

/**
 * Root Page Server Component.
 * Acts as a secure gatekeeper. Runs on the server BEFORE any UI is rendered.
 *
 * Post-login landing: platform admins go to the admin dashboard; every other
 * role lands directly on their tenant calendar page (the default page of the
 * /dashboard/tenant workspace — mapping lives in lib/dashboard-router.ts).
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

  // 3. THE CRITICAL CHECK: Query the database directly for the user's role.
  const user = await tenantDb.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });

  // 4. Platform administrators land in the admin dashboard (users page —
  // its own default view, same target /dashboard/admin/page.tsx bounces to).
  if (user?.role === 'super_admin' || user?.role === 'admin') {
    redirect('/dashboard/admin/users');
  }

  // 5. Every other role lands on the tenant workspace calendar — the
  // default page of the /dashboard/tenant section (calendar, org chart,
  // members, roles, organization setup).
  redirect('/dashboard/tenant/calendar');
}
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import tenantDb from '@/lib/tenant-db';
import { LogoutButton } from '@/components/auth/LogoutButton'; // ✅ Import the new button

/**
 * Root Page Server Component.
 * Acts as a secure gatekeeper. Runs on the server BEFORE any UI is rendered.
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

  // 4. If Super Admin, redirect immediately via HTTP 307/308.
  if (user?.role === 'super_admin') {
    redirect('/dashboard/admin/users');
  }

  // 5. If we reach here, the user is a standard Tenant User.
  // Render the tenant dashboard securely.
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Welcome to your Tenant Dashboard
      </h1>
      <p className="mt-2 text-slate-600">
        You are logged in as a tenant user.
      </p>
      
      {/* ✅ Render the Client Component here */}
      <LogoutButton />
      
    </div>
  );
}
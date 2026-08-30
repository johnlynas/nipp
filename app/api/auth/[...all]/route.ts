import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { handleCreateOrganization } from '@/lib/org-bootstrap';
import { checkAuthRateLimit, getClientIp } from '@/lib/rate-limiter';

// Force Node.js runtime (required for Prisma)
export const runtime = 'nodejs';

// Create a custom handler that intercepts organization creation and auth rate limiting
async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  // IP-based rate limiting for auth requests (login/register brute-force protection)
  if (req.method === 'POST') {
    const ipAddress = getClientIp(req);
    if (!checkAuthRateLimit(ipAddress)) {
      return new Response(
        JSON.stringify({ error: 'Too many requests. Please try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }
  }

  // Intercept organization creation to bootstrap default roles
  if (req.method === 'POST' && pathname.includes('/api/auth/organization/create-organization')) {
    return handleCreateOrganization(req);
  }

  // For all other requests, use BetterAuth's default handler
  return auth.handler(req);
}

// Export handlers
export const { GET } = toNextJsHandler(auth);
export { handler as POST };
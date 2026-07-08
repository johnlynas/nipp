import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { handleCreateOrganization } from '@/lib/org-bootstrap';

// Force Node.js runtime (required for Prisma)
export const runtime = 'nodejs';

// Create a custom handler that intercepts organization creation
async function handler(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);
  
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
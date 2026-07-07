import { auth } from '@/lib/auth';
import { toNextJsHandler } from 'better-auth/next-js';
import { handleCreateOrganization } from '@/lib/org-bootstrap';

export async function POST(req: Request) {
  // Intercept organization creation to bootstrap default roles (7.1-7.2)
  const nextReq = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: req.body,
    duplex: 'half',
  });

  const intercepted = await handleCreateOrganization(nextReq as any);
  if (intercepted) {
    return intercepted;
  }

  // Fall through to BetterAuth handler for all other endpoints
  const { POST: authPost } = toNextJsHandler(auth);
  return authPost(req);
}

export async function GET(req: Request) {
  const { GET: authGet } = toNextJsHandler(auth);
  return authGet(req);
}

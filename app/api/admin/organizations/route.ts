/**
 * GET /api/admin/organizations
 * POST /api/admin/organizations
 *
 * Super Admin only — list all organizations or create a new one.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import globalDb from '@/lib/global-db';
import { requireSuperAdmin, getRequestMetadata } from '@/lib/require-super-admin';
import { recordAuditLog } from '@/lib/audit-log';
import { prisma } from '@/lib/db';
import { setRLSContext } from '@/lib/rls'; // <-- Import the helper

export const runtime = 'nodejs';

/**
 * Organization state machine transitions.
 * PENDING → ACTIVE ↔ SUSPENDED → ARCHIVED (terminal)
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE'],
  ACTIVE: ['SUSPENDED', 'ARCHIVED'],
  SUSPENDED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [], // Terminal — no transitions allowed
};

/**
 * Generate a unique slug from organization name.
 */
async function generateUniqueSlug(name: string): Promise<string> {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  let slug = base;
  let suffix = 0;
  let exists = true;

  while (exists) {
    const existing = await globalDb.organization.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (!existing) {
      exists = false;
    } else {
      suffix++;
      slug = `${base}-${suffix}`;
    }
  }

  return slug;
}

/**
 * GET — List all organizations with pagination, search, and status filter.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. CRITICAL: Set RLS Context before ANY database queries
    // For Super Admins, we use the Platform Org ID as the context
    const orgId = session.session.activeOrganizationId || process.env.PLATFORM_ORG_ID!;
    await setRLSContext(session.user.id, orgId);

    // 2. NOW it is safe to query the database. RLS will allow the Super Admin bypass.
    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: 'desc' },
      // Add your pagination/search logic here
    });

    return NextResponse.json({ organizations });
  } catch (error) {
    console.error('[Organizations API] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST — Create a new organization.
 */
export async function POST(request: NextRequest) {
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const body = await request.json();
  const { name, slug: providedSlug, initialAdminEmail } = body as {
    name: string;
    slug?: string;
    initialAdminEmail?: string;
  };

  if (!name) {
    return NextResponse.json(
      { error: 'Organization name is required' },
      { status: 400 }
    );
  }

  // Generate or validate slug
  const slug = providedSlug || await generateUniqueSlug(name);

  // Verify provided slug uniqueness
  if (providedSlug) {
    const existing = await globalDb.organization.findUnique({
      where: { slug: providedSlug },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { error: `Slug "${providedSlug}" is already taken` },
        { status: 409 }
      );
    }
  }

  const session = await auth.api.getSession({ headers: request.headers });
  const { ipAddress, userAgent } = getRequestMetadata(request);

  try {
    const organization = await globalDb.organization.create({
      data: {
        name,
        slug,
        status: 'PENDING',
      },
    });

    // If initial admin email provided, create user and assign as Org Admin
    if (initialAdminEmail) {
      let user = await globalDb.user.findUnique({
        where: { email: initialAdminEmail },
      });

      if (!user) {
        // Create the user (they'll need to set password via registration)
        user = await globalDb.user.create({
          data: {
            name: initialAdminEmail.split('@')[0],
            email: initialAdminEmail,
            emailVerified: false,
          },
        });
      }

      // Create member and trigger org bootstrap for default roles
      await globalDb.member.create({
        data: {
          userId: user.id,
          orgId: organization.id,
          role: 'Organization Admin',
        },
      });

      // Trigger org bootstrap to create default roles and permissions
      try {
        const { bootstrapOrganizationRoles } = await import('@/lib/org-bootstrap');
        await bootstrapOrganizationRoles(organization.id, user.id);
      } catch (bootstrapError) {
        console.error('[Admin Org] Failed to bootstrap roles:', bootstrapError);
        // Don't fail the org creation if bootstrap fails
      }
    }

    await recordAuditLog({
      userId: session?.user?.id,
      userName: session?.user?.name,
      action: 'organization.created',
      resourceType: 'Organization',
      resourceId: organization.id,
      organizationId: null, // Global action
      ipAddress,
      userAgent,
      success: true,
      metadata: { name, slug },
    });

    return NextResponse.json({ organization }, { status: 201 });
  } catch (error) {
    console.error('[Admin Org] Failed to create organization:', error);
    return NextResponse.json(
      { error: 'Failed to create organization' },
      { status: 500 }
    );
  }
}

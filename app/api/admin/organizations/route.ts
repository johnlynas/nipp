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
  const authError = await requireSuperAdmin(request.headers);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = Math.min(parseInt(searchParams.get('pageSize') || '20', 10), 100);
  const search = searchParams.get('search') || '';
  const status = searchParams.get('status') || '';

  const skip = (page - 1) * pageSize;

  const where: Record<string, unknown> = {};
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { slug: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (status) {
    where.status = status;
  }

  const [organizations, total] = await Promise.all([
    globalDb.organization.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        createdAt: true,
        members: { select: { id: true } },
      },
    }),
    globalDb.organization.count({ where }),
  ]);

  return NextResponse.json({
    organizations: organizations.map((org) => ({
      ...org,
      memberCount: org.members.length,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
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

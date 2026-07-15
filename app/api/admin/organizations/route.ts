import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

export async function GET(request: Request) {
  try {
    console.log('[ORGANIZATIONS_API] GET request received');
    
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (!session) {
      console.log('[ORGANIZATIONS_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('[ORGANIZATIONS_API] Session found for user:', session.user.id);
    
    // Check Super Admin status
    let isSuperAdmin = false;
    
    try {
      const { getPlatformOrgId } = await import('@/lib/authz');
      const platformOrgId = await getPlatformOrgId();
      
      const superAdminCheck = await prisma.member.findFirst({
        where: {
          userId: session.user.id,
          orgId: platformOrgId,
        },
      });
      
      isSuperAdmin = !!superAdminCheck;
    } catch (error) {
      const userEmail = (session.user as any).email;
      const knownSuperAdminEmail = env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
      isSuperAdmin = userEmail === knownSuperAdminEmail;
    }
    
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    // Parse query parameters for pagination
    const url = new URL(request.url);
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(url.searchParams.get('pageSize') || '20', 10);
    const skip = (page - 1) * pageSize;
    
    console.log('[ORGANIZATIONS_API] Fetching organizations with pagination:', { page, pageSize, skip });
    
    // Fetch organizations with pagination
    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { members: true },
          },
        },
      }),
      prisma.organization.count(),
    ]);
    
    console.log('[ORGANIZATIONS_API] Found', organizations.length, 'organizations');
    
    // Return response
    return NextResponse.json({
      organizations,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error('[ORGANIZATIONS_API] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    console.log('[ORGANIZATIONS_API] POST request received');
    
    const session = await auth.api.getSession({
      headers: await headers(),
    });
    
    if (!session) {
      console.log('[ORGANIZATIONS_API] No session found');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    console.log('[ORGANIZATIONS_API] Session found for user:', session.user.id);
    
    // Check Super Admin status
    let isSuperAdmin = false;
    
    try {
      const { getPlatformOrgId } = await import('@/lib/authz');
      const platformOrgId = await getPlatformOrgId();
      
      console.log('[ORGANIZATIONS_API] Checking super admin status, platformOrgId:', platformOrgId);
      
      const superAdminCheck = await prisma.member.findFirst({
        where: {
          userId: session.user.id,
          orgId: platformOrgId,
        },
      });
      
      isSuperAdmin = !!superAdminCheck;
      console.log('[ORGANIZATIONS_API] Is Super Admin:', isSuperAdmin);
    } catch (error) {
      console.log('[ORGANIZATIONS_API] DB check failed, falling back to email');
      const userEmail = (session.user as any).email;
      const knownSuperAdminEmail = env.SUPER_ADMIN_EMAIL || 'admin@nipp.gov.uk';
      isSuperAdmin = userEmail === knownSuperAdminEmail;
      console.log('[ORGANIZATIONS_API] Email check result:', isSuperAdmin);
    }
    
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Super Admin access required' }, { status: 403 });
    }
    
    // Parse request body
    let body;
    try {
      body = await request.json();
      console.log('[ORGANIZATIONS_API] Request body:', body);
    } catch (error) {
      console.error('[ORGANIZATIONS_API] Failed to parse request body:', error);
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    
    const { name, slug, adminEmail } = body;
    
    // Validate required fields
    if (!name) {
      return NextResponse.json({ error: 'Organization name is required' }, { status: 400 });
    }
    
    // Check if organization with same name already exists
    const existingOrgByName = await prisma.organization.findFirst({
      where: { 
        name: {
          equals: name,
          mode: 'insensitive', // Case-insensitive comparison
        },
      },
    });
    
    if (existingOrgByName) {
      return NextResponse.json({ 
        error: 'An organization with this name already exists' 
      }, { status: 400 });
    }
    
    // Generate unique slug
    let generatedSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
    let slugSuffix = 1;
    let uniqueSlug = generatedSlug;
    
    // Check if slug exists and append number if needed
    while (true) {
      const existingOrg = await prisma.organization.findUnique({
        where: { slug: uniqueSlug },
      });
      
      if (!existingOrg) {
        break; // Slug is unique
      }
      
      uniqueSlug = `${generatedSlug}-${slugSuffix}`;
      slugSuffix++;
      
      // Safety limit
      if (slugSuffix > 100) {
        return NextResponse.json({ 
          error: 'Unable to generate unique slug' 
        }, { status: 400 });
      }
    }
    
    console.log('[ORGANIZATIONS_API] Using unique slug:', uniqueSlug);
    
    // Create organization with unique slug
    const organization = await prisma.organization.create({
      data: {
        name,
        slug: uniqueSlug,
      },
    });
    
    console.log('[ORGANIZATIONS_API] Organization created:', organization.id);
    
    // If admin email provided, create user and assign role
    if (adminEmail) {
      console.log('[ORGANIZATIONS_API] Creating user for email:', adminEmail);
      
      try {
        // Find or create user
        let user = await prisma.user.findUnique({
          where: { email: adminEmail },
        });
        
        if (!user) {
          console.log('[ORGANIZATIONS_API] User not found, creating new user');
          user = await prisma.user.create({
            data: {
              email: adminEmail,
              name: adminEmail.split('@')[0], // Use part before @ as name
              emailVerified: true,
            },
          });
          console.log('[ORGANIZATIONS_API] User created:', user.id);
        }
        
        // Create member relationship
        console.log('[ORGANIZATIONS_API] Creating member relationship');
        await prisma.member.create({
          data: {
            userId: user.id,
            orgId: organization.id,
            role: 'admin',
          },
        });
        console.log('[ORGANIZATIONS_API] Member relationship created');
      } catch (userError) {
        console.error('[ORGANIZATIONS_API] Error creating user/member:', userError);
        // Don't fail the whole request if user creation fails
        // The org was created successfully
      }
    }
    
    console.log('[ORGANIZATIONS_API] Success, returning 201');
    return NextResponse.json({ 
      message: 'Organization created successfully',
      organization 
    }, { status: 201 });
  } catch (error) {
    console.error('[ORGANIZATIONS_API] Unexpected error:', error);
    console.error('[ORGANIZATIONS_API] Error stack:', error instanceof Error ? error.stack : 'No stack');
    return NextResponse.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/db';
import { organization } from 'better-auth/plugins';

interface ExtendedUser {
  permissions: string[];
  isSuperAdmin: boolean;
}

interface ExtendedSession {
  user: ExtendedUser | null;
  activeOrganizationId: string | null;
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true, // Block public registration
  },
  
  plugins: [organization()],
  
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  
  callbacks: {
    async session({ session, user }: { session: ExtendedSession; user: any }): Promise<ExtendedSession> {
      // Check if we're in Edge Runtime (middleware)
      // If so, skip permission resolution to avoid Prisma errors
      const isEdgeRuntime = typeof (globalThis as any).EdgeRuntime !== 'undefined';
      
      if (isEdgeRuntime) {
        // In Edge Runtime, return session without permissions
        // Permissions will be fetched separately via API
        return session;
      }
      
      // In Node.js runtime, resolve permissions
      try {
        const { resolvePermissions } = await import('@/lib/permissions/resolver');
        const { getPlatformOrgId } = await import('@/lib/authz');
        
        const orgId = session.activeOrganizationId;
        if (orgId) {
          const permissions = await resolvePermissions(user.id, orgId);
          const platformOrgId = await getPlatformOrgId();
          const isSuperAdmin = orgId === platformOrgId;
          
          return {
            ...session,
            user: {
              ...session.user,
              permissions,
              isSuperAdmin,
            },
          } as ExtendedSession;
        }
      } catch (error) {
        console.error('[Auth] Failed to resolve permissions:', error);
      }
      
      return session;
    },
  },
});
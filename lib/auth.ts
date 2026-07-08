import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { prisma } from '@/lib/db';
import { organization } from 'better-auth/plugins';

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  
  plugins: [organization()],
  
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  
  callbacks: {
    async session({ session, user }) {
      // Check if we're in Edge Runtime (middleware)
      // If so, skip permission resolution to avoid Prisma errors
      const isEdgeRuntime = typeof globalThis.EdgeRuntime !== 'undefined';
      
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
          };
        }
      } catch (error) {
        console.error('[Auth] Failed to resolve permissions:', error);
      }
      
      return session;
    },
  },
});
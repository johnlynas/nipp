import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

export function usePermission(permission: string): boolean {
  const { data: session } = useSession();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      setHasPermission(false);
      return;
    }

    if ((session?.user as any)?.permissions) {
      setHasPermission((session.user as any).permissions.includes(permission));
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setHasPermission(data.permissions.includes(permission));
          setIsLoading(false);
        })
        .catch(() => {
          setHasPermission(false);
          setIsLoading(false);
        });
    }
  }, [session, permission]);

  if (isLoading) return false;
  return hasPermission ?? false; // ✅ Fixes TS error while keeping null init
}

export function useAnyPermission(permissions: string[]): boolean {
  const { data: session } = useSession();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      setHasPermission(false);
      return;
    }

    if ((session?.user as any)?.permissions) {
      setHasPermission(permissions.some(p => (session.user as any).permissions.includes(p)));
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setHasPermission(permissions.some(p => data.permissions.includes(p)));
          setIsLoading(false);
        })
        .catch(() => {
          setHasPermission(false);
          setIsLoading(false);
        });
    }
  }, [session, permissions]);

  if (isLoading) return false;
  return hasPermission ?? false; // ✅ Fixes TS error
}

export function useIsSuperAdmin(): boolean | null {
  // ✅ Correctly typed to return boolean | null
  const [isSuperAdmin, setIsSuperAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    async function checkPermissions() {
      try {
        const res = await fetch('/api/auth/permissions');
        const data = await res.json();
        setIsSuperAdmin(data.isSuperAdmin === true);
      } catch (error) {
        console.error('Failed to check super admin status:', error);
        setIsSuperAdmin(false);
      }
    }

    checkPermissions();
  }, []);

  return isSuperAdmin; // ✅ Returns null initially, preventing the flash
}

/**
 * Alias for usePermission — checks if user has a specific permission.
 */
export function useHasPermission(permission: string): boolean {
  return usePermission(permission);
}

/**
 * Checks if user has ALL of the given permissions.
 */
export function useAllPermissions(permissions: string[]): boolean {
  const { data: session } = useSession();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      setHasPermission(false);
      return;
    }

    if ((session?.user as any)?.isSuperAdmin) {
      setHasPermission(true);
      setIsLoading(false);
      return;
    }

    if ((session?.user as any)?.permissions) {
      setHasPermission(permissions.every((p) => (session.user as any).permissions.includes(p)));
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setHasPermission(permissions.every((p) => data.permissions.includes(p)));
          setIsLoading(false);
        })
        .catch(() => {
          setHasPermission(false);
          setIsLoading(false);
        });
    }
  }, [session, permissions]);

  if (isLoading) return false;
  return hasPermission ?? false; // ✅ Fixes TS error
}
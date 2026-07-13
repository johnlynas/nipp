'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

export function usePermission(permission: string): boolean {
  const { data: session } = useSession();
  const [hasPermission, setHasPermission] = useState(false);
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
  return hasPermission;
}

export function useAnyPermission(permissions: string[]): boolean {
  const { data: session } = useSession();
  const [hasPermission, setHasPermission] = useState(false);
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
  return hasPermission;
}

export function useIsSuperAdmin(): boolean {
  const { data: session } = useSession();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      setIsSuperAdmin(false);
      return;
    }

    if ((session?.user as any)?.isSuperAdmin !== undefined) {
      setIsSuperAdmin((session.user as any).isSuperAdmin);
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setIsSuperAdmin(data.isSuperAdmin || false);
          setIsLoading(false);
        })
        .catch(() => {
          setIsSuperAdmin(false);
          setIsLoading(false);
        });
    }
  }, [session]);

  if (isLoading) return false;
  return isSuperAdmin;
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
  const [hasPermission, setHasPermission] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if ((session?.user as any)?.isSuperAdmin) {
      setHasPermission(true);
      setIsLoading(false);
      return;
    }

    if ((session?.user as any)?.permissions) {
      setHasPermission(permissions.every((p) => (session.user as any).permissions.includes(p)));
      setIsLoading(false);
    } else if (session) {
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
  return hasPermission;
}
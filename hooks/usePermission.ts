'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

export function usePermission(permission: string): { hasPermission: boolean; isLoading: boolean } {
  const { data: session } = useSession();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    if (session?.user?.permissions) {
      setPermissions(session.user.permissions);
      setIsSuperAdmin(session.user.isSuperAdmin || false);
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setPermissions(data.permissions || []);
          setIsSuperAdmin(data.isSuperAdmin || false);
          setIsLoading(false);
        })
        .catch(() => {
          setPermissions([]);
          setIsSuperAdmin(false);
          setIsLoading(false);
        });
    }
  }, [session]);

  if (isSuperAdmin) return { hasPermission: true, isLoading };
  return { hasPermission: permissions.includes(permission), isLoading };
}

export function useAnyPermission(permissions: string[]): { hasPermission: boolean; isLoading: boolean } {
  const { data: session } = useSession();
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    if (session?.user?.permissions) {
      setUserPermissions(session.user.permissions);
      setIsSuperAdmin(session.user.isSuperAdmin || false);
      setIsLoading(false);
    } else {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setUserPermissions(data.permissions || []);
          setIsSuperAdmin(data.isSuperAdmin || false);
          setIsLoading(false);
        })
        .catch(() => {
          setUserPermissions([]);
          setIsSuperAdmin(false);
          setIsLoading(false);
        });
    }
  }, [session]);

  if (isSuperAdmin) return { hasPermission: true, isLoading };
  return { hasPermission: permissions.some(p => userPermissions.includes(p)), isLoading };
}

export function useIsSuperAdmin(): { isSuperAdmin: boolean; isLoading: boolean } {
  const { data: session } = useSession();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setIsLoading(false);
      return;
    }

    if (session?.user?.isSuperAdmin !== undefined) {
      setIsSuperAdmin(session.user.isSuperAdmin);
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

  return { isSuperAdmin, isLoading };
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
  const [hasAll, setHasAll] = useState(false);

  useEffect(() => {
    if (session?.user?.isSuperAdmin) {
      setHasAll(true);
      return;
    }

    if (session?.user?.permissions) {
      setHasAll(permissions.every((p) => session.user.permissions.includes(p)));
    } else if (session) {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setHasAll(permissions.every((p) => (data.permissions || []).includes(p)));
        })
        .catch(() => setHasAll(false));
    }
  }, [session, permissions]);

  return hasAll;
}
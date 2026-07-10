'use client';

import { useSession } from '@/lib/auth-client';
import { useEffect, useState } from 'react';

export function usePermission(permission: string): boolean {
  const { data: session } = useSession();
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (session?.user?.permissions) {
      // Permissions already in session (from Node.js runtime)
      setPermissions(session.user.permissions);
      setIsSuperAdmin(session.user.isSuperAdmin || false);
    } else if (session) {
      // Permissions not in session (from Edge Runtime) — fetch them
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setPermissions(data.permissions || []);
          setIsSuperAdmin(data.isSuperAdmin || false);
        })
        .catch(() => {
          setPermissions([]);
          setIsSuperAdmin(false);
        });
    }
  }, [session]);

  if (isSuperAdmin) return true;
  return permissions.includes(permission);
}

export function useAnyPermission(permissions: string[]): boolean {
  const { data: session } = useSession();
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (session?.user?.permissions) {
      setUserPermissions(session.user.permissions);
      setIsSuperAdmin(session.user.isSuperAdmin || false);
    } else if (session) {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => {
          setUserPermissions(data.permissions || []);
          setIsSuperAdmin(data.isSuperAdmin || false);
        })
        .catch(() => {
          setUserPermissions([]);
          setIsSuperAdmin(false);
        });
    }
  }, [session]);

  if (isSuperAdmin) return true;
  return permissions.some(p => userPermissions.includes(p));
}

export function useIsSuperAdmin(): boolean {
  const { data: session } = useSession();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (session?.user?.isSuperAdmin !== undefined) {
      setIsSuperAdmin(session.user.isSuperAdmin);
    } else if (session) {
      fetch('/api/auth/permissions')
        .then(res => res.json())
        .then(data => setIsSuperAdmin(data.isSuperAdmin || false))
        .catch(() => setIsSuperAdmin(false));
    }
  }, [session]);

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
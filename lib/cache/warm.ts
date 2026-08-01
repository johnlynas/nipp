/**
 * Cache Warming — Pre-populate L1 cache on startup
 *
 * When the application starts, this module pre-populates the L1 in-memory cache
 * with frequently accessed data from the database:
 * - Organizations (all)
 * - Users (all)
 * - Roles (all, per organization)
 * - Permissions (master catalog)
 *
 * These entries are marked as "permanent" — they have no TTL and will only be
 * evicted if explicitly deleted (e.g., when an org/user/role is removed).
 */

import { getLruCache } from './lru';
import tenantDb from '@/lib/tenant-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WarmEntry {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Cache Warming Functions
// ---------------------------------------------------------------------------

/**
 * Warm the L1 cache with all organizations.
 */
async function warmOrganizations(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const organizations = await tenantDb.organization.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    for (const org of organizations) {
      const key = `org:${org.id}`;
      entries.push({ key, value: org });

      // Also cache the list entry for search
      const listKey = `org:list:${org.name.toLowerCase()}`;
      entries.push({ key: listKey, value: { id: org.id, name: org.name, slug: org.slug } });
    }

    console.log(`[Cache Warm] Loaded ${organizations.length} organizations into L1`);
  } catch (error) {
    console.error('[Cache Warm] Failed to warm organizations:', error);
  }

  return entries;
}

/**
 * Warm the L1 cache with all users.
 */
async function warmUsers(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const users = await tenantDb.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    for (const user of users) {
      const key = `user:${user.id}`;
      entries.push({ key, value: user });

      // Also cache the list entry for search
      const nameKey = `user:list:${user.name.toLowerCase()}`;
      entries.push({ key: nameKey, value: { id: user.id, name: user.name, email: user.email } });

      const emailKey = `user:list:${user.email.toLowerCase()}`;
      entries.push({ key: emailKey, value: { id: user.id, name: user.name, email: user.email } });
    }

    console.log(`[Cache Warm] Loaded ${users.length} users into L1`);
  } catch (error) {
    console.error('[Cache Warm] Failed to warm users:', error);
  }

  return entries;
}

/**
 * Warm the L1 cache with all roles (per organization).
 */
async function warmRoles(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    // Get all organizations first
    const organizations = await tenantDb.organization.findMany({
      select: { id: true },
    });

    for (const org of organizations) {
      const roles = await tenantDb.role.findMany({
        where: { organizationId: org.id },
        select: {
          id: true,
          name: true,
          description: true,
        },
      });

      for (const role of roles) {
        const key = `role:${org.id}:${role.id}`;
        entries.push({ key, value: role });

        // Also cache the list entry for search
        const listKey = `role:list:${org.id}:${role.name.toLowerCase()}`;
        entries.push({ key: listKey, value: { id: role.id, name: role.name, description: role.description } });
      }

      console.log(`[Cache Warm] Loaded ${roles.length} roles for org ${org.id}`);
    }
  } catch (error) {
    console.error('[Cache Warm] Failed to warm roles:', error);
  }

  return entries;
}

/**
 * Warm the L1 cache with all permissions (master catalog).
 */
async function warmPermissions(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const permissions = await tenantDb.permission.findMany({
      select: {
        id: true,
        key: true,
        resource: true,
        action: true,
        description: true,
      },
    });

    for (const perm of permissions) {
      const key = `perm:catalog:${perm.key}`;
      entries.push({ key, value: perm });

      // Also cache by resource for grouped display
      const resourceKey = `perm:resource:${perm.resource}`;
      entries.push({ key: resourceKey, value: { id: perm.id, key: perm.key, action: perm.action } });
    }

    console.log(`[Cache Warm] Loaded ${permissions.length} permissions into L1`);
  } catch (error) {
    console.error('[Cache Warm] Failed to warm permissions:', error);
  }

  return entries;
}

/**
 * Warm all caches. Called on application startup.
 */
export async function warmCache(): Promise<void> {
  const lru = getLruCache();
  if (!lru) {
    console.log('[Cache Warm] L1 cache is disabled (Edge runtime or feature flag)');
    return;
  }

  console.log('[Cache Warm] Starting cache warm...');

  // Run all warming tasks in parallel
  const [orgEntries, userEntries, roleEntries, permEntries] = await Promise.all([
    warmOrganizations(),
    warmUsers(),
    warmRoles(),
    warmPermissions(),
  ]);

  // Populate L1 cache with all entries (permanent, no TTL)
  const allEntries = [...orgEntries, ...userEntries, ...roleEntries, ...permEntries];

  for (const entry of allEntries) {
    try {
      lru.set(entry.key, JSON.stringify(entry.value));
    } catch (error) {
      console.error(`[Cache Warm] Failed to cache key ${entry.key}:`, error);
    }
  }

  console.log(`[Cache Warm] Completed — ${allEntries.length} entries loaded into L1`);
}

/**
 * Invalidate a specific entity from the cache.
 * Called when an org/user/role is deleted or updated.
 */
export async function invalidateEntity(type: 'org' | 'user' | 'role', id: string, orgId?: string): Promise<void> {
  const lru = getLruCache();
  if (!lru) return;

  try {
    switch (type) {
      case 'org':
        lru.delete(`org:${id}`);
        // Note: LRU doesn't support pattern deletion, so we'd need to track keys separately
        // For now, we rely on the TTL or manual invalidation
        break;

      case 'user':
        lru.delete(`user:${id}`);
        // Remove list entries (would need to track these separately for full cleanup)
        break;

      case 'role':
        if (orgId) {
          lru.delete(`role:${orgId}:${id}`);
        }
        break;

      default:
        console.warn(`[Cache Warm] Unknown entity type: ${type}`);
    }

    console.log(`[Cache Warm] Invalidated ${type} ${id}`);
  } catch (error) {
    console.error(`[Cache Warm] Failed to invalidate ${type} ${id}:`, error);
  }
}

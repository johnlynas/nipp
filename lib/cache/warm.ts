/**
 * Cache Warming — Pre-populate L1 cache on startup
 *
 * When the application starts, this module pre-populates the L1 in-memory cache
 * with frequently accessed data from the database:
 * - Organizations (all) — both entity keys and search result aggregation keys
 * - Users (all) — both entity keys and search result aggregation keys
 * - Roles (all, per organization) — both entity keys and search result aggregation keys
 * - Permissions (master catalog) — both entity keys and search result aggregation keys
 *
 * These entries are marked as "permanent" — they have no TTL and will only be
 * evicted if explicitly deleted (e.g., when an org/user/role is removed).
 *
 * RLS: this runs at process startup (instrumentation.ts) outside any request,
 * where no tenant ALS context exists. The app connects as the non-owner role
 * nipp_app, so every query needs a verified context bound via GUCs — every
 * warmer therefore runs inside inPlatformCtx() (platform admin flag on,
 * env-verified platform org id). Without that, RLS denies the empty-context
 * queries with 42501 and nothing is warmed.
 */

import { getLruCache } from './lru';
import tenantDb from '@/lib/tenant-db';
import { withPlatformContextForDB } from '@/lib/rls-transaction';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WarmEntry {
  key: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// RLS context wrapper for startup (out-of-request) queries
// ---------------------------------------------------------------------------

/**
 * Run `op` under a verified PLATFORM RLS context (flag=1, env platform org).
 * Returns null when PLATFORM_ORGANIZATION_ID is unset — warming is optional
 * and must never take startup down.
 */
async function inPlatformCtx<T>(op: () => Promise<T>): Promise<T | null> {
  const platformOrgId = env.PLATFORM_ORGANIZATION_ID;
  if (!platformOrgId) return null;
  return withPlatformContextForDB(platformOrgId, op);
}

// ---------------------------------------------------------------------------
// Cache Warming Functions
// ---------------------------------------------------------------------------

/**
 * Warm the L1 cache with all organizations.
 * Pre-populates both entity keys (org:{id}) and search result aggregation keys (search:org:{name}).
 */
async function warmOrganizations(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const organizations = await inPlatformCtx(() =>
      tenantDb.organization.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
    );
    if (!organizations) return entries;

    for (const org of organizations) {
      // Entity key — used by detail endpoints
      const entityKey = `org:${org.id}`;
      entries.push({ key: entityKey, value: org });

      // Search result aggregation key — used by search endpoint
      const normalizedName = org.name.toLowerCase();
      const searchKey = `search:org:${normalizedName}`;
      entries.push({
        key: searchKey,
        value: { results: [{ id: org.id, name: org.name, slug: org.slug }], total: 1 },
      });

      // Also cache the list entry for search
      const listKey = `org:list:${normalizedName}`;
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
 * Pre-populates both entity keys (user:{id}) and search result aggregation keys (search:user:{name}).
 */
async function warmUsers(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const users = await inPlatformCtx(() =>
      tenantDb.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
        },
      }),
    );
    if (!users) return entries;

    for (const user of users) {
      // Entity key — used by detail endpoints
      const entityKey = `user:${user.id}`;
      entries.push({ key: entityKey, value: user });

      // Search result aggregation keys — used by search endpoint (by name and email)
      const normalizedName = user.name.toLowerCase();
      const searchNameKey = `search:user:${normalizedName}`;
      entries.push({
        key: searchNameKey,
        value: { results: [{ id: user.id, name: user.name, email: user.email }], total: 1 },
      });

      const normalizedEmail = user.email.toLowerCase();
      const searchEmailKey = `search:user:${normalizedEmail}`;
      entries.push({
        key: searchEmailKey,
        value: { results: [{ id: user.id, name: user.name, email: user.email }], total: 1 },
      });

      // Also cache the list entry for search
      const nameKey = `user:list:${normalizedName}`;
      entries.push({ key: nameKey, value: { id: user.id, name: user.name, email: user.email } });

      const emailKey = `user:list:${normalizedEmail}`;
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
 * Pre-populates both entity keys and search result aggregation keys.
 */
async function warmRoles(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    // ONE platform context covers org list + per-org role queries.
    await inPlatformCtx(async () => {
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
          // Entity key — used by detail endpoints
          const entityKey = `role:${org.id}:${role.id}`;
          entries.push({ key: entityKey, value: role });

          // Search result aggregation key — used by search endpoint
          const normalizedName = role.name.toLowerCase();
          const searchKey = `search:role:${org.id}:${normalizedName}`;
          entries.push({
            key: searchKey,
            value: { results: [{ id: role.id, name: role.name, description: role.description }], total: 1 },
          });

          // Also cache the list entry for search
          const listKey = `role:list:${org.id}:${normalizedName}`;
          entries.push({ key: listKey, value: { id: role.id, name: role.name, description: role.description } });
        }

        console.log(`[Cache Warm] Loaded ${roles.length} roles for org ${org.id}`);
      }
    });
  } catch (error) {
    console.error('[Cache Warm] Failed to warm roles:', error);
  }

  return entries;
}

/**
 * Warm the L1 cache with all permissions (master catalog).
 * Pre-populates both entity keys and search result aggregation keys.
 */
async function warmPermissions(): Promise<WarmEntry[]> {
  const entries: WarmEntry[] = [];

  try {
    const permissions = await inPlatformCtx(() =>
      tenantDb.permission.findMany({
        select: {
          id: true,
          key: true,
          resource: true,
          action: true,
          description: true,
        },
      }),
    );
    if (!permissions) return entries;

    for (const perm of permissions) {
      // Entity key — used by detail endpoints
      const entityKey = `perm:catalog:${perm.key}`;
      entries.push({ key: entityKey, value: perm });

      // Search result aggregation key — used by search endpoint
      const normalizedKey = perm.key.toLowerCase();
      const searchKey = `search:perm:${normalizedKey}`;
      entries.push({
        key: searchKey,
        value: { results: [{ id: perm.id, key: perm.key, resource: perm.resource, action: perm.action, description: perm.description }], total: 1 },
      });

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

  if (!env.PLATFORM_ORGANIZATION_ID) {
    console.warn('[Cache Warm] PLATFORM_ORGANIZATION_ID unset — warming skipped (RLS fail-closed context unavailable at startup)');
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

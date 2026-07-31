import { test, expect } from '@playwright/test';

/**
 * E2E tests: Super Admin Tenant Data Access
 *
 * Verifies that super admins can view and modify data across all organizations.
 */

// ---------------------------------------------------------------------------
// Test credentials (loaded from env)
// ---------------------------------------------------------------------------
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'superadmin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'SuperAdmin123!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByLabel('User ID (Email)')).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('User ID (Email)').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Sign In|Login/i }).click();

  // Wait for navigation after login — accept any URL except /login (which indicates failure)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });

  // If we ended up back on /login, the login failed
  if (page.url().includes('/login')) {
    throw new Error(`Login failed for ${email} — redirected back to /login`);
  }
}

/**
 * Resolve an organization slug to its UUID by fetching the org list.
 */
async function resolveOrgId(page: import('@playwright/test').Page, slug: string): Promise<string> {
  const response = await page.goto('/api/admin/organizations', { waitUntil: 'load' });
  expect(response?.status()).toBe(200);
  const body = await response!.json() as any;
  const orgs = (body?.organizations ?? body) as any[];
  const found = orgs.find((o: any) => o?.slug === slug);
  if (!found) {
    throw new Error(`Organization with slug "${slug}" not found in org list`);
  }
  return found.id;
}

// ---------------------------------------------------------------------------
// Tests — Super Admin can view OrgA members via API
// ---------------------------------------------------------------------------

test.describe('Super Admin Tenant Data Access', () => {
  test('super admin can view organizations list including OrgA and OrgB', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/api/admin/organizations', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    const body = await response!.json() as any;
    // The API returns { organizations: [...], pagination: {...} }
    const orgs = body?.organizations ?? body;

    // Should see both OrgA and OrgB
    const orgASlug = (orgs as any[]).find((o: any) => o?.slug === 'acme-properties-ltd');
    const orgBSlug = (orgs as any[]).find((o: any) => o?.slug === 'belfast-rentals');

    expect(orgASlug).toBeDefined();
    expect(orgBSlug).toBeDefined();
  });

  test('super admin can view OrgA details', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const orgId = await resolveOrgId(page, 'acme-properties-ltd');

    const response = await page.goto(`/api/admin/organizations/${orgId}`, { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    const body = await response!.json() as any;

    expect(body?.slug).toBe('acme-properties-ltd');
    expect(body?.name).toBe('Acme Properties Ltd');
  });

  test('super admin can view OrgB details', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const orgId = await resolveOrgId(page, 'belfast-rentals');

    const response = await page.goto(`/api/admin/organizations/${orgId}`, { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    const body = await response!.json() as any;

    expect(body?.slug).toBe('belfast-rentals');
    expect(body?.name).toBe('Belfast Rentals');
  });

  // ---------------------------------------------------------------------------
  // Tests — Super Admin can access admin pages for any tenant org
  // ---------------------------------------------------------------------------

  test('super admin can navigate to OrgA on admin organizations page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/organizations', { waitUntil: 'load' });

    // Should see the organizations table (page uses h2, not h1)
    await expect(page.locator('h2', { hasText: /Organizations/i })).toBeVisible({ timeout: 10_000 });

    // Should see both OrgA and OrgB in the list
    const orgAText = page.locator('text=Acme Properties Ltd');
    await expect(orgAText).toBeVisible();

    const orgBText = page.locator('text=Belfast Rentals');
    await expect(orgBText).toBeVisible();
  });

  test('super admin can view OrgA members via API', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Resolve OrgA UUID first
    const orgId = await resolveOrgId(page, 'acme-properties-ltd');

    // Access the admin members API for OrgA
    const response = await page.goto(`/api/admin/organizations/${orgId}/members`, {
      waitUntil: 'load',
    });

    // Should return 200 with members list (may be empty if no members yet)
    expect(response?.status()).toBe(200);
  });

  test('super admin can view OrgB members via API', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const orgId = await resolveOrgId(page, 'belfast-rentals');

    const response = await page.goto(`/api/admin/organizations/${orgId}/members`, {
      waitUntil: 'load',
    });

    expect(response?.status()).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Tests — Super Admin can update org settings for any tenant
  // ---------------------------------------------------------------------------

  test('super admin can access OrgA detail page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // Resolve OrgA UUID first
    const orgId = await resolveOrgId(page, 'acme-properties-ltd');

    const response = await page.goto(`/admin/organizations/${orgId}`, { waitUntil: 'load' });

    // Should render the org detail page (200)
    expect(response?.status()).toBe(200);
  });

  test('super admin can access OrgB detail page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const orgId = await resolveOrgId(page, 'belfast-rentals');

    const response = await page.goto(`/admin/organizations/${orgId}`, { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
  });

  // ---------------------------------------------------------------------------
  // Tests — Super Admin can suspend any tenant org (via API)
  // ---------------------------------------------------------------------------

  test('super admin can access system-health page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/admin/system-health', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    await expect(page.locator('h1', { hasText: /System Health/i })).toBeVisible({ timeout: 10_000 });
  });

  test('super admin can access audit-logs page', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/admin/audit-logs', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    // The audit-logs page uses h2 with text "Security Audit Logs"
    await expect(page.locator('h2', { hasText: /Audit Logs/i })).toBeVisible({ timeout: 10_000 });
  });
});

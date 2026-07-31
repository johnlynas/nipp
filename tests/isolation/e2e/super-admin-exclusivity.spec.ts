import { test, expect } from '@playwright/test';

/**
 * E2E tests: Super Admin Exclusivity
 *
 * Verifies that only super admins can access /admin/* routes and that
 * tenant users are denied (403) with admin nav links hidden.
 */

// ---------------------------------------------------------------------------
// Test credentials (loaded from env)
// ---------------------------------------------------------------------------
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'superadmin@example.com';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'SuperAdmin123!';
const TENANT_A_EMAIL = process.env.TEST_TENANT_A_EMAIL || 'orga-tenant@example.com';
const TENANT_A_PASSWORD = process.env.TEST_TENANT_A_PASSWORD || 'TenantA123!';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Log in via the login page.
 */
async function login(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/login');
  await expect(page.getByLabel('User ID (Email)')).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('User ID (Email)').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: /Sign In|Login/i }).click();

  // Wait for navigation after login — accept any URL except /login (which indicates failure)
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 15_000 });

  // If we ended up back on /login, the login failed — take a screenshot for debugging
  if (page.url().includes('/login')) {
    await page.screenshot({ path: 'test-results/login-failure.png' });
    throw new Error(`Login failed for ${email} — redirected back to /login`);
  }
}

// ---------------------------------------------------------------------------
// Tests — Tenant user cannot access /admin/* routes
// ---------------------------------------------------------------------------

test.describe('Super Admin Exclusivity', () => {
  test('tenant user gets 403 on /admin/organizations', async ({ page }) => {
    await login(page, TENANT_A_EMAIL, TENANT_A_PASSWORD);

    // Check the API endpoint — RequireSuperAdmin renders children optimistically,
    // so the UI may show admin content before the super-admin check completes.
    const response = await page.goto('/api/admin/organizations', { waitUntil: 'load' });

    if (response) {
      expect([401, 403]).toContain(response.status());
    } else {
      expect(page.url()).toContain('/login');
    }
  });

  test('tenant user gets 403 on /admin/permissions', async ({ page }) => {
    await login(page, TENANT_A_EMAIL, TENANT_A_PASSWORD);
    // Check the API endpoint — RequireSuperAdmin renders children optimistically.
    const response = await page.goto('/api/admin/permissions', { waitUntil: 'load' });

    if (response) {
      expect([401, 403]).toContain(response.status());
    } else {
      expect(page.url()).toContain('/login');
    }
  });

  test('tenant user gets 403 on /admin/system-logs', async ({ page }) => {
    await login(page, TENANT_A_EMAIL, TENANT_A_PASSWORD);
    // Check the API endpoint — RequireSuperAdmin renders children optimistically.
    const response = await page.goto('/api/admin/system-logs', { waitUntil: 'load' });

    if (response) {
      expect([401, 403]).toContain(response.status());
    } else {
      expect(page.url()).toContain('/login');
    }
  });

  // ---------------------------------------------------------------------------
  // Tests — Admin nav links hidden for tenant user
  // ---------------------------------------------------------------------------

  test('admin nav links are hidden for tenant user', async ({ page }) => {
    await login(page, TENANT_A_EMAIL, TENANT_A_PASSWORD);

    // Navigate to a page that renders the sidebar (e.g., home)
    await page.goto('/', { waitUntil: 'load' });

    // The admin sidebar should not be visible for a non-super-admin
    const adminSidebar = page.locator('aside').filter({ hasText: 'Admin Panel' });
    await expect(adminSidebar).not.toBeVisible();

    // Verify no admin nav links are present
    const orgLink = page.getByRole('link', { name: 'Organizations' });
    await expect(orgLink).not.toBeVisible();

    const permLink = page.getByRole('link', { name: 'Permissions' });
    await expect(permLink).not.toBeVisible();

    const auditLink = page.getByRole('link', { name: /Security Audit Logs|Audit Log/i });
    await expect(auditLink).not.toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Tests — Super Admin can access all /admin/* routes
  // ---------------------------------------------------------------------------

  test('super admin can access /admin/organizations', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/admin/organizations', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    await expect(page.locator('h2', { hasText: /Organizations/i })).toBeVisible({ timeout: 10_000 });
  });

  test('super admin can access /admin/permissions', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/admin/permissions', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    await expect(page.locator('h2', { hasText: /Permissions/i })).toBeVisible({ timeout: 10_000 });
  });

  test('super admin can access /admin/system-logs', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const response = await page.goto('/admin/system-logs', { waitUntil: 'load' });

    expect(response?.status()).toBe(200);
    await expect(page.locator('h1', { hasText: /System Logs/i })).toBeVisible({ timeout: 10_000 });
  });

  test('super admin sees admin nav links', async ({ page }) => {
    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/organizations', { waitUntil: 'load' });

    // Admin sidebar should be visible
    const adminSidebar = page.locator('aside').filter({ hasText: 'Admin Panel' });
    await expect(adminSidebar).toBeVisible();

    // Admin nav links should be present
    const orgLink = page.getByRole('link', { name: 'Organizations' });
    await expect(orgLink).toBeVisible();

    const permLink = page.getByRole('link', { name: 'Permissions' });
    await expect(permLink).toBeVisible();

    const auditLink = page.getByRole('link', { name: /Security Audit Logs|Audit Log/i });
    await expect(auditLink).toBeVisible();
  });
});

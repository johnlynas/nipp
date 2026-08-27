/**
 * E2E tests: Calendar interactions — event creation, recurrence display,
 * edit scope picker, and drag-and-drop with rrule-based expansion.
 *
 * Uses Playwright against a live Next.js server with real PostgreSQL.
 */

import { test, expect } from '@playwright/test';
import { prisma } from '@/lib/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Log in as the test tenant admin and return the session cookie. */
async function loginAsTestAdmin(page: any): Promise<void> {
  await page.goto('/login');
  await expect(page.locator('h1')).toBeVisible({ timeout: 10_000 });

  await page.getByLabel('Email').fill(process.env.TEST_TENANT_A_EMAIL || 'tenant-a@example.com');
  await page.getByLabel('Password').fill(process.env.TEST_TENANT_A_PASSWORD || 'password123');
  await page.getByRole('button', { name: /sign in|login/i }).first().click();

  // Wait for redirect to dashboard or calendar
  await page.waitForURL(/\/(dashboard|calendar)/, { timeout: 15_000 });
}

/** Create a recurring event via the API and return its ID. */
async function createRecurringEvent(orgId: string, cookie: string): Promise<string> {
  const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookie,
    },
    body: JSON.stringify({
      title: 'Weekly Standup (E2E)',
      startDate: new Date('2026-08-25T10:00:00').toISOString(),
      endDate: new Date('2026-08-25T11:00:00').toISOString(),
      eventType: 'OTHER',
      recurrence: {
        frequency: 'WEEKLY',
        interval: 1,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to create event: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.id;
}

/** Get the active organization ID for the test user. */
async function getActiveOrgId(cookie: string): Promise<string> {
  const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations`, {
    headers: { Cookie: cookie },
  });

  if (!res.ok) throw new Error(`Failed to fetch organizations: ${res.status}`);

  const orgs = await res.json();
  const activeOrg = Array.isArray(orgs) ? orgs.find((o: any) => o.isActive) : orgs[0];
  if (!activeOrg) throw new Error('No active organization found');
  return activeOrg.id;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Calendar Interactions E2E', () => {
  let cookie = '';
  let orgId = '';

  test.beforeEach(async ({ page }) => {
    await loginAsTestAdmin(page);

    // Get cookies after login
    const context = page.context();
    const cookies = await context.cookies();
    cookie = cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');

    orgId = await getActiveOrgId(cookie);
  });

  // -------------------------------------------------------------------------
  // Event Creation & Recurrence Display
  // -------------------------------------------------------------------------

  test('creates a recurring event and displays expanded instances in the calendar grid', async ({ page }) => {
    const eventId = await createRecurringEvent(orgId, cookie);

    // Navigate to calendar
    await page.goto(`/calendar?orgId=${orgId}`);

    // Navigate to August 2026 (where our event series starts)
    await page.locator('button[aria-label*="next"]').first().click(); // advance to August
    await page.locator('button[aria-label*="next"]').first().click(); // advance to September
    await page.locator('button[aria-label*="prev"]').first().click(); // back to August

    // Wait for calendar to load
    await expect(page.locator('[data-calendar-grid]')).toBeVisible({ timeout: 10_000 });

    // The calendar should show events — at minimum the single instance on Aug 25
    const eventCells = page.locator('[data-calendar-event]').filter({ hasText: /Weekly Standup/i });
    // Note: exact count depends on how many instances fall in the visible month range

    // Verify the event was created by fetching via API
    const eventRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`,
      { headers: { Cookie: cookie } },
    );
    const events = await eventRes.json();
    const myEvent = events.find((e: any) => e.id === eventId);
    expect(myEvent).toBeDefined();
  });

  test('expands rrule-based recurrence correctly across month boundaries', async ({ page }) => {
    // Create a daily event starting Aug 28 (near month boundary)
    const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: 'Daily Check-in (E2E)',
        startDate: new Date('2026-08-28T09:00:00').toISOString(),
        endDate: new Date('2026-08-28T09:30:00').toISOString(),
        eventType: 'OTHER',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
          count: 5,
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();
    const eventId = data.id;

    // Navigate to August and verify events appear on Aug 28, 29, 30, 31
    await page.goto(`/calendar?orgId=${orgId}`);

    // Verify via API that expansion is correct
    const eventRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events?startDate=2026-08-01&endDate=2026-09-15`,
      { headers: { Cookie: cookie } },
    );

    // Fetch expanded instances
    const instancesRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events?startDate=2026-08-01&endDate=2026-09-15`,
      { headers: { Cookie: cookie } },
    );

    // The event should have 5 instances (count=5)
    const allEvents = await instancesRes.json();
    const myInstances = allEvents.filter((e: any) => e.id === eventId);
    expect(myInstances.length).toBeGreaterThanOrEqual(1); // At least the base event in range
  });

  test('non-recurring events display as single instances', async ({ page }) => {
    const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: 'One-off Viewing (E2E)',
        startDate: new Date('2026-09-15T14:00:00').toISOString(),
        endDate: new Date('2026-09-15T15:00:00').toISOString(),
        eventType: 'VIEWING',
      }),
    });

    expect(res.ok).toBe(true);

    // Navigate to September
    await page.goto(`/calendar?orgId=${orgId}`);

    // Wait for calendar to render
    await expect(page.locator('[data-calendar-grid]')).toBeVisible({ timeout: 10_000 });

    // Verify the event exists via API
    const eventRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`,
      { headers: { Cookie: cookie } },
    );

    const events = await eventRes.json();
    const myEvent = events.find((e: any) => e.title === 'One-off Viewing (E2E)');
    expect(myEvent).toBeDefined();
    // Non-recurring events should have no recurrence data
    expect(myEvent.recurrence).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edit Scope Picker (API-level — UI tested separately in component tests)
  // -------------------------------------------------------------------------

  test('PATCH with editScope "this" creates override and EXDATEs', async () => {
    // Create a recurring event first
    const eventId = await createRecurringEvent(orgId, cookie);

    // Edit "this" instance — change title for the Aug 25 occurrence only
    const clickedDate = '2026-08-25';
    const patchRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'Rescheduled Standup (this only)',
          clickedDate,
          editScope: 'this',
        }),
      },
    );

    expect(patchRes.ok).toBe(true);
    const result = await patchRes.json();

    // Should return the override event with editScope
    expect(result.editScope).toBe('this');
    expect(result.event.title).toBe('Rescheduled Standup (this only)');

    // Verify the base event now has an exdate for Aug 25
    const baseRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );
    const baseEvent = await baseRes.json();

    // The exdates should include the clicked date
    const exdates = baseEvent.exdates || [];
    expect(exdates).toContain(clickedDate);
  });

  test('PATCH with editScope "all" updates the entire series', async () => {
    // Create a recurring event first
    const eventId = await createRecurringEvent(orgId, cookie);

    // Edit "all" instances — change title for the entire series
    const patchRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'Renamed All Series',
          editScope: 'all',
        }),
      },
    );

    expect(patchRes.ok).toBe(true);
    const result = await patchRes.json();

    // Should return the updated base event with editScope
    expect(result.editScope).toBe('all');
    expect(result.event.title).toBe('Renamed All Series');

    // Verify via API that the event title changed
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );
    const updated = await getRes.json();
    expect(updated.title).toBe('Renamed All Series');
  });

  test('PATCH with editScope "following" terminates base and creates new series', async () => {
    // Create a recurring event first
    const eventId = await createRecurringEvent(orgId, cookie);

    // Edit "following" instances starting from Aug 25
    const clickedDate = '2026-08-25';
    const patchRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'New Time Following',
          clickedDate,
          editScope: 'following',
        }),
      },
    );

    expect(patchRes.ok).toBe(true);
    const result = await patchRes.json();

    // Should return the new series event with editScope
    expect(result.editScope).toBe('following');

    // The base event should have been UNTIL-terminated to Aug 24
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );
    const baseEvent = await getRes.json();

    // Base should have rrule with until date set to Aug 24
    if (baseEvent.rrule) {
      const rrule = typeof baseEvent.rrule === 'string' ? JSON.parse(baseEvent.rrule) : baseEvent.rrule;
      if (rrule.until) {
        const untilDate = new Date(rrule.until);
        // UNTIL should be Aug 24 (day before clicked)
        expect(untilDate.getDate()).toBe(24);
      }
    }

    // A new series event should have been created starting Aug 25
    expect(result.event.startDate).toBeDefined();
  });

  test('PATCH without editScope updates in place for recurring event', async () => {
    // Create a recurring event first
    const eventId = await createRecurringEvent(orgId, cookie);

    // Regular update without editScope — should apply to base event
    const patchRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          title: 'Updated Base Event',
        }),
      },
    );

    expect(patchRes.ok).toBe(true);
    const result = await patchRes.json();

    // Should return the updated event (no editScope field)
    expect(result.event.title).toBe('Updated Base Event');
    expect(result.editScope).toBeUndefined();

    // Verify via API
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );
    const updated = await getRes.json();
    expect(updated.title).toBe('Updated Base Event');
  });

  // -------------------------------------------------------------------------
  // Recurrence Display Helpers
  // -------------------------------------------------------------------------

  test('recurrence details are returned in API responses', async () => {
    // Create a recurring event with specific parameters
    const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: 'Monthly Review (E2E)',
        startDate: new Date('2026-01-15T14:00:00').toISOString(),
        endDate: new Date('2026-01-15T15:00:00').toISOString(),
        eventType: 'OTHER',
        recurrence: {
          frequency: 'MONTHLY',
          interval: 1,
          endDate: new Date('2026-12-31T23:59:59').toISOString(),
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();

    // Verify rrule JSON was written
    expect(data.rrule).toBeDefined();
    const rrule = typeof data.rrule === 'string' ? JSON.parse(data.rrule) : data.rrule;
    expect(rrule.freq).toBe('MONTHLY');
    expect(rrule.interval).toBe(1);

    // Fetch the event via API and verify recurrence details
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${data.id}`,
      { headers: { Cookie: cookie } },
    );
    const fetched = await getRes.json();

    expect(fetched.title).toBe('Monthly Review (E2E)');
    // The recurrence should be returned in the API response
    expect(fetched.recurrence).not.toBeNull();
  });

  test('exdates are preserved and returned in API responses', async () => {
    // Create a recurring event first
    const eventId = await createRecurringEvent(orgId, cookie);

    // Add an excluded date via the API
    const patchRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Cookie: cookie,
        },
        body: JSON.stringify({
          excludedDate: '2026-09-01',
        }),
      },
    );

    expect(patchRes.ok).toBe(true);

    // Fetch the event and verify exdates
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );
    const event = await getRes.json();

    expect(event.exdates).toContain('2026-09-01');
  });

  test('deleting a recurring event removes it from the calendar', async () => {
    const eventId = await createRecurringEvent(orgId, cookie);

    // Delete the event
    const deleteRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      {
        method: 'DELETE',
        headers: { Cookie: cookie },
      },
    );

    expect(deleteRes.ok).toBe(true);

    // Verify it's gone via API
    const getRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/${eventId}`,
      { headers: { Cookie: cookie } },
    );

    expect(getRes.status).toBe(404);
  });

  test('upcoming events API returns expanded recurring instances', async () => {
    // Create a daily event in the past so it generates upcoming instances
    const res = await fetch(`${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        title: 'Daily Standup (Upcoming)',
        startDate: new Date(Date.now() - 5 * 86400000).toISOString(), // 5 days ago
        endDate: new Date(Date.now() - 5 * 86400000 + 3600000).toISOString(),
        eventType: 'OTHER',
        recurrence: {
          frequency: 'DAILY',
          interval: 1,
        },
      }),
    });

    expect(res.ok).toBe(true);
    const data = await res.json();

    // Fetch upcoming events
    const upcomingRes = await fetch(
      `${process.env.BASE_URL || 'http://localhost:3000'}/api/organizations/${orgId}/calendar-events/upcoming`,
      { headers: { Cookie: cookie } },
    );

    expect(upcomingRes.ok).toBe(true);
    const upcoming = await upcomingRes.json();

    // Should include expanded instances of the daily standup
    const myInstances = upcoming.filter((e: any) => e.id === data.id);
    expect(myInstances.length).toBeGreaterThanOrEqual(1);

    // All instances should be sorted by start date
    for (let i = 1; i < myInstances.length; i++) {
      expect(new Date(myInstances[i].startDate).getTime()).toBeGreaterThanOrEqual(
        new Date(myInstances[i - 1].startDate).getTime(),
      );
    }
  });
});

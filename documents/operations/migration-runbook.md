# Calendar Recurrence Migration Runbook

## Overview

This runbook documents the migration from the legacy `CalendarRecurrence` table + `recurrenceId` scalar to the new rrule-based hybrid architecture. The migration consolidates recurrence data into JSON columns on the `CalendarEvent` model, eliminating a table join and enabling RFC 5545-compliant recurrence expansion.

## Pre-Migration Checklist

- [ ] All code changes on `interactive-calendar` branch have been reviewed and tested locally.
- [ ] Unit tests pass: `npm test -- run`
- [ ] Integration tests pass: `npm test -- integration`
- [ ] All calendar service queries filter by `organizationId`.
- [ ] Seed data updated to use rrule JSON format (see `prisma/seed.ts`).
- [ ] Database connection string and credentials verified for target environment.

---

## Step 1: Backup the Database

### PostgreSQL (Supabase / RDS)

```bash
# Full database backup
pg_dump -h <HOST> -U <USER> -d <DATABASE> --format=custom --file=calendar-recurrence-migration-backup.dump

# Alternatively, SQL format for readability:
pg_dump -h <HOST> -U <USER> -d <DATABASE> --format=plain --file=calendar-recurrence-migration-backup.sql
```

### Verify the backup

```bash
pg_restore -l calendar-recurrence-migration-backup.dump | wc -l  # Should show many entries
```

### Record pre-migration state

```sql
-- Count of events with recurrence data (should be > 0 in production)
SELECT COUNT(*) FROM "CalendarEvent" WHERE rrule IS NOT NULL;

-- Count of legacy recurrence records (should be 0 if migration already ran on this DB)
SELECT COUNT(*) FROM "CalendarRecurrence";

-- Count of events with recurrenceId set (legacy data)
SELECT COUNT(*) FROM "CalendarEvent" WHERE "recurrenceId" IS NOT NULL;

-- Verify rrule data integrity
SELECT id, title, rrule FROM "CalendarEvent" WHERE rrule IS NOT NULL LIMIT 5;
```

---

## Step 2: Apply Schema Changes

### Option A: Prisma Migrate (if using migration files)

```bash
# Preview the changes
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datasource <PREVIOUS_SCHEMA>

# Run the migration
npx prisma migrate dev --name remove_legacy_recurrence
```

### Option B: Prisma DB Push (used in this project)

> ⚠️ **WARNING**: This will drop the `CalendarRecurrence` table and `recurrenceId` column. Any remaining legacy data in these will be permanently deleted.

```bash
npx prisma db push --accept-data-loss
```

### Verify schema changes

```sql
-- CalendarRecurrence table should no longer exist
SELECT EXISTS (
  SELECT FROM information_schema.tables
  WHERE table_name = 'CalendarRecurrence'
); -- Should return false

-- recurrenceId column should no longer exist on CalendarEvent
SELECT column_name FROM information_schema.columns
WHERE table_name = 'CalendarEvent' AND column_name = 'recurrenceId'; -- Should return 0 rows

-- rrule and exdates columns should exist
SELECT column_name FROM information_schema.columns
WHERE table_name = 'CalendarEvent' AND column_name IN ('rrule', 'exdates');
-- Should return both columns

-- Verify existing events still have their rrule data intact
SELECT id, title,
  CASE WHEN rrule IS NOT NULL THEN 'OK' ELSE 'MISSING' END AS rrule_status,
  CASE WHEN exdates IS NOT NULL THEN 'OK' ELSE 'NONE' END AS exdates_status
FROM "CalendarEvent" WHERE rrule IS NOT NULL OR exdates IS NOT NULL;
```

---

## Step 3: Verify Application Functionality

### Smoke tests (run after deployment)

1. **Calendar view loads** — Navigate to the calendar page, verify month/week/day views render correctly.
2. **Non-recurring events** — Create, read, update, delete a single event. Verify it appears correctly.
3. **Recurring events** — Create an event with daily/weekly/monthly recurrence. Verify:
   - Event appears on correct dates in the calendar grid.
   - Recurrence label displays correctly (e.g., "Daily", "Every 2 weekly").
4. **EXDATE / Exclude date** — Drag an event instance to exclude it, or use "Exclude" in the modal. Verify:
   - The excluded date does not show the event.
   - Other instances still appear normally.
5. **Edit scopes** — Open a recurring event, click "Edit this", "This and following", or "All":
   - **This**: Event only changes on the clicked date; other instances unchanged.
   - **This and following**: Clicked date + future instances changed; past instances unchanged.
   - **All**: All instances updated to match the new values.
6. **Year view** — Navigate to year view, verify events span correctly across months.

### API-level verification

```bash
# Create a recurring event via API
curl -X POST http://localhost:3000/api/organizations/<orgId>/calendar-events \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Recurring Event",
    "startDate": "2026-08-25T10:00:00",
    "endDate": "2026-08-25T11:00:00",
    "eventType": "OTHER",
    "calendarId": "<calId>",
    "rrule": {
      "freq": "WEEKLY",
      "interval": 1,
      "dtstart": "2026-08-25T10:00:00",
      "count": 5
    }
  }'

# Query events for a date range
curl http://localhost:3000/api/organizations/<orgId>/calendar-events?start=2026-08-25&end=2026-09-30
```

---

## Step 4: Rollback Plan

If issues are discovered post-migration, follow these steps to rollback.

### Step 4a: Stop Application Traffic

```bash
# Scale down the application to zero replicas (cloud provider specific)
# Example for Vercel: pause deployment
# Example for Docker/K8s: kubectl scale deploy <app> --replicas=0
```

### Step 4b: Restore Database Backup

```bash
# For custom format backup
pg_restore -h <HOST> -U <USER> -d <DATABASE> --clean --if-exists calendar-recurrence-migration-backup.dump

# For SQL format backup
psql -h <HOST> -U <USER> -d <DATABASE> -f calendar-recurrence-migration-backup.sql
```

### Step 4c: Revert Schema Changes

If using Prisma Migrate, run the reverse migration:

```bash
npx prisma migrate resolve --rolled-back <MIGRATION_NAME>
# Or apply the revert migration:
npx prisma migrate dev --name restore_legacy_recurrence
```

If using `db push`, re-apply the previous schema:

```bash
# Checkout the commit before the migration branch was merged
git checkout <PRE-MIGRATION_COMMIT>
npx prisma db push --accept-data-loss
```

### Step 4d: Deploy Previous Application Version

Deploy the version of the code that was running before the migration.

### Step 4e: Verify Rollback

Repeat the smoke tests from Step 3 to confirm the application is functioning with the legacy schema.

---

## Troubleshooting

### Problem: Events with rrule are not expanding in the calendar view

**Possible causes**:
1. The `recurrence-rrule.ts` module is not being imported correctly. Check browser console for import errors.
2. The `rrule` library is not installed: run `npm install rrule`.
3. rrule JSON format mismatch — verify the `freq` field uses uppercase values (`DAILY`, `WEEKLY`, etc.).

**Fix**:
```bash
# Verify rrule is installed
npm ls rrule

# Check that the expansion function works
node -e "const { expandRecurrenceWithRrule } = require('./lib/recurrence-rrule'); console.log('OK');"
```

### Problem: Edit scopes are not working after migration

**Possible causes**:
1. `recurrence-scopes.ts` is still referencing the old `CalendarRecurrence` model — verify all imports point to `recurrence-rrule.ts`.
2. The `exdates` field is not being written correctly on the database (check Prisma schema has `exdates Json?`).

**Fix**: Verify the service layer calls `addExdate()` and `updateEventRrule()` correctly. Check database records:
```sql
SELECT id, rrule, exdates FROM "CalendarEvent" WHERE title = 'Test Event';
```

### Problem: Seed data fails with rrule JSON type error

**Possible causes**: Prisma client not regenerated after schema change.

**Fix**:
```bash
npx prisma generate
npm run seed
```

---

## Post-Migration Cleanup (Optional, after verification period)

Once the migration is confirmed stable (typically 1-2 weeks):

1. **Remove legacy enum** — If `CalendarRecurrenceFrequency` is no longer referenced in the Prisma schema or code, remove it.
2. **Remove stale migration scripts** — Delete `scripts/migrate-recurrence-to-rrule.ts` if it still exists.
3. **Update API documentation** — Reflect the new rrule JSON format in any OpenAPI/Swagger docs.
4. **Monitor error logs** — Check for recurrence-related errors in production logging for 7 days post-migration.

---

## Contacts

- **Engineering Lead**: John Lynas
- **Repository**: `/Users/johnlynas/dev/nipp-0807/`
- **Branch**: `interactive-calendar`
- **Planning doc**: `documents/feature-planning-and-development/interactive-calendar.md`

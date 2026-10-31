-- Better Auth 1.7 follow-up: RLS policies on "Member" and "Invitation" were
-- created (20260919) against the pre-rename column name "orgId". Migration
-- 20261031000000 renamed the columns, Postgres did NOT rewrite policy bodies,
-- so these policies query a nonexistent column and fail closed with SQLState
-- 42703 (column "orgId" does not exist) on ANY Member/Invitation access under
-- the app role — including Better Auth's own runtime schema check.
-- Recreate both policies against "organizationId" (identical to the seed
-- bootstrap statements in prisma/seed.ts and policy-catalog.golden).
-- Idempotent: a fresh `migrate deploy` gets no-op DROPs here (the seed path
-- creates these only on the app dev db; the scratch RLS fixture applies this
-- migration chain, where 20260919 created them on orgId so the DROP hits).
DROP POLICY IF EXISTS rls_member_isolated ON "Member";
CREATE POLICY rls_member_isolated ON "Member"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

DROP POLICY IF EXISTS rls_invitation_isolated ON "Invitation";
CREATE POLICY rls_invitation_isolated ON "Invitation"
  USING ("organizationId"::text = current_setting('app.current_org_id', true)
         OR NULLIF(current_setting('app.is_platform_admin', true), '')::int = 1)
  WITH CHECK ("organizationId"::text = current_setting('app.current_org_id', true));

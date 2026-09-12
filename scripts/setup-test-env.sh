#!/usr/bin/env bash
# ============================================================================
# setup-test-env.sh — Prepare the nipp databases
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# 1. Load test environment variables if .env.test exists
# ---------------------------------------------------------------------------
if [ -f "$PROJECT_ROOT/.env.test" ]; then
  set -a
  source "$PROJECT_ROOT/.env.test"
  set +a
  echo "✅ Loaded .env.test"
else
  echo "⚠️  No .env.test found — using defaults from .env.test.example"
fi

# ---------------------------------------------------------------------------
# 2. Start Docker test infrastructure (PostgreSQL + PgBouncer)
# ---------------------------------------------------------------------------
echo ""
echo "🐳 Starting Docker test infrastructure..."

# Use postgres superuser for all DB operations (pgbouncer forwards as postgres)
PG_USER="postgres"
PG_PASS="postgres"

cd "$PROJECT_ROOT"
mkdir -p tmp

docker compose -f docker-compose.test.yml up -d 2>&1

# Wait for PostgreSQL to be ready (host port 5432)
echo "⏳ Waiting for PostgreSQL to become available on host port 5432..."
for i in $(seq 1 30); do
  if PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d nipp_test -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ PostgreSQL is ready"
    break
  fi
  sleep 2
done

# Wait for pgbouncer to be ready (host port 6432)
echo "⏳ Waiting for pgbouncer to become available on host port 6432..."
for i in $(seq 1 30); do
  if PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 6432 -U "$PG_USER" -d nipp_test -c "SELECT 1;" > /dev/null 2>&1; then
    echo "✅ pgbouncer is ready"
    # Terminate lingering connections so we can drop/recreate the database
    PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d nipp_test -c "
      SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = 'nipp_test' AND pid <> pg_backend_pid();
    " > /dev/null 2>&1 || true
    break
  fi
  sleep 2
done

# ---------------------------------------------------------------------------
# 3. Create the nipp_test database (if it doesn't exist)
# ---------------------------------------------------------------------------
echo ""
echo "📦 Creating nipp_test database..."

DB_USER="${DB_USER:-nipp}"
DB_PASS="${DB_PASS:-nipp_test_pass}"

# Check if database already exists (connect to PostgreSQL on host port 5432)
if PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d postgres -tAc \
   "SELECT 1 FROM pg_database WHERE datname = 'nipp_test'" | grep -q 1; then
  echo "⚠️  nipp_test already exists — dropping and recreating..."
  PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d postgres -c "DROP DATABASE nipp_test;"
fi

PGPASSWORD="$PG_PASS" psql -h 127.0.0.1 -p 5432 -U "$PG_USER" -d postgres -c "CREATE DATABASE nipp_test;"
echo "✅ Database created: nipp_test"

# ---------------------------------------------------------------------------
# 4. Push Prisma schema to the test database (connect directly via host port 5432)
# ---------------------------------------------------------------------------
echo ""
echo "📋 Pushing Prisma schema to nipp_test..."

# Use direct PostgreSQL connection (host port 5432) — avoids pgbouncer auth issues
export DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@127.0.0.1:5432/nipp_test?pgbouncer=true"
cd "$PROJECT_ROOT"

npx prisma generate 2>&1 | tail -5
npx prisma db push --accept-data-loss 2>&1 | tail -5

echo "✅ Prisma schema pushed"

# ---------------------------------------------------------------------------
# 5. Seed the test database
# ---------------------------------------------------------------------------
echo ""
echo "🌱 Seeding test database..."

# Seed script requires ADMIN_EMAIL and ADMIN_PASSWORD (not TEST_ prefixed)
export ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-superadmin@example.com}"
export ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-SuperAdmin123!}"

# Also export TEST_ prefixed vars for the app at runtime
export TEST_ADMIN_EMAIL="${TEST_ADMIN_EMAIL:-superadmin@example.com}"
export TEST_ADMIN_PASSWORD="${TEST_ADMIN_PASSWORD:-SuperAdmin123!}"
export TEST_TENANT_A_EMAIL="${TEST_TENANT_A_EMAIL:-orga-tenant@example.com}"
export TEST_TENANT_A_PASSWORD="${TEST_TENANT_A_PASSWORD:-TenantA123!}"
export TEST_TENANT_B_EMAIL="${TEST_TENANT_B_EMAIL:-orgb-tenant@example.com}"
export TEST_TENANT_B_PASSWORD="${TEST_TENANT_B_PASSWORD:-TenantB123!}"

cd "$PROJECT_ROOT"
npm run db:seed 2>&1 | tail -20

echo ""
echo "✅ Test environment setup complete!"
echo "   Database: nipp_test (PostgreSQL host :5432, pgbouncer host :6433)"
echo "   Super Admin: $TEST_ADMIN_EMAIL / $TEST_ADMIN_PASSWORD"
echo "   OrgA Tenant: $TEST_TENANT_A_EMAIL / $TEST_TENANT_A_PASSWORD"
echo "   OrgB Tenant: $TEST_TENANT_B_EMAIL / $TEST_TENANT_B_PASSWORD"

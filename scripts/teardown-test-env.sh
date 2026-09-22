#!/usr/bin/env bash
# ============================================================================
# teardown-test-env.sh — Clean up the nipp_test database and Docker services
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
fi

# Owner identity used to drop the DB — override in .env.test (defaults match
# docker-compose.test.yml's POSTGRES_USER/POSTGRES_PASSWORD).
DB_USER="${DB_USER:-${POSTGRES_USER:-postgres}}"
DB_PASS="${DB_PASS:-${POSTGRES_PASSWORD:-postgres}}"
PG_PORT="${PG_PORT:-${POSTGRES_PORT:-5432}}"

# ---------------------------------------------------------------------------
# 2. Drop the nipp_test database
# ---------------------------------------------------------------------------
echo "🗑️  Dropping nipp_test database..."

if PGPASSWORD="$DB_PASS" psql -h localhost -p "$PG_PORT" -U "$DB_USER" -d postgres -tAc \
   "SELECT 1 FROM pg_database WHERE datname = 'nipp_test'" | grep -q 1; then
  PGPASSWORD="$DB_PASS" psql -h localhost -p "$PG_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE nipp_test;"
  echo "✅ Database dropped: nipp_test"
else
  echo "ℹ️  nipp_test does not exist — skipping drop"
fi

# ---------------------------------------------------------------------------
# 3. Stop Docker test infrastructure
# ---------------------------------------------------------------------------
echo ""
echo "🐳 Stopping Docker test infrastructure..."

cd "$PROJECT_ROOT"
docker compose -f docker-compose.test.yml down 2>&1 | tail -3

echo ""
echo "✅ Test environment teardown complete!"

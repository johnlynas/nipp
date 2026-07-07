#!/usr/bin/env bash
# ============================================================
# Property NI — Database Setup Script
# ============================================================
# Creates the nipp_dev and nipp_prod databases, then guides you
# through the remaining setup steps.
#
# Usage: bash scripts/setup-db.sh
# Prerequisites: PostgreSQL running, psql available on PATH
# ============================================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "============================================================"
echo "  Property NI — Database Setup"
echo "============================================================"
echo ""

# --- Check prerequisites ---
echo -e "${YELLOW}Checking prerequisites...${NC}"

if ! command -v psql &>/dev/null; then
    echo -e "${RED}Error: psql not found. Install PostgreSQL client tools.${NC}"
    exit 1
fi

if ! command -v npx &>/dev/null; then
    echo -e "${RED}Error: npm/npx not found. Install Node.js 22 LTS.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ psql found: $(psql --version)${NC}"
echo -e "${GREEN}✓ npx found: $(npx --version)${NC}"
echo ""

# --- Create databases ---
DB_USER="${PGUSER:-postgres}"
SQL_FILE="$(cd "$(dirname "$0")" && pwd)/setup-db.sql"

echo -e "${YELLOW}Creating databases as user '${DB_USER}'...${NC}"
psql -U "$DB_USER" -f "$SQL_FILE"

echo ""

# --- Guide through remaining steps ---
echo "============================================================"
echo "  Next Steps"
echo "============================================================"
echo ""
echo "1. Configure environment variables:"
echo "     cp .env.example .env"
echo "     # Edit .env with your DATABASE_URL and secrets"
echo ""
echo "2. Generate Prisma client:"
echo "     npx prisma generate"
echo ""
echo "3. Push schema to the database:"
echo "     npx prisma db push"
echo ""
echo "4. Seed the database (creates admin user + permissions):"
echo "     npm run db:seed"
echo ""
echo "5. Start the development server:"
echo "     npm run dev"
echo ""
echo -e "${GREEN}Done! Open http://localhost:3000 in your browser.${NC}"

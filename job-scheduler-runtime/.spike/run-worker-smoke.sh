#!/usr/bin/env bash
set -euo pipefail
DBURL="$(grep -oE '^DATABASE_URL=[^ ]+' /Users/johnlynas/dev/nipp-0807/.env | cut -d= -f2- | tr -d '"')"
export DATABASE_URL="$DBURL"
cd /Users/johnlynas/dev/nipp-0807/job-scheduler-runtime/.spike
node worker-smoke.cjs

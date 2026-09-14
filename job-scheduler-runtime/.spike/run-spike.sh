#!/usr/bin/env bash
set -euo pipefail
cd /Users/johnlynas/dev/nipp-0807/job-scheduler-runtime/.spike
DBURL="$(grep -oE '^DATABASE_URL=[^ ]+' /Users/johnlynas/dev/nipp-0807/.env | cut -d= -f2- | tr -d '"')"
export NODE_ENV=production DATABASE_URL="$DBURL"
node parent.cjs

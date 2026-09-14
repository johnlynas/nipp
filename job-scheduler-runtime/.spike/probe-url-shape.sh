#!/usr/bin/env bash
set -euo pipefail
line="$(grep -E '^DATABASE_URL=' /Users/johnlynas/dev/nipp-0807/.env | head -1)"
val="${line#DATABASE_URL=}"
echo "starts_quoted: $(case "$val" in \"*) echo yes ;; \'*) echo yes-single ;; *) echo no ;; esac)"
echo "ends_with_eq: $(case "$val" in *=) echo yes ;; *) echo no ;; esac)"
echo "first6: ${val:0:6}"
echo "last3: ${val: -3}"
echo "len: ${#val}"
has_user=0; case "$val" in *@*) has_user=1;; esac; echo "has_at_sign: $has_user"

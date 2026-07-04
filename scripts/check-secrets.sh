#!/usr/bin/env bash
# ============================================================
# Secret Detection Pre-Commit Hook
# ============================================================
# Scans staged files for potential secrets and blocks commits
# if any are detected. Bypass with: git commit --no-verify
# ============================================================

set -e

echo "🔍 Checking for accidentally committed secrets..."

# Patterns that indicate potential secrets
SECRET_PATTERNS=(
  "-----BEGIN (RSA )?PRIVATE KEY-----"
  "-----BEGIN PRIVATE KEY-----"
  "AKIA[0-9A-Z]{16}"
  "password\s*[:=]\s*['\"][^'\"]+['\"]"
  "secret\s*[:=]\s*['\"][^'\"]+['\"]"
  "api_key\s*[:=]\s*['\"][^'\"]+['\"]"
  "apikey\s*[:=]\s*['\"][^'\"]+['\"]"
  "DATABASE_URL\s*[:=]\s*postgresql://[^:]+:[^@]+@"
)

FOUND_ISSUES=0

for pattern in "${SECRET_PATTERNS[@]}"; do
  # Search staged files only
  if git diff --cached --name-only -z 2>/dev/null | xargs -0 grep -Plq "$pattern" 2>/dev/null; then
    echo ""
    echo "❌ POTENTIAL SECRET DETECTED!"
    echo "   Pattern: $pattern"
    echo ""
    echo "   Files matching:"
    git diff --cached --name-only 2>/dev/null | while read -r file; do
      if grep -Plq "$pattern" "$file" 2>/dev/null; then
        echo "   - $file"
      fi
    done
    echo ""
    echo "   If this is a false positive (e.g., example values in docs),"
    echo "   bypass with: git commit --no-verify"
    echo ""
    FOUND_ISSUES=1
  fi
done

if [ "$FOUND_ISSUES" -eq 1 ]; then
  echo "🚫 Commit blocked. Please remove secrets before committing."
  exit 1
fi

echo "✅ No secrets detected."
exit 0

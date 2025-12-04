#!/usr/bin/env bash
set -euo pipefail

# Apply Supabase schema SQL to a Postgres / Supabase DB.
# Usage:
#   SUPABASE_DB_URL="postgres://..." ./docs/scripts/apply_supabase_schema.sh
# Or, if you use supabase CLI and are logged in:
#   supabase db remote commit --file docs/sql/supabase_fleets_schema.sql

SQL_FILE="docs/sql/supabase_fleets_schema.sql"

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "ERROR: SUPABASE_DB_URL environment variable is not set."
  echo "Set SUPABASE_DB_URL to your Supabase Postgres connection string (pghost://...)"
  exit 2
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not found in PATH. Install libpq or psql client."
  exit 2
fi

echo "Applying schema ${SQL_FILE} to ${SUPABASE_DB_URL}"

psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_FILE"

echo "Schema applied. Please verify RLS policies and auth.uid() behavior in Supabase console."

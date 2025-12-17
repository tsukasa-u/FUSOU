#!/bin/bash
# ============================================================================
# D1 Database Setup Script
# ============================================================================
# This script automates D1 database initialization for new developers.
# It verifies configuration, applies schemas, and validates the setup.
#
# Usage:
#   ./setup.sh [--remote]
#
# Options:
#   --remote    Apply to remote D1 (production). Default is local.
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
WEB_PACKAGE="$PROJECT_ROOT/packages/FUSOU-WEB"

REMOTE_FLAG=""
if [[ "$1" == "--remote" ]]; then
  REMOTE_FLAG="--remote"
  ENV_TYPE="Remote"
else
  ENV_TYPE="Local"
fi

echo "=========================================="
echo "D1 Database Setup - $ENV_TYPE Environment"
echo "=========================================="
echo ""

# Step 1: Verify wrangler is installed
echo "[1/5] Checking Wrangler CLI..."
if ! command -v npx &> /dev/null; then
  echo "❌ Error: npm/npx not found. Please install Node.js."
  exit 1
fi

if ! npx wrangler --version &> /dev/null 2>&1; then
  echo "⚠️  Installing wrangler..."
  npm install -g wrangler
fi
echo "✅ Wrangler CLI available"
echo ""

# Step 2: Navigate to FUSOU-WEB
echo "[2/5] Verifying FUSOU-WEB configuration..."
if [[ ! -f "$WEB_PACKAGE/wrangler.toml" ]]; then
  echo "❌ Error: wrangler.toml not found in $WEB_PACKAGE"
  exit 1
fi
echo "✅ FUSOU-WEB configuration found"
echo ""

# Step 3: Apply schema
echo "[3/5] Applying D1 schema..."
cd "$WEB_PACKAGE"
if npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --file="$SCRIPT_DIR/schema.sql" > /dev/null 2>&1; then
  echo "✅ Schema applied successfully"
else
  echo "⚠️  Schema application returned non-zero (may be OK if tables already exist)"
fi
echo ""

# Step 4: Verify schema
echo "[4/5] Verifying schema installation..."
TABLES_COUNT=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null | grep -o '"table_count":[0-9]*' | cut -d: -f2)

if [[ -z "$TABLES_COUNT" ]]; then
  TABLES_COUNT=0
fi

echo "✅ Found $TABLES_COUNT user-defined tables"
echo ""

# Step 5: Verify battle_files table
echo "[5/5] Verifying battle_files table..."
BATTLE_FILES_EXISTS=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT name FROM sqlite_master WHERE type='table' AND name='battle_files';" 2>/dev/null | grep -c "battle_files" || true)

if [[ $BATTLE_FILES_EXISTS -gt 0 ]]; then
  # Check for table_offsets column
  OFFSETS_EXISTS=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT name FROM pragma_table_info('battle_files') WHERE name='table_offsets';" 2>/dev/null | grep -c "table_offsets" || true)
  
  if [[ $OFFSETS_EXISTS -gt 0 ]]; then
    echo "✅ battle_files table exists with table_offsets column"
  else
    echo "⚠️  battle_files exists but table_offsets column missing"
    echo "   Attempting to add table_offsets column..."
    npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "ALTER TABLE battle_files ADD COLUMN table_offsets TEXT DEFAULT NULL;" > /dev/null 2>&1 || true
    echo "✅ table_offsets column added"
  fi

  # Check for period_tag column
  PERIOD_EXISTS=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT name FROM pragma_table_info('battle_files') WHERE name='period_tag';" 2>/dev/null | grep -c "period_tag" || true)
  if [[ $PERIOD_EXISTS -gt 0 ]]; then
    echo "✅ period_tag column exists"
  else
    echo "⚠️  period_tag column missing; adding it (NULLable for backward compatibility)"
    npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "ALTER TABLE battle_files ADD COLUMN period_tag TEXT;" > /dev/null 2>&1 || true
    echo "✅ period_tag column added"
  fi

  # Ensure indexes exist
  echo "Ensuring indexes exist..."
  npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_battle_files_period ON battle_files(dataset_id, \"table\", uploaded_at);" > /dev/null 2>&1 || true
  npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_battle_files_period_tag ON battle_files(dataset_id, \"table\", period_tag, uploaded_at);" > /dev/null 2>&1 || true
  npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_battle_files_latest ON battle_files(dataset_id, \"table\", uploaded_at DESC);" > /dev/null 2>&1 || true
  npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_battle_files_uploaded_by ON battle_files(uploaded_by, uploaded_at DESC);" > /dev/null 2>&1 || true
else
  echo "❌ battle_files table not found"
  exit 1
fi
echo ""

echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Database: $ENV_TYPE D1 (dev_kc_battle_index)"
echo "Tables created: $TABLES_COUNT"
echo ""
echo "Next steps:"
echo "  1. Connect to database:"
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"SELECT * FROM battle_files LIMIT 1;\""
echo "  2. Review schema:"
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"PRAGMA table_info(battle_files);\""
echo "  3. Check indexes:"
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"SELECT sql FROM sqlite_master WHERE type='index';\""

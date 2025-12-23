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

# Step 3: Apply Avro-oriented schema and cleanup legacy Parquet artifacts
echo "[3/5] Applying Avro D1 schema..."
cd "$WEB_PACKAGE"
if npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --file="$PROJECT_ROOT/docs/sql/d1/avro-schema.sql" > /dev/null 2>&1; then
  echo "✅ Avro schema applied successfully"
else
  echo "⚠️  Avro schema application returned non-zero (may be OK if tables already exist)"
fi

echo "Applying cleanup for legacy Parquet-era tables/views (if any)..."
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --file="$PROJECT_ROOT/docs/sql/d1/cleanup-parquet.sql" > /dev/null 2>&1 || true
echo "✅ Cleanup executed"
echo ""

# Step 4: Verify schema
echo "[4/5] Verifying schema installation..."
TABLES_COUNT=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT COUNT(*) as table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';" 2>/dev/null | grep -o '"table_count":[0-9]*' | cut -d: -f2)

if [[ -z "$TABLES_COUNT" ]]; then
  TABLES_COUNT=0
fi

echo "✅ Found $TABLES_COUNT user-defined tables"
echo ""

# Step 5: Verify Avro tables and indexes
echo "[5/5] Verifying Avro tables (avro_files, avro_segments)..."
AVRO_FILES_EXISTS=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT name FROM sqlite_master WHERE type='table' AND name='avro_files';" 2>/dev/null | grep -c "avro_files" || true)
AVRO_SEGMENTS_EXISTS=$(npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "SELECT name FROM sqlite_master WHERE type='table' AND name='avro_segments';" 2>/dev/null | grep -c "avro_segments" || true)

if [[ $AVRO_FILES_EXISTS -eq 0 || $AVRO_SEGMENTS_EXISTS -eq 0 ]]; then
  echo "❌ Avro tables not found"
  exit 1
fi

echo "✅ avro_files and avro_segments exist"
echo "Ensuring Avro indexes exist..."
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_avro_files_dataset ON avro_files(dataset_id, table_name, period_tag);" > /dev/null 2>&1 || true
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_avro_files_period ON avro_files(period_tag DESC);" > /dev/null 2>&1 || true
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_avro_files_last_appended ON avro_files(last_appended_at DESC);" > /dev/null 2>&1 || true
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_avro_segments_parent ON avro_segments(parent_file_key, segment_number);" > /dev/null 2>&1 || true
npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command "CREATE INDEX IF NOT EXISTS idx_avro_segments_created ON avro_segments(created_at DESC);" > /dev/null 2>&1 || true
echo "✅ Avro indexes ensured"
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
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"SELECT * FROM avro_files LIMIT 1;\""
echo "  2. Review schema:"
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"PRAGMA table_info(avro_files);\""
echo "  3. Check indexes:"
echo "     npx wrangler d1 execute dev_kc_battle_index $REMOTE_FLAG --command \"SELECT sql FROM sqlite_master WHERE type='index';\""

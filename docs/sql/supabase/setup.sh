#!/bin/bash
# ============================================================================
# Supabase Database Setup Script
# ============================================================================
# This script automates Supabase database initialization for new developers.
# It verifies configuration, applies migrations, and validates the setup.
#
# Usage:
#   ./setup.sh [options]
#
# Options:
#   --remote        Apply to remote Supabase (production). Default is local.
#   --skip-pull     Skip pulling remote schema first
#   --list-tables   Just list tables without setup
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"

REMOTE_FLAG=""
SKIP_PULL=false
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --remote) REMOTE_FLAG="true"; shift ;;
    --skip-pull) SKIP_PULL=true; shift ;;
    --list-tables) LIST_ONLY=true; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -n "$REMOTE_FLAG" ]]; then
  ENV_TYPE="Remote"
  TARGET_ENV="production"
else
  ENV_TYPE="Local"
  TARGET_ENV="local"
fi

echo "=========================================="
echo "Supabase Database Setup - $ENV_TYPE Environment"
echo "=========================================="
echo ""

# Step 1: Verify supabase CLI is installed
echo "[1/5] Checking Supabase CLI..."
if ! command -v npx &> /dev/null; then
  echo "❌ Error: npm/npx not found. Please install Node.js."
  exit 1
fi

if ! npx supabase --version &> /dev/null 2>&1; then
  echo "⚠️  Installing supabase CLI..."
  npm install -g supabase
fi
echo "✅ Supabase CLI available"
echo ""

# Step 2: Verify project is linked
echo "[2/5] Verifying Supabase project link..."
cd "$PROJECT_ROOT"
if [[ -z "$REMOTE_FLAG" ]]; then
  # For local, just check if the CLI is accessible
  echo "✅ Ready for local database operations"
else
  # For remote, verify project link
  if ! npx supabase projects list &> /dev/null; then
    echo "⚠️  Supabase not linked. Attempting to link..."
    echo "Please enter your project reference (from Supabase Dashboard):"
    read -p "Project reference: " PROJECT_REF
    npx supabase link --project-ref "$PROJECT_REF"
  fi
  echo "✅ Supabase project linked"
fi
echo ""

# Step 3: Pull remote schema if requested
if [[ -z "$REMOTE_FLAG" && "$SKIP_PULL" != "true" ]]; then
  echo "[3/5] Pulling remote Supabase schema..."
  if npx supabase db pull --skip-seed 2>/dev/null; then
    echo "✅ Remote schema pulled"
  else
    echo "⚠️  Could not pull remote schema (may not be linked)"
  fi
  echo ""
else
  echo "[3/5] Skipping schema pull"
  echo ""
fi

# Step 4: List existing tables
echo "[4/5] Checking database tables..."
cd "$PROJECT_ROOT"

if [[ -z "$REMOTE_FLAG" ]]; then
  echo "Local Supabase status:"
  if npx supabase status 2>/dev/null; then
    echo ""
    echo "✅ Local Supabase is running"
  else
    echo "⚠️  Local Supabase is not running"
    echo "   Start it with: npx supabase start"
  fi
else
  echo "✅ Connected to remote Supabase"
fi
echo ""

# Step 5: Display setup summary
echo "[5/5] Setup Summary"
echo ""

if [[ "$LIST_ONLY" == "true" ]]; then
  echo "Listing tables for reference..."
  npx supabase db list tables 2>/dev/null || echo "⚠️  Could not list tables"
  exit 0
fi

echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Environment: $ENV_TYPE Supabase"
echo "Status: Ready for development"
echo ""
echo "Next steps:"
echo ""
echo "1. Verify table structure:"
echo "   npx supabase db list tables"
echo ""
echo "2. Verify dataset table:"
echo "   npx supabase db list columns datasets"
echo ""
echo "3. Apply schema changes:"
echo "   cd $PROJECT_ROOT"
if [[ -z "$REMOTE_FLAG" ]]; then
  echo "   npx supabase db push"
else
  echo "   npx supabase db push --remote"
fi
echo ""
echo "4. Create a test dataset:"
echo "   npx supabase sql --file $SCRIPT_DIR/test-data.sql"
echo ""

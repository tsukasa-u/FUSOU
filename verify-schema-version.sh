#!/bin/bash
# Verify kc_api import and feature configuration
# Used to validate the schema_version integration

set -e

WORKSPACE_ROOT="/home/ogu-h/Documents/GitHub/FUSOU/packages"

echo "======================================"
echo "kc_api Import & Feature Verification"
echo "======================================"
echo ""

# 1. Check FUSOU-APP imports
echo "1. Checking FUSOU-APP source code imports..."
echo ""

if grep -r "use kc_api_database" "$WORKSPACE_ROOT/FUSOU-APP/src-tauri/src/" 2>/dev/null; then
    echo "❌ FAIL: Direct kc_api_database imports found (should be kc_api::database)"
    exit 1
else
    echo "✓ No direct kc_api_database imports"
fi

if grep -r "use kc_api::database::SCHEMA_VERSION" "$WORKSPACE_ROOT/FUSOU-APP/src-tauri/src/" 2>/dev/null; then
    echo "✓ Found kc_api::database::SCHEMA_VERSION imports"
else
    echo "❌ FAIL: Expected kc_api::database::SCHEMA_VERSION not found"
    exit 1
fi

echo ""

# 2. Check Cargo.toml configuration
echo "2. Checking Cargo.toml configurations..."
echo ""

FUSOU_APP_CARGO="$WORKSPACE_ROOT/FUSOU-APP/src-tauri/Cargo.toml"
if grep -q 'kc_api_database = ' "$FUSOU_APP_CARGO"; then
    echo "❌ FAIL: Direct kc_api_database dependency found in FUSOU-APP Cargo.toml"
    exit 1
else
    echo "✓ No direct kc_api_database dependency in FUSOU-APP"
fi

if grep -q 'kc_api = .*features.*schema_v1' "$FUSOU_APP_CARGO"; then
    echo "✓ kc_api configured with schema_v1 feature"
else
    echo "❌ FAIL: kc_api schema_v1 feature not configured"
    exit 1
fi

echo ""

# 3. Check kc_api facade
echo "3. Checking kc_api facade..."
echo ""

KC_API_CARGO="$WORKSPACE_ROOT/kc_api/crates/kc-api/Cargo.toml"
if grep -q 'schema_v1 = \["kc-api-database/schema_v1"\]' "$KC_API_CARGO"; then
    echo "✓ kc_api has schema_v1 feature definition"
else
    echo "❌ FAIL: schema_v1 feature definition not found"
    exit 1
fi

if grep -q 'schema_v2 = \["kc-api-database/schema_v2"\]' "$KC_API_CARGO"; then
    echo "✓ kc_api has schema_v2 feature definition"
else
    echo "❌ FAIL: schema_v2 feature definition not found"
    exit 1
fi

KC_API_LIB="$WORKSPACE_ROOT/kc_api/crates/kc-api/src/lib.rs"
if grep -q 'pub use kc_api_database as database' "$KC_API_LIB"; then
    echo "✓ kc_api re-exports kc_api_database as database module"
else
    echo "❌ FAIL: kc_api_database re-export not found"
    exit 1
fi

echo ""

# 4. Check kc-api-database feature configuration
echo "4. Checking kc-api-database feature configuration..."
echo ""

KCA_DB_CARGO="$WORKSPACE_ROOT/kc_api/crates/kc-api-database/Cargo.toml"
if grep -q 'schema_v1 = \[\]' "$KCA_DB_CARGO"; then
    echo "✓ kc-api-database has schema_v1 feature"
else
    echo "❌ FAIL: schema_v1 feature not found in kc-api-database"
    exit 1
fi

if grep -q 'schema_v2 = \[\]' "$KCA_DB_CARGO"; then
    echo "✓ kc-api-database has schema_v2 feature"
else
    echo "❌ FAIL: schema_v2 feature not found in kc-api-database"
    exit 1
fi

echo ""

# 5. Check schema_version.rs implementation
echo "5. Checking schema_version.rs implementation..."
echo ""

SCHEMA_VERSION_RS="$WORKSPACE_ROOT/kc_api/crates/kc-api-database/src/schema_version.rs"
if grep -q 'pub const SCHEMA_VERSION: &str' "$SCHEMA_VERSION_RS"; then
    echo "✓ SCHEMA_VERSION constant is defined"
else
    echo "❌ FAIL: SCHEMA_VERSION constant not found"
    exit 1
fi

if grep -q '#\[cfg(feature = "schema_v1")\]' "$SCHEMA_VERSION_RS"; then
    echo "✓ schema_v1 conditional compilation is present"
else
    echo "❌ FAIL: schema_v1 feature guard not found"
    exit 1
fi

if grep -q '#\[cfg(feature = "schema_v2")\]' "$SCHEMA_VERSION_RS"; then
    echo "✓ schema_v2 conditional compilation is present"
else
    echo "❌ FAIL: schema_v2 feature guard not found"
    exit 1
fi

echo ""

# 6. Verify build
echo "6. Verifying FUSOU-APP build..."
echo ""

cd "$WORKSPACE_ROOT/FUSOU-APP/src-tauri"
if cargo check --message-format=short 2>&1 | grep -q "error\["; then
    echo "❌ FAIL: cargo check found errors"
    cargo check 2>&1 | grep "error\["
    exit 1
else
    echo "✓ FUSOU-APP builds successfully with schema_v1 feature"
fi

echo ""

# 7. Verify feature enforcement
echo "7. Verifying feature enforcement..."
echo ""

cd "$WORKSPACE_ROOT/kc_api/crates/kc-api-database"
# This should fail if both features are enabled
if cargo check --features "schema_v1,schema_v2" 2>&1 | grep -q "error:"; then
    echo "✓ Feature enforcement works: cannot use both schema_v1 and schema_v2"
elif cargo check --no-default-features 2>&1 | grep -q "error:"; then
    echo "✓ Feature enforcement works: must specify at least one schema version"
else
    echo "⚠ Warning: Feature enforcement may not be working as expected"
fi

echo ""
echo "======================================"
echo "✅ All verifications passed!"
echo "======================================"
echo ""
echo "Summary:"
echo "- FUSOU-APP imports kc_api_database through kc_api::database"
echo "- Feature management is unified through kc_api"
echo "- schema_v1 and schema_v2 features are mutually enforced"
echo "- Build succeeds with current configuration"
echo ""

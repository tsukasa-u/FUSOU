#!/bin/bash
set -e
# ============================================================================
# rebuild-schema-chain.sh
#
# Unified script that regenerates the entire schema validation chain.
# Run this after ANY schema change (models, table_version bump, new version).
#
# Steps:
#   1. Generate schema JSON from Rust models (all versions)
#   2. Build avro-wasm with all versions embedded
#   3. Compute fingerprints from generated schemas
#   4. Update configs/fingerprints.json
#
# Usage:
#   ./scripts/rebuild-schema-chain.sh          # full rebuild
#   ./scripts/rebuild-schema-chain.sh --skip-wasm  # skip WASM build (faster)
#
# After running, commit the updated files:
#   - packages/kc_api/generated-schemas/schema_v*.json
#   - packages/avro-wasm/pkg/*
#   - packages/configs/fingerprints.json
# ============================================================================

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_WASM=false

for arg in "$@"; do
    case $arg in
        --skip-wasm) SKIP_WASM=true ;;
    esac
done

echo "═══════════════════════════════════════════════════════════"
echo " FUSOU Schema Chain Rebuild"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Generate schema JSONs ──────────────────────────────
echo "── Step 1/4: Generating Avro schema JSONs ──"
cd "$REPO_ROOT/packages/kc_api"
bash scripts/generate-schemas.sh
echo ""

# Collect generated schema files
SCHEMA_FILES=()
for f in "$REPO_ROOT/packages/kc_api/generated-schemas"/schema_v*.json; do
    [ -f "$f" ] && SCHEMA_FILES+=("$f")
done

if [ ${#SCHEMA_FILES[@]} -eq 0 ]; then
    echo "❌ No schema files generated. Aborting."
    exit 1
fi

echo "  Found ${#SCHEMA_FILES[@]} schema version(s): ${SCHEMA_FILES[*]##*/}"
echo ""

# ── Step 2: Rebuild avro-wasm ──────────────────────────────────
if [ "$SKIP_WASM" = true ]; then
    echo "── Step 2/4: Skipping WASM build (--skip-wasm) ──"
else
    echo "── Step 2/4: Building avro-wasm (all versions) ──"
    cd "$REPO_ROOT/packages/avro-wasm"
    bash build-wasm.sh all
fi
echo ""

# ── Step 3: Compute fingerprints ───────────────────────────────
echo "── Step 3/4: Computing schema fingerprints ──"
cd "$REPO_ROOT/packages/FUSOU-WORKFLOW"

# Ensure dist/avro-manual.js exists (needed by compute script)
if [ ! -f "dist/avro-manual.js" ]; then
    echo "  Building FUSOU-WORKFLOW first (need dist/avro-manual.js)..."
    npm run build 2>/dev/null || npx tsc 2>/dev/null || true
fi

if [ ! -f "dist/avro-manual.js" ]; then
    echo "  ⚠️  dist/avro-manual.js not found. Trying direct approach..."
fi

# Build the file list as JSON for Node.js
SCHEMA_FILES_JSON="["
first=true
for f in "${SCHEMA_FILES[@]}"; do
    if [ "$first" = true ]; then
        first=false
    else
        SCHEMA_FILES_JSON+=","
    fi
    SCHEMA_FILES_JSON+="\"$f\""
done
SCHEMA_FILES_JSON+="]"

# Run the compute script with all schema files
FINGERPRINTS=$(node scripts/compute-kc-api-fingerprints.mjs "${SCHEMA_FILES[@]}" 2>/dev/null) || true

if [ -z "$FINGERPRINTS" ] || [ "$FINGERPRINTS" = "{}" ]; then
    echo "  ⚠️  Fingerprint computation returned empty. Using fallback..."
    
    # Fallback: compute fingerprints directly with Node.js (no namespace manipulation)
    FINGERPRINTS=$(node -e "
const fs = require('fs');
const crypto = require('crypto');

const results = {};
const files = $SCHEMA_FILES_JSON;

for (const file of files) {
    const content = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const tableVersion = content.table_version || 'unknown';
    const tables = {};
    
    for (const entry of (content.schemas || [])) {
        const hash = crypto.createHash('sha256').update(entry.schema).digest('hex');
        tables[entry.table_name] = [hash];
    }
    
    results[tableVersion] = { tables };
}

console.log(JSON.stringify(results, null, 2));
")
fi

if [ -z "$FINGERPRINTS" ] || [ "$FINGERPRINTS" = "{}" ]; then
    echo "❌ Failed to compute fingerprints. Aborting."
    exit 1
fi

echo "  ✅ Fingerprints computed"
echo ""

# ── Step 4: Update fingerprints.json ───────────────────────────
echo "── Step 4/4: Updating configs/fingerprints.json ──"
FINGERPRINTS_FILE="$REPO_ROOT/packages/configs/fingerprints.json"
echo "$FINGERPRINTS" > "$FINGERPRINTS_FILE"
echo "  ✅ Written to $FINGERPRINTS_FILE"

# Show summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo " Summary"
echo "───────────────────────────────────────────────────────────"
echo "$FINGERPRINTS" | node -e "
const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf-8'));
for (const [tableVersion, info] of Object.entries(data)) {
    const count = Object.keys(info.tables || {}).length;
    console.log('  table_version=' + tableVersion + ': ' + count + ' tables');
}
" 2>/dev/null || echo "  (summary unavailable)"
echo ""
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Commit updated files:"
echo "     git add packages/kc_api/generated-schemas/"
echo "     git add packages/avro-wasm/pkg/"
echo "     git add packages/configs/fingerprints.json"
echo "  2. Deploy FUSOU-WORKFLOW with updated WASM"
echo "     (fingerprints are auto-loaded from bundled fingerprints.json at build time)"
echo ""

#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KC_API_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$KC_API_ROOT/generated-schemas"

echo "Generating Avro schemas from kc-api-database..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

cd "$KC_API_ROOT/crates/kc-api-database"

# Auto-detect available schema versions from Cargo.toml features
# Feature names follow the pattern schema_v{MAJOR}_{MINOR} matching table_version {MAJOR}.{MINOR}
# When adding a new version, just add a new schema_vX_Y feature to Cargo.toml — no script changes needed
VERSIONS=()
while IFS= read -r line; do
    if [[ "$line" =~ ^schema_(v[0-9]+_[0-9]+)[[:space:]]*= ]]; then
        VERSIONS+=("${BASH_REMATCH[1]}")
    fi
done < Cargo.toml

if [ ${#VERSIONS[@]} -eq 0 ]; then
    echo "❌ No schema_vN features found in Cargo.toml"
    exit 1
fi

echo "Detected versions: ${VERSIONS[*]}"

for ver in "${VERSIONS[@]}"; do
    echo "Generating schema_${ver}..."
    # NOTE: 'full' feature is required because models module is gated behind #[cfg(feature = "full")]
    if cargo run --bin print_schema --no-default-features --features "schema_${ver},full" 2>/dev/null > "$OUTPUT_DIR/schema_${ver}.json"; then
        echo "  ✅ $OUTPUT_DIR/schema_${ver}.json"
    else
        echo "  ⚠️  schema_${ver} generation failed (feature may not exist yet), skipping"
        rm -f "$OUTPUT_DIR/schema_${ver}.json"
    fi

    echo "Generating master_schema_${ver}..."
    if cargo run --bin print_master_schema --no-default-features --features "schema_${ver},full" 2>/dev/null > "$OUTPUT_DIR/master_schema_${ver}.json"; then
        echo "  ✅ $OUTPUT_DIR/master_schema_${ver}.json"
    else
        echo "  ⚠️  master_schema_${ver} generation failed, skipping"
        rm -f "$OUTPUT_DIR/master_schema_${ver}.json"
    fi
done

echo ""
echo "✅ Schema generation complete."

# Validate JSON
if command -v jq &> /dev/null; then
    for ver in "${VERSIONS[@]}"; do
        if [ -f "$OUTPUT_DIR/schema_${ver}.json" ]; then
            tv=$(jq -r '.table_version' "$OUTPUT_DIR/schema_${ver}.json")
            sc=$(jq '.schemas | length' "$OUTPUT_DIR/schema_${ver}.json")
            echo "  ${ver}: table_version=${tv}, tables=${sc}"
        fi
        if [ -f "$OUTPUT_DIR/master_schema_${ver}.json" ]; then
            mtv=$(jq -r '.table_version' "$OUTPUT_DIR/master_schema_${ver}.json")
            msc=$(jq '.schemas | length' "$OUTPUT_DIR/master_schema_${ver}.json")
            echo "  ${ver}: master_table_version=${mtv}, master_tables=${msc}"
        fi
    done
fi

# Compute fingerprints from generated schemas
FINGERPRINT_SCRIPT="$KC_API_ROOT/../FUSOU-WORKFLOW/scripts/compute-kc-api-fingerprints.mjs"
FINGERPRINT_OUTPUT="$KC_API_ROOT/../configs/fingerprints.json"

if [ -f "$FINGERPRINT_SCRIPT" ]; then
    echo ""
    echo "Computing fingerprints..."
    SCHEMA_FILES=()
    for ver in "${VERSIONS[@]}"; do
        if [ -f "$OUTPUT_DIR/schema_${ver}.json" ]; then
            SCHEMA_FILES+=("$OUTPUT_DIR/schema_${ver}.json")
        fi
    done
    if [ ${#SCHEMA_FILES[@]} -gt 0 ]; then
        node "$FINGERPRINT_SCRIPT" "${SCHEMA_FILES[@]}" > "$FINGERPRINT_OUTPUT"
        echo "✅ Fingerprints written to $FINGERPRINT_OUTPUT"
    else
        echo "⚠️  No schema files found; skipping fingerprint generation"
    fi
else
    echo ""
    echo "⚠️  Fingerprint script not found at $FINGERPRINT_SCRIPT; skipping"
fi

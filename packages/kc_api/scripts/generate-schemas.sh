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

AVAILABLE_EPOCHS=()
while IFS= read -r line; do
    if [[ "$line" =~ ^genesis[[:space:]]*= ]]; then
        AVAILABLE_EPOCHS+=("genesis")
    elif [[ "$line" =~ ^epoch_([0-9]{8})[[:space:]]*= ]]; then
        AVAILABLE_EPOCHS+=("epoch_${BASH_REMATCH[1]}")
    fi
done < Cargo.toml

if [ ${#AVAILABLE_EPOCHS[@]} -eq 0 ]; then
    echo "❌ No epoch feature found in Cargo.toml"
    exit 1
fi

REQUESTED_EPOCH="${KC_API_EPOCH_FEATURE:-${KC_API_EPOCH:-}}"
if [ -n "$REQUESTED_EPOCH" ]; then
    if [[ "$REQUESTED_EPOCH" =~ ^[0-9]{8}$ ]]; then
        REQUESTED_EPOCH="epoch_${REQUESTED_EPOCH}"
    fi
    if [[ ! "$REQUESTED_EPOCH" =~ ^(genesis|epoch_[0-9]{8})$ ]]; then
        echo "❌ Invalid KC_API_EPOCH value: $REQUESTED_EPOCH"
        exit 1
    fi

    EPOCH_FEATURE="$REQUESTED_EPOCH"
    FOUND=false
    for feature in "${AVAILABLE_EPOCHS[@]}"; do
        if [ "$feature" = "$EPOCH_FEATURE" ]; then
            FOUND=true
            break
        fi
    done
    if [ "$FOUND" = false ]; then
        echo "❌ Unknown epoch feature: $EPOCH_FEATURE"
        echo "   Available: ${AVAILABLE_EPOCHS[*]}"
        exit 1
    fi
else
    DEFAULT_EPOCHS=()
    while IFS= read -r line; do
        if [[ "$line" =~ ^default[[:space:]]*= ]]; then
            if [[ "$line" =~ genesis ]]; then
                DEFAULT_EPOCHS+=("genesis")
            fi
            while [[ "$line" =~ epoch_([0-9]{8}) ]]; do
                DEFAULT_EPOCHS+=("epoch_${BASH_REMATCH[1]}")
                line="${line#*epoch_${BASH_REMATCH[1]}}"
            done
            break
        fi
    done < Cargo.toml

    if [ ${#DEFAULT_EPOCHS[@]} -gt 1 ]; then
        echo "❌ Multiple epoch features found in default feature list: ${DEFAULT_EPOCHS[*]}"
        exit 1
    fi

    if [ ${#DEFAULT_EPOCHS[@]} -eq 1 ]; then
        EPOCH_FEATURE="${DEFAULT_EPOCHS[0]}"
    else
        EPOCH_FEATURE=""
        LATEST_DATE=0
        for feature in "${AVAILABLE_EPOCHS[@]}"; do
            if [[ "$feature" =~ ^epoch_([0-9]{8})$ ]]; then
                date="${BASH_REMATCH[1]}"
                if [ "$date" -gt "$LATEST_DATE" ]; then
                    LATEST_DATE="$date"
                    EPOCH_FEATURE="$feature"
                fi
            fi
        done

        if [ -z "$EPOCH_FEATURE" ]; then
            EPOCH_FEATURE="genesis"
        fi
    fi
fi

echo "Using kc-api epoch feature: ${EPOCH_FEATURE}"

for ver in "${VERSIONS[@]}"; do
    echo "Generating schema_${ver}..."
    # NOTE: 'full' feature is required because models module is gated behind #[cfg(feature = "full")]
    if cargo run --bin print_schema --no-default-features --features "schema_${ver},full,${EPOCH_FEATURE}" 2>/dev/null > "$OUTPUT_DIR/schema_${ver}.json"; then
        echo "  ✅ $OUTPUT_DIR/schema_${ver}.json"
    else
        echo "  ⚠️  schema_${ver} generation failed (feature may not exist yet), skipping"
        rm -f "$OUTPUT_DIR/schema_${ver}.json"
    fi

    echo "Generating master_schema_${ver}..."
    if cargo run --bin print_master_schema --no-default-features --features "schema_${ver},full,${EPOCH_FEATURE}" 2>/dev/null > "$OUTPUT_DIR/master_schema_${ver}.json"; then
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

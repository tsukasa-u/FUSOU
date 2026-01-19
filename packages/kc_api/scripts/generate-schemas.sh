#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KC_API_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$KC_API_ROOT/generated-schemas"

echo "Generating Avro schemas from kc-api-database..."

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Generate schema with v1 feature
echo "Generating schema_v1..."
cd "$KC_API_ROOT/crates/kc-api-database"
cargo run --bin print_schema --no-default-features --features schema_v1 2>/dev/null > "$OUTPUT_DIR/schema_v1.json"

# Generate schema with v2 feature  
# echo "Generating schema_v2..."
# cargo run --bin print_schema --no-default-features --features schema_v2 2>/dev/null > "$OUTPUT_DIR/schema_v2.json"

echo "✅ Schemas generated successfully:"
echo "  - $OUTPUT_DIR/schema_v1.json"
# echo "  - $OUTPUT_DIR/schema_v2.json"

# Validate JSON
if command -v jq &> /dev/null; then
    echo ""
    echo "Schema v1 metadata:"
    jq '.table_version, (.schemas | length)' "$OUTPUT_DIR/schema_v1.json"
    # echo ""
    # echo "Schema v2 metadata:"
    # jq '.table_version, (.schemas | length)' "$OUTPUT_DIR/schema_v2.json"
fi

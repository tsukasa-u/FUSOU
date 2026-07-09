#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPORT_DIR="$ROOT_DIR/output/bench/report"
REFERENCE_JSON="$REPORT_DIR/ref_node24_w8_s256.json"
PROXY_DATA_DIR="$SCRIPT_DIR/../../FUSOU-PROXY-DATA"

cd "$ROOT_DIR"

bash "$SCRIPT_DIR/generate-synergy-latest.sh" \
  --ship-range 600-650 \
  --threads 8 \
  --schedule-shards 256 \
  --strict-nminus1 \
  --allow-duplicate-items \
  --max-combo-size 6

LATEST_TAG=$(find "$PROXY_DATA_DIR" -maxdepth 1 -type d -name '20*' -exec basename {} \; | sort -r | head -n 1)
OUTPUT_JSON="$ROOT_DIR/output/slot_item_effects_${LATEST_TAG}.json"

if [[ ! -f "$REFERENCE_JSON" ]]; then
  echo "Reference file not found: $REFERENCE_JSON"
  exit 1
fi

if [[ ! -f "$OUTPUT_JSON" ]]; then
  echo "Generated file not found: $OUTPUT_JSON"
  exit 1
fi

node "$SCRIPT_DIR/utils/compare-outputs.js" "$REFERENCE_JSON" "$OUTPUT_JSON"

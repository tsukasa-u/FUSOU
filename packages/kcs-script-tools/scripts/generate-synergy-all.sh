#!/bin/bash
set -e

# Path to proxy data directory
PROXY_DATA_DIR="$(dirname "$0")/../../FUSOU-PROXY-DATA"
SCRIPT_DIR="$(dirname "$0")"

if [ ! -d "$PROXY_DATA_DIR" ]; then
  echo "Error: $PROXY_DATA_DIR not found!"
  exit 1
fi

echo "=== FUSOU Synergy Generator ==="
echo "Scanning for period tags in $PROXY_DATA_DIR..."

# Get all directories that match YYYY-MM-DD
tags=$(find "$PROXY_DATA_DIR" -maxdepth 1 -type d -name "20*" -exec basename {} \;)

if [ -z "$tags" ]; then
  echo "No period tags found."
  exit 0
fi

# Sort descending
tags=$(echo "$tags" | sort -r)

for tag in $tags; do
  echo "----------------------------------------"
  echo "Processing period_tag: $tag"
  echo "----------------------------------------"

  # 0. Preflight check (verify main.js and S@api_start2@getData in FUSOU-PROXY-DATA)
  echo "[0/3] Checking required FUSOU-PROXY-DATA files..."
  node -e '
const path = require("path");
const { ROOT, validatePeriodInputs } = require(path.resolve(process.argv[1], "..", "lib", "loader"));
const res = validatePeriodInputs(process.argv[2]);
console.log("[preflight] main.js:     " + path.relative(ROOT, res.mainJsPath));
console.log("[preflight] master data: " + path.relative(ROOT, res.masterPath));
' "$SCRIPT_DIR" "$tag"

  # 1. Deobfuscate
  echo "[1/3] Deobfuscating..."
  node "$SCRIPT_DIR/core/deobfuscate.js" --period-tag "$tag"

  # 2. Extract AST
  echo "[2/3] Extracting AST..."
  node "$SCRIPT_DIR/core/extract-ast.js" --period-tag "$tag"

  # 3. Scan Synergy
  echo "[3/3] Scanning Synergy..."
  node "$SCRIPT_DIR/core/scan-ast.js" --period-tag "$tag"

  echo "Finished $tag successfully!"
done

echo "All period tags processed."

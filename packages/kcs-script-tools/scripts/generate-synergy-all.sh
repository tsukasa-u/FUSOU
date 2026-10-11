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

  # 1. Deobfuscate
  echo "[1/3] Deobfuscating..."
  node "$SCRIPT_DIR/deobfuscate.js" --period-tag "$tag"

  # 2. Extract AST
  echo "[2/3] Extracting AST..."
  node "$SCRIPT_DIR/extract-ast.js" --period-tag "$tag"

  # 3. Scan Synergy
  echo "[3/3] Scanning Synergy..."
  node "$SCRIPT_DIR/scan-ast.js" --period-tag "$tag"

  echo "Finished $tag successfully!"
done

echo "All period tags processed."

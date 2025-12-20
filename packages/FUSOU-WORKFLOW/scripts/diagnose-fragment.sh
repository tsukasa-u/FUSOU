#!/bin/bash
# ローカル診断用：抽出済みフラグメントをR2からダウンロードして検証

set -e

if [ $# -lt 2 ]; then
  echo "Usage: $0 <BUCKET_NAME> <FRAGMENT_KEY>"
  echo ""
  echo "Example:"
  echo "  $0 dev-kc-battle-data 'temp_extracted_table_73b5d4e4...#api_port'"
  exit 1
fi

BUCKET=$1
FRAGMENT_KEY=$2
TEMP_FILE="/tmp/test_fragment_$(date +%s).parquet"

echo "[Diagnostic] Downloading fragment from R2..."
wrangler r2 object get "$BUCKET" --key "$FRAGMENT_KEY" --output "$TEMP_FILE" || {
  echo "Error: Failed to download from R2"
  exit 1
}

echo "[Diagnostic] File downloaded: $TEMP_FILE"
echo ""

# Run local diagnostic
npx tsx test-merge-diagnostics.ts "$TEMP_FILE"

echo ""
echo "[Diagnostic] Temp file: $TEMP_FILE (keep for further inspection if needed)"

#!/bin/bash
# Parquet最適化機能の統合テストスクリプト

set -e

WORKFLOW_URL="${WORKFLOW_URL:-http://127.0.0.1:8787}"
DATASET_ID="${DATASET_ID:-test-dataset-123}"
TABLE="${TABLE:-battle}"
PERIOD_TAG="${PERIOD_TAG:-2024Q4}"

echo "=== FUSOU-WORKFLOW Parquet Optimization Test ==="
echo "WORKFLOW_URL: $WORKFLOW_URL"
echo "DATASET_ID: $DATASET_ID"
echo ""

# 1. ヘルスチェック
echo "1. Health check..."
curl -sS "$WORKFLOW_URL/" | jq
echo ""

# 2. 単一ファイル検証（存在しない場合はスキップ）
echo "2. Single file validation (may fail if file doesn't exist)..."
TEST_KEY="battle_compacted/$PERIOD_TAG/$DATASET_ID/$TABLE/0.parquet"
curl -sS "$WORKFLOW_URL/validate/$(echo $TEST_KEY | sed 's|/|%2F|g')" | jq || echo "File not found (OK for initial test)"
echo ""

# 3. バッチ検証
echo "3. Batch validation..."
cat > /tmp/validate-request.json <<EOF
{
  "keys": [
    "battle_compacted/$PERIOD_TAG/$DATASET_ID/$TABLE/0.parquet",
    "battle_compacted/$PERIOD_TAG/$DATASET_ID/$TABLE/1.parquet"
  ]
}
EOF

curl -sS -X POST "$WORKFLOW_URL/validate" \
  -H 'content-type: application/json' \
  -d @/tmp/validate-request.json | jq
echo ""

# 4. コンパクション実行（実際のデータが必要）
echo "4. Trigger compaction workflow..."
cat > /tmp/run-request.json <<EOF
{
  "datasetId": "$DATASET_ID",
  "table": "$TABLE",
  "periodTag": "$PERIOD_TAG"
}
EOF

curl -sS -X POST "$WORKFLOW_URL/run" \
  -H 'content-type: application/json' \
  -d @/tmp/run-request.json | jq
echo ""

# 5. ステータス確認（instance IDが必要な場合）
# echo "5. Check workflow status..."
# INSTANCE_ID="<from-step-4>"
# curl -sS "$WORKFLOW_URL/status/$INSTANCE_ID" | jq
# echo ""

echo "=== Test completed ==="
echo ""
echo "Next steps:"
echo "1. Check Supabase processing_metrics for workflow results"
echo "2. Validate output files with PyArrow/DuckDB"
echo "3. Monitor Cloudflare Workers logs for detailed execution trace"

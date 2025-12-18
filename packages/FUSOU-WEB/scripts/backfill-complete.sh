#!/bin/bash
# ============================================================================
# Complete R2→D1 Asset Index Backfill Script
# ============================================================================
#
# Purpose:
#   Populates content_hash column in D1 ASSET_INDEX for all existing R2 objects.
#   Uses cursor-based pagination to handle large buckets without timeouts.
#
# Usage:
#   ./scripts/backfill-complete.sh [dry_run]
#
# Arguments:
#   dry_run - (optional) Set to "true" to compute hashes without updating D1
#             Default: false (production mode)
#
# Examples:
#   ./scripts/backfill-complete.sh          # Run full backfill
#   ./scripts/backfill-complete.sh true     # Dry-run mode (test only)
#
# How it works:
#   1. Calls /api/backfill-asset-index with limit=50 per batch
#   2. Follows cursor pagination until all objects processed
#   3. Sleeps 2s between batches to respect rate limits
#   4. Tracks cumulative updated/skipped counts
#
# Output:
#   Progress updates for each batch showing:
#   - Updated: New or changed hashes inserted into D1
#   - Skipped: Objects with matching hash already in D1
#   - Running totals across all batches
#
# Requirements:
#   - curl (HTTP requests)
#   - jq (JSON parsing)
#   - Deployed endpoint at r2-parquet.fusou.pages.dev
#
# ============================================================================

BASE_URL="https://r2-parquet.fusou.pages.dev/api/backfill-asset-index"
DRY_RUN="${1:-false}"
LIMIT=50
CURSOR=""
BATCH=1
TOTAL_UPDATED=0
TOTAL_SKIPPED=0

echo "Starting complete backfill (dry_run=$DRY_RUN, limit=$LIMIT per batch)"
echo "=================================================="

while true; do
  echo ""
  echo "=== Batch $BATCH ==="
  
  # Build URL with cursor if available
  URL="$BASE_URL?limit=$LIMIT&dry_run=$DRY_RUN"
  if [ -n "$CURSOR" ]; then
    URL="$URL&cursor=$CURSOR"
  fi
  
  # Execute request
  RESPONSE=$(curl -s "$URL")
  
  # Parse response
  UPDATED=$(echo "$RESPONSE" | jq -r '.updated // 0')
  SKIPPED=$(echo "$RESPONSE" | jq -r '.skipped // 0')
  HAS_MORE=$(echo "$RESPONSE" | jq -r '.hasMore // false')
  NEXT_CURSOR=$(echo "$RESPONSE" | jq -r '.cursor // ""')
  ERROR=$(echo "$RESPONSE" | jq -r '.error // ""')
  
  if [ -n "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "Error: $ERROR"
    break
  fi
  
  TOTAL_UPDATED=$((TOTAL_UPDATED + UPDATED))
  TOTAL_SKIPPED=$((TOTAL_SKIPPED + SKIPPED))
  
  echo "Updated: $UPDATED, Skipped: $SKIPPED"
  echo "Running totals: Updated=$TOTAL_UPDATED, Skipped=$TOTAL_SKIPPED"
  
  # Check if we should continue
  if [ "$HAS_MORE" != "true" ] || [ -z "$NEXT_CURSOR" ] || [ "$NEXT_CURSOR" = "null" ]; then
    echo ""
    echo "No more pages to process"
    break
  fi
  
  if [ "$UPDATED" -eq 0 ] && [ "$SKIPPED" -ge $LIMIT ]; then
    echo ""
    echo "All items in this batch already processed"
  fi
  
  CURSOR="$NEXT_CURSOR"
  BATCH=$((BATCH + 1))
  
  # Rate limiting
  sleep 2
done

echo ""
echo "=================================================="
echo "Backfill complete!"
echo "Total batches: $BATCH"
echo "Total updated: $TOTAL_UPDATED"
echo "Total skipped: $TOTAL_SKIPPED"

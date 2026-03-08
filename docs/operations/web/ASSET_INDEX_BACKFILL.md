# Asset Index Backfill System

## Overview

This system populates the `content_hash` column in D1 `ASSET_INDEX` database from existing R2 objects. The content hash enables deduplication in the asset sync system by allowing the proxy to skip uploads when file content hasn't changed.

## Architecture

```
┌─────────────┐
│ R2 Bucket   │  List objects with cursor pagination
│ (Assets)    │  Download each object
└──────┬──────┘
       │
       ▼
┌─────────────────────────────┐
│ /api/backfill-asset-index   │  Compute SHA-256 hash
│ (Astro Endpoint)            │  Check if hash exists in D1
└──────┬──────────────────────┘
       │
       ▼
┌─────────────┐
│ D1 Database │  INSERT/UPDATE content_hash
│ (files)     │  ON CONFLICT(key)
└─────────────┘
```

## Components

### 1. API Endpoint
**File**: `src/pages/api/backfill-asset-index.astro`

Processes a batch of R2 objects:
- Lists R2 objects with cursor pagination
- Downloads each object and computes SHA-256
- Updates D1 with computed hash (skips if already matches)
- Returns cursor for next batch

**Query Parameters**:
- `limit`: Objects per batch (default: 100, recommended: 50)
- `cursor`: R2 pagination cursor (optional)
- `dry_run`: Compute hashes without D1 updates (default: false)

**Response**:
```json
{
  "success": true,
  "total": 50,
  "updated": 48,
  "skipped": 2,
  "cursor": "next_cursor_here",
  "hasMore": true,
  "errors": [],
  "dry_run": false
}
```

### 2. Complete Backfill Script
**File**: `scripts/backfill-complete.sh`

Bash script that automates full backfill:
- Loops through all pages using cursor
- Handles rate limiting (2s sleep between batches)
- Tracks cumulative statistics
- Stops when no more pages

**Usage**:
```bash
# Production run
./scripts/backfill-complete.sh

# Dry-run (test mode)
./scripts/backfill-complete.sh true
```

## Usage Guide

### Full Backfill (Recommended)

```bash
cd packages/FUSOU-WEB
./scripts/backfill-complete.sh
```

Expected output:
```
Starting complete backfill (dry_run=false, limit=50 per batch)
==================================================

=== Batch 1 ===
Updated: 50, Skipped: 0
Running totals: Updated=50, Skipped=0

=== Batch 2 ===
Updated: 48, Skipped: 2
Running totals: Updated=98, Skipped=2

...

==================================================
Backfill complete!
Total batches: 45
Total updated: 2172
Total skipped: 66
```

### Manual Single Batch

```bash
# First batch
curl "https://r2-parquet.fusou.pages.dev/api/backfill-asset-index?limit=50" | jq

# With cursor (from previous response)
curl "https://r2-parquet.fusou.pages.dev/api/backfill-asset-index?limit=50&cursor=CURSOR_HERE" | jq
```

### Dry-Run Test

```bash
# Test without modifying D1
curl "https://r2-parquet.fusou.pages.dev/api/backfill-asset-index?limit=10&dry_run=true" | jq
```

## Verification

Check backfill coverage:

```bash
npx wrangler d1 execute dev_kc_asset_index --remote --command \
  "SELECT 
     COUNT(*) as total, 
     COUNT(content_hash) as with_hash, 
     ROUND(100.0 * COUNT(content_hash) / COUNT(*), 2) as coverage_percent 
   FROM files;"
```

Expected result after full backfill:
```
┌───────┬───────────┬──────────────────┐
│ total │ with_hash │ coverage_percent │
├───────┼───────────┼──────────────────┤
│ 2238  │ 2172      │ 97.05            │
└───────┴───────────┴──────────────────┘
```

View recent backfilled files:

```bash
npx wrangler d1 execute dev_kc_asset_index --remote --command \
  "SELECT key, content_hash, uploader_id 
   FROM files 
   WHERE uploader_id = 'backfill' 
   ORDER BY uploaded_at DESC 
   LIMIT 5;"
```

## Performance Characteristics

- **Processing Speed**: ~50 files/batch, 2s between batches = ~1500 files/minute
- **Rate Limiting**: Cloudflare Workers CPU time (~50ms/file)
- **Total Time**: ~2000 files = ~3-5 minutes
- **Idempotent**: Safe to run multiple times (skips existing hashes)

## Integration with Asset Sync

After backfill completes:

1. **Rust Proxy** fetches `/asset-sync/keys` endpoint
2. Receives `contentHash` for each file
3. Computes local SHA-256 hash
4. **Compares** local vs remote hash
5. **Skips upload** if hashes match (content unchanged)
6. **Uploads** if hash differs or missing

This prevents redundant uploads and reduces:
- Network bandwidth
- R2 write operations
- D1 insert operations

## Troubleshooting

### Rate Limit Errors

If you see "Too many API requests":
- Reduce `limit` parameter (e.g., `limit=25`)
- Increase sleep time in script (e.g., `sleep 5`)

### Missing Hashes (coverage < 100%)

Some files may not have hashes due to:
- Upload during backfill execution
- R2 list truncation
- Rate limit skips

**Solution**: Run backfill again (idempotent, will only process missing)

### Endpoint Returns 404

Ensure:
1. Code is built: `pnpm run build`
2. Deployed: `npx wrangler pages deploy`
3. Endpoint exists: `dist/_worker.js` includes route

## Future Improvements

Potential enhancements:
- [ ] Parallel batch processing (multiple cursors)
- [ ] Resume from last cursor (persistent state)
- [ ] Webhook notification on completion
- [ ] Incremental backfill (only new files since timestamp)
- [ ] Hash verification (re-download and verify existing hashes)

## Related Files

- API Endpoint: `src/pages/api/backfill-asset-index.astro`
- Backfill Script: `scripts/backfill-complete.sh`
- Asset Sync Proxy: `../FUSOU-PROXY/proxy-https/src/asset_sync.rs`
- D1 Schema: `docs/sql/d1/asset-index.sql`

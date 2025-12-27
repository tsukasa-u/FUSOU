# Avro Schema Migration Guide

## Overview

This document describes the migration from the Parquet-era `battle_files` table to the new Avro-optimized schema (`avro_files`, `avro_segments`, and `avro_append_history`).

## Background

### Design Philosophy Change

**Parquet Pattern (Old):**
- Immutable fragments: 1 upload = 1 new file = 1 table record
- Files never change after creation
- History = complete list of all fragment records
- Query time = merge multiple fragments

**Avro Pattern (New):**
- Mutable files via append: 1 upload = append to existing file
- Files grow continuously
- Segmentation only when exceeding 512MB
- Query time = read latest consolidated file (+ segments if any)

### Schema Comparison

| Aspect | Parquet (battle_files) | Avro (avro_files + avro_segments) |
|--------|------------------------|-----------------------------------|
| Record Model | 1 record per upload | 1 record per file (updated on append) |
| File Growth | New fragment each time | Single file grows via UPDATE |
| Segmentation | N/A (always fragments) | Automatic at 512MB threshold |
| History Tracking | Implicit (all records) | Optional (avro_append_history) |
| Storage Efficiency | Low (redundant old states) | High (only current state) |

## Migration Steps

### Step 1: Archive Old Table

```bash
cd packages/FUSOU-WEB
npx wrangler d1 execute dev_kc_battle_index --local --command="ALTER TABLE battle_files RENAME TO battle_files_parquet_archive"
```

For remote (production):
```bash
npx wrangler d1 execute dev_kc_battle_index --remote --command="ALTER TABLE battle_files RENAME TO battle_files_parquet_archive"
```

### Step 2: Apply New Schema

```bash
# Local environment
npx wrangler d1 execute dev_kc_battle_index --local --file=../../docs/sql/d1/avro-schema.sql

# Remote environment (production)
npx wrangler d1 execute dev_kc_battle_index --remote --file=../../docs/sql/d1/avro-schema.sql
```

### Step 3: Verify Schema

```bash
# List tables
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT name FROM sqlite_master WHERE type='table'"

# Expected output:
# - battle_files_parquet_archive
# - avro_files
# - avro_segments
# - avro_append_history
```

### Step 4: Optional - Backfill Existing Avro Data

If you have existing Avro data in the old `battle_files_parquet_archive` table that you want to migrate to the new schema:

```sql
-- Extract latest state per file_key from archived data
INSERT INTO avro_files (
    file_key, 
    dataset_id, 
    table_name, 
    period_tag,
    current_size, 
    is_segmented,
    segment_count,
    created_at, 
    last_appended_at,
    last_etag,
    content_hash,
    uploaded_by
)
SELECT 
    key AS file_key,
    dataset_id,
    "table" AS table_name,
    period_tag,
    MAX(size) AS current_size,
    FALSE AS is_segmented,
    0 AS segment_count,
    MIN(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS created_at,
    MAX(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS last_appended_at,
    (SELECT etag FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS last_etag,
    (SELECT content_hash FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS content_hash,
    (SELECT uploaded_by FROM battle_files_parquet_archive bf2 
     WHERE bf2.key = bf.key 
     ORDER BY uploaded_at DESC LIMIT 1) AS uploaded_by
FROM battle_files_parquet_archive bf
WHERE dataset_id IS NOT NULL  -- Filter for Avro-era data only
GROUP BY key;
```

Run via:
```bash
npx wrangler d1 execute dev_kc_battle_index --local --file=backfill-avro-data.sql
```

### Step 5: Update Application Code

The workflow consumer (`packages/FUSOU-WORKFLOW/src/index.ts`) has been updated to use the new schema. Key changes:

1. **Canonical file logic**: Uses `INSERT` for new files, `UPDATE` for appends
2. **Segment creation**: When file would exceed 512MB, creates segment record in `avro_segments`
3. **Parent file tracking**: Updates `is_segmented` and `segment_count` in `avro_files`

### Step 6: Deploy Updated Code

```bash
cd packages/FUSOU-WORKFLOW
npm run build
npx wrangler deploy
```

### Step 7: Verify Deployment

1. Upload test data via FUSOU-WEB battle_data endpoint
2. Check wrangler tail logs:
```bash
npx wrangler tail
```

3. Query D1 to verify records:
```bash
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT * FROM avro_files LIMIT 5"
npx wrangler d1 execute dev_kc_battle_index --local --command="SELECT * FROM avro_segments LIMIT 5"
```

## Rollback Plan

If migration fails, you can restore the old table:

```bash
# Drop new tables
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_files"
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_segments"
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE IF EXISTS avro_append_history"

# Restore old table
npx wrangler d1 execute dev_kc_battle_index --local --command="ALTER TABLE battle_files_parquet_archive RENAME TO battle_files"
```

## Monitoring

After migration, monitor:

1. **File growth patterns**: Check `avro_files.current_size` over time
2. **Segmentation frequency**: Count records in `avro_segments`
3. **Append operations**: If using `avro_append_history`, track append frequency
4. **Storage efficiency**: Compare total bytes in D1 vs R2

### Useful Queries

```sql
-- Files approaching 512MB limit
SELECT file_key, current_size, period_tag
FROM avro_files
WHERE current_size > 450 * 1024 * 1024  -- 450 MB
ORDER BY current_size DESC;

-- Segmented files summary
SELECT 
    dataset_id,
    table_name,
    COUNT(*) as segmented_files,
    SUM(segment_count) as total_segments
FROM avro_files
WHERE is_segmented = TRUE
GROUP BY dataset_id, table_name;

-- Recent append activity (requires avro_append_history)
SELECT 
    file_key,
    action,
    appended_bytes,
    appended_at
FROM avro_append_history
WHERE appended_at > (strftime('%s', 'now') - 86400) * 1000  -- Last 24 hours
ORDER BY appended_at DESC
LIMIT 20;
```

## Cleanup (Optional)

After verifying the migration is successful and stable for a reasonable period (e.g., 1-2 weeks), you can drop the archived Parquet table:

```bash
# WARNING: This is irreversible!
npx wrangler d1 execute dev_kc_battle_index --local --command="DROP TABLE battle_files_parquet_archive"

# For production (use with extreme caution):
npx wrangler d1 execute dev_kc_battle_index --remote --command="DROP TABLE battle_files_parquet_archive"
```

## References

- Schema definition: [docs/sql/d1/avro-schema.sql](../sql/d1/avro-schema.sql)
- Type definitions: [packages/FUSOU-WORKFLOW/src/avro-schema-types.ts](../../packages/FUSOU-WORKFLOW/src/avro-schema-types.ts)
- Workflow consumer: [packages/FUSOU-WORKFLOW/src/index.ts](../../packages/FUSOU-WORKFLOW/src/index.ts)

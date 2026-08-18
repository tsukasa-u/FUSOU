# Data Archival & Compaction System

This document describes the data ingestion and archival system for FUSOU, which moves data from ingestion buffers to long-term storage (R2).

## Overview

The system implements a **Hybrid Architecture** using TiDB/D1 for buffering and R2 for storage.
It replaces the legacy Supabase/Parquet-based compaction with an **Avro OCF** merging strategy.

### Components

1.  **FUSOU-WORKFLOW (Ingest & Archival)**
    - **Ingest**: Receives Avro slices via `POST /battle-data/upload`, buffers via Queue to DB.
    - **Buffer**: Writes strictly typed Avro blobs to `buffer_logs` tables in TiDB (primary) or D1 (fallback).
    - **Archival (Cron)**: Periodically merges buffered data into R2 and updates metadata.

2.  **Databases**
    - **TiDB Serverless**: High-throughput buffer for ingestion (`buffer_logs`).
    - **Cloudflare D1**: Metadata storage (`archived_files`, `block_indexes`) and fallback buffer.
    - **Cloudflare R2**: Object storage for merged Avro OCF files.

---

## Archival Process (Cron)

The `handleCron` function (`src/cron.ts`) performs the following steps:

1.  **Fetch & Fallback**
    - Reads `buffer_logs` from TiDB.
    - If TiDB fails, falls back to reading from D1.
    - Gracefully handles failures to prevent data loss.

2.  **Grouping**
    - Groups data by `table_name`, `period_tag`, and `table_version`.
    - Further groups by `dataset_id` to handle multi-part uploads.

3.  **Avro OCF Merging**
    - **Logic**: `mergeAvroOCF` / `mergeAvroOCFWithBoundaries` (`src/avro-merger.ts`).
    - **Strategy**: Concatenates multiple Avro OCF files into a single valid OCF file.
      - Preserves the header (Magic, Metadata, Sync Marker) from the first file.
      - Concatenates data blocks.
      - Calculates exact byte boundaries for each dataset within the merged file.
    - **Limit**: Merges up to 128MB per file (`MAX_FILE_SIZE`).

4.  **Storage (R2)**
    - Uploads the merged file to `BATTLE_DATA_BUCKET`.
    - Path: `{tableVersion}/{periodTag}/{runTimestamp}/{tableName}-{indexStr}.avro`
    - Metadata: Stores run info, block counts, and table version.

5.  **Indexing (D1)**
  - **`archived_files`**: Registers the new R2 file only after an R2 `HEAD` confirms its existence and size.
    - **`block_indexes`**: specific byte-range offsets for each dataset within the merged file.
      - Allows efficient range-request reading of specific datasets later without downloading the whole file.
  - **`compaction_output_sources`**: Records the deterministic output-to-source relationship needed for retries and reconciliation.

6.  **Cleanup**
  - Copies consumed source objects to the deterministic `compacted/` prefix and verifies the destination objects.
  - Deletes source rows from D1 only after those archived source objects are visible through the WEB R2 binding.
  - **Safety**: A failed source move leaves both the source R2 object and D1 source metadata retryable.

---

## Database Schema (D1)

### `archived_files`

Tracks the physical files in R2.

```sql
CREATE TABLE archived_files (
  id INTEGER PRIMARY KEY,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  compression_codec TEXT,
    table_version TEXT,
  created_at INTEGER,
  last_modified_at INTEGER,
  lifecycle_state TEXT NOT NULL DEFAULT 'ready',
  output_etag TEXT,
  output_verified_at_ms INTEGER,
  source_cleanup_completed_at_ms INTEGER,
  output_error TEXT
);
```

`lifecycle_state` progresses from `pending` to `registered` and then `completed`. A stale output can be marked `failed` by reconciliation without deleting its source rows; an R2-only output is registered as `recovery_pending` for later index backfill.

### `compaction_output_sources`

Stores the source R2 path and its archived R2 path independently of the source D1 row. This allows a retry to finish cleanup after the source D1 row has already been removed.

```sql
CREATE TABLE compaction_output_sources (
  output_file_id INTEGER NOT NULL,
  source_file_id INTEGER NOT NULL,
  source_file_path TEXT NOT NULL,
  archived_source_path TEXT NOT NULL,
  source_r2_state TEXT NOT NULL DEFAULT 'pending',
  source_d1_state TEXT NOT NULL DEFAULT 'active',
  created_at_ms INTEGER NOT NULL,
  moved_at_ms INTEGER,
  d1_deleted_at_ms INTEGER,
  UNIQUE(output_file_id, source_file_id)
);
```

### `block_indexes`

Maps datasets to their byte ranges in R2 files.

```sql
CREATE TABLE block_indexes (
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
    table_version TEXT,
  period_tag TEXT,
  file_id INTEGER NOT NULL,
  start_byte INTEGER NOT NULL,
  length INTEGER NOT NULL,
  record_count INTEGER,
  start_timestamp INTEGER,
  end_timestamp INTEGER,
  PRIMARY KEY (dataset_id, file_id)
);
```

---

## Operations

### Metrics & logs

- The Archiver logs summary stats: `[Archival] X files, Y KB archived from Z rows`.
- Errors are logged with `[Archival Error]` prefix.

### Retries & Idempotency


### Recovery boundary: R2-only objects

An R2 object by itself is not a complete archival recovery. The object bytes do not prove the D1 `dataset_id` mapping or the exact `block_indexes` rows required for range reads. An object found in R2 without matching D1 metadata must remain `recovery_pending`; do not create synthetic indexes from a listing or `HEAD` result alone.

Recovery must use the original D1 metadata, a verified D1 backup, or a local rebuild manifest that preserves source-to-output boundaries. Run `pnpm run battle-data:reconcile` first and apply only classifications with sufficient source metadata. Treat an R2-only object as quarantined until its output row, source relationship, and block indexes have been reconstructed and verified.

---

## History

- **Transition**: Migrated from Supabase/Parquet/WASM approach to TiDB/D1/Avro approach.
- **Reason**: Better write buffering performance with TiDB, simpler merging logic with Avro, and reduced cold-start times (removing WASM).

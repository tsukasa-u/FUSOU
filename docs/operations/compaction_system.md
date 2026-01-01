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

    - Groups data by `table_name`, `period_tag`, and `schema_version`.
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
    - Path: `{schemaVersion}/{periodTag}/{runTimestamp}/{tableName}-{indexStr}.avro`
    - Metadata: Stores run info, block counts, and schema version.

5.  **Indexing (D1)**

    - **`archived_files`**: Registers the new R2 file.
    - **`block_indexes`**: specific byte-range offsets for each dataset within the merged file.
      - Allows efficient range-request reading of specific datasets later without downloading the whole file.

6.  **Cleanup**
    - Deletes processed records from `buffer_logs`.
    - **Safety**: Only deletes if R2 upload and D1 indexing confirm success.

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
  schema_version TEXT,
  created_at INTEGER,
  last_modified_at INTEGER
);
```

### `block_indexes`

Maps datasets to their byte ranges in R2 files.

```sql
CREATE TABLE block_indexes (
  dataset_id TEXT NOT NULL,
  table_name TEXT NOT NULL,
  schema_version TEXT,
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

- **File Registration**: Uses `INSERT OR REPLACE` or checks existence to support re-runs.
- **Cleanup**: Transactional-like safety; logic ensures data is in R2/D1 before deleting from buffer.

---

## History

- **Transition**: Migrated from Supabase/Parquet/WASM approach to TiDB/D1/Avro approach.
- **Reason**: Better write buffering performance with TiDB, simpler merging logic with Avro, and reduced cold-start times (removing WASM).

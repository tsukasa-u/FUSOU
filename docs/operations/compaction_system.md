# Data Archival & Compaction System

This document describes the data ingestion and archival system for FUSOU, which moves data from ingestion buffers to long-term storage (R2).

## Overview

The hourly ingest worker uses **Turso buffers, D1 indexes, and R2 storage**.
It replaces the legacy Supabase/Parquet-based compaction with an **Avro OCF** merging strategy.

### Components

1.  **FUSOU-WORKFLOW (Ingest & Archival)**
    - **Ingest**: Receives Avro slices via `POST /battle-data/upload`, buffers via Queue to DB.
    - **Buffer**: Writes Avro blobs to Turso `buffer_logs_active` with transactional Queue receipts.
    - **Archival (Cron)**: Periodically merges buffered data into R2 and updates metadata.

2.  **Databases**
    - **Turso**: Durable active/processing buffers and compaction ownership journal.
    - **Cloudflare D1**: Metadata storage (`archived_files`, `block_indexes`), not a buffer fallback.
    - **Cloudflare R2**: Object storage for merged Avro OCF files.

---

## Archival Process (Cron)

The `handleCron` function (`src/cron.ts`) performs the following steps:

1.  **Claim a bounded batch**
    - A Turso write transaction claims the singleton compaction journal.
    - It moves at most 100 rows / 4 MiB from active to processing, or adopts a bounded prefix of legacy processing rows.
    - The persisted run ID, timestamp, and cutoff survive retries. Table names are never swapped.

2.  **Grouping**
    - Groups data by `table_name`, `period_tag`, and `table_version`.
    - Further groups by `dataset_id` to handle multi-part uploads.

3.  **Avro OCF Merging**
    - **Logic**: `mergeAvroOCF` / `mergeAvroOCFWithBoundaries` (`src/avro-merger.ts`).
    - **Strategy**: Concatenates multiple Avro OCF files into a single valid OCF file.
      - Preserves the header (Magic, Metadata, Sync Marker) from the first file.
      - Concatenates data blocks.
      - Calculates exact byte boundaries for each dataset within the merged file.
    - **Limit**: At most 4 MiB of source OCF bytes per batch/file, plus merging overhead. Inputs must share a schema and codec.

4.  **Storage (R2)**
    - Uploads the merged file to `BATTLE_DATA_BUCKET`.
    - Path: `{tableVersion}/{periodTag}/hourly/{epoch-hash-runId}/{tableName}-{indexStr}.avro`
    - Metadata: Stores run info, block counts, and table version.

5.  **Indexing (D1)**
  - **Hourly `archived_files`**: Registers the new R2 file after the R2 PUT succeeds.
    - **`block_indexes`**: specific byte-range offsets for each dataset within the merged file.
      - Allows efficient range-request reading of specific datasets later without downloading the whole file.
  - Replaces each file's block indexes in one D1 batch transaction; each SQL statement stays below 100 bind parameters.
  - **Later tier compaction** uses `compaction_output_sources` and verified source moves, as described below.

6.  **Cleanup**
  - Hourly archival requires archive/index/snapshot success, records `published = 1`, then transactionally deletes only its claimed processing prefix.
  - Cleanup failure resumes without publishing the archive again. New active rows and unclaimed processing rows remain untouched.
  - Later tier compaction moves source objects to `compacted/` and verifies visibility before deleting its D1 source indexes.

### Workflow durability rollout and recovery (2026-10-28)

1. Pause the old hourly cron/admin invocations and drain in-flight work before changing the buffer protocol. Do not mix old table-swapping code with the new journal-based worker.
2. Apply [the Turso migration](../sql/turso/migration_0001_workflow_durability.sql) to the buffer database, then deploy the new worker. The migration is additive and idempotent; no production migration is executed by the audit tools.
3. Keep `workflow_queue_receipts` while messages can be redelivered/replayed. The key is Queue name + message ID, not a content hash. Re-enqueueing with a new ID is a new delivery and may need record-level deduplication. No automatic receipt GC is provided.
4. An owner is intentionally **not lease-expired automatically**: an HTTP admin invocation can outlive a nominal cron interval. A crashed isolate can leave the journal locked. Alert on `Compaction already owned`, inspect the journal, stop competing entrypoints, and positively confirm that the old invocation has ended before clearing ownership.

```sql
SELECT * FROM workflow_compaction_state WHERE id = 1;
-- Only after the old owner is confirmed dead; use the observed owner token.
UPDATE workflow_compaction_state
SET owner = NULL
WHERE id = 1 AND owner = '<observed-dead-owner>';
```

Do not clear `run_id`, `cutoff_id`, `started_at`, or `published`; the next cron needs them to resume the same batch. Do not DROP/TRUNCATE the processing table. A row above the byte limit or invalid OCF must be investigated/quarantined explicitly, not silently discarded. Already duplicated legacy buffer rows are not retroactively deduplicated.

Each invocation processes up to 50 bounded batches, checking a ten-minute wall-time budget between batches. One slow batch can still exceed the platform deadline; progress is restartable, not guaranteed to finish. Hot reads always include processing rows; an eventually consistent KV flag must not hide a failed batch.

DLQ messages are saved to `dead-letter/{queue}/{messageId}.json` in the battle R2 bucket **before acknowledgement**. Storage errors retry after five minutes, with up to 100 configured retries. Alert and recover before retries/Queue retention expire; this is not unlimited retention. Replaying a DLQ record must preserve the original main-Queue receipt identity or explicitly account for a new message ID. Never expose the dead-letter prefix through public snapshot listing.

Required secrets remain `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and endpoint-specific `UPLOAD_INGEST_TOKEN` / `MASTER_DATA_CLEANUP_TOKEN`. The cleanup HTTP route forwards its token; missing tokens fail closed. Cleanup never deletes pending uploads, and retains objects referenced by `master_data_tables`.

The former GitHub daily trigger is retired by operator choice: it sent a scheduler-only message to the Avro ingest queue. Daily/weekly tier compaction belongs to Trigger.dev's `compact-daily` / `compact-weekly` tasks on the `compaction-scheduled` queue. Manual dispatch of the retired Action now fails with an explicit retirement message instead of appearing to enqueue work.

### Snapshot safety boundaries

- Malformed OCF and existing corrupt snapshots fail the batch; required snapshot failures do not allow processing cleanup.
- Partial uploads merge existing sortie tables rather than replace them wholesale. `env_info.uuid` is an environment identity. Version aliases normalize to `0.5.0`; equal environment IDs in different periods stay separate.
- Drops preserve their own history instead of rebuilding solely from the shorter overview history.
- Expanded Brotli snapshot JSON is capped at 16 MiB. Deflate Avro decoding is capped at 4 MiB per OCF / 10,000 records, with a 16 MiB / 50,000-record batch guard. These are application guards, **not proof** that isolate memory stays below 128 MB.
- ETag-conditional PUT detects conflicting writes. One R2 object is atomically replaced, but overview/drops/details are still fixed-key objects, **not a single atomic generation**. A failed batch may temporarily expose a mixed set until retry. The operator explicitly deferred a manifest migration involving WEB readers.
- A second producer that ignores conditional publication can still overwrite a key. Existing CDN/KV caches are not globally purged by this worker.
- R2/Turso/D1 do not share a transaction. Stable archive paths and atomic per-file index replacement make local retries convergent, but reconciliation is still needed for a crash after a PUT and for overlap with later tier compaction before the journal records publication. The hourly journal does not lock Trigger.dev tier jobs.
- The optional WEB detail-rebuild HTTP call is best-effort, not a durable job. Raw sortie snapshots and archive/index writes are mandatory; derived WEB detail regeneration can require a later authenticated rebuild.

See [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [Queue limits](https://developers.cloudflare.com/queues/platform/limits/). This package is a normal Worker, despite its name: `cpu_ms = 300000` is not a Workflows-step checkpoint. Cron/Queue wall time is 15 minutes; HTTP `waitUntil` grants up to 30 seconds after response/disconnect, not unlimited execution. Quest inference recovers `running` tasks older than 30 minutes and transactionally publishes occurrences and each target's rule set; quadratic candidate growth still requires production-scale profiling.

### Local regression commands

From the repository root, using Node 22.16 or later and the locked pnpm version:

```powershell
pnpm --filter fusou-workflow test
pnpm --filter fusou-workflow typecheck
pnpm --filter @fusou/compaction-core test
```

The workflow suite uses an in-memory SQLite database with transaction rollback tests, deterministic R2 fixtures, and per-message ACK/RETRY spies. It does not write to production Turso/D1/R2. GitHub CI runs these tests on workflow/core PR changes; full Rust schema generation and a deployed Worker smoke remain separate checks.

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

---

## R2 Snapshot High-Speed Serving (Zero-D1 Architecture)

To eliminate D1 read contention and ensure 20–80ms latency across all public dashboard pages, FUSOU utilizes pre-generated R2 snapshots:

### 1. Battle Data Snapshots (`snapshots/battle_data/`)
- **Sortie-Bundle Aggregation**: Data is bundled at the sortie level rather than individual battles, drastically reducing file count and enabling 0ms tab switching in the client.
- **Pre-generated Tab Views**: Overview, drops, and detail-env bundles are pre-joined during compaction and served directly from R2.
- **Edge KV Cache Isolation**: Detail environment and individual detail keys use the `v9` namespace and include the requested period. Individual indices are canonicalized numerically.

### 2. Ship Growth Snapshots (`snapshots/ship_growth/`)
- **Zero-D1 Endpoints**: `/summary`, `/bounds`, `/exp`, `/cumulative`, and `/all-periods` serve directly from pre-aggregated Brotli-compressed R2 objects.
- **Version Normalization**: Legacy `0.5` table versions are unified to semantic version `0.5.0`.
- **Transparent Decompression**: Worker decompresses Brotli in-memory and serves plain JSON (`Content-Type: application/json`), avoiding browser `res.json()` parse failures while leveraging Cloudflare edge auto-compression.
- **Snapshot Rebuild Endpoint**: `POST /api/ship-growth/internal/rebuild-snapshots` walks past archives in R2, aggregates bounds (MIN) and caps (MAX), and generates the complete snapshot suite.

### Ship-growth publication and recovery (2026-10-27)

- Deploy the manifest-aware reader before relying on generation objects. With no `snapshots/ship_growth/manifest.json`, fixed-key snapshots remain readable.
- Run the authenticated rebuild endpoint to bootstrap a complete generation. It writes immutable objects under `snapshots/ship_growth/generations/{generation}/`, saves that generation's manifest, then conditionally publishes the current manifest using the previous ETag.
- Check the returned generated keys and read all five public endpoints, including filtered bounds and both version aliases. A successful snapshot hit must not require D1.
- Missing/corrupt archives, incomplete listings, configured D1 failures, failed writes, and publication conflicts must not replace the current manifest. Retrying is safe; failed attempts can leave unreferenced generation objects.
- Successful ingest schedules a bounded-retry publication of the affected period and refreshed aggregates after D1 commit. Monitor `[ship-growth] Failed to publish post-ingest snapshots`; background execution is not a durable queue. Rebuild explicitly after a failed or interrupted update.
- Retain old objects and generation manifests for recovery. To roll back, first verify every object referenced by the chosen historical manifest, then restore that manifest as the current one. Do not blanket-delete old generations: a later incremental manifest can still reference their per-period objects.
- No automatic generation or legacy-object garbage collection is introduced. Use reachability from retained manifests when designing a separate retention job.
- Expanded JSON and compressed input are limited to 16 MiB per object. This guard does not prove that a full rebuild stays within the 128 MB per-isolate Worker memory ceiling. Profile large rebuilds and concurrent read/write requests before production rollout; split generation into durable jobs if necessary.
- Fixed-key read responses now require revalidation (`max-age=0, must-revalidate`) so old CDN/client TTLs do not mask publication. Previously cached responses can retain their old freshness until expiration or an explicit purge during rollout.
- See [Cloudflare memory limits](https://developers.cloudflare.com/workers/platform/limits/#memory) and [CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time). Increasing Paid CPU time does not raise the normal Workers memory ceiling.

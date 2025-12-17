-- ============================================================================
-- Cloudflare D1 Schema - Battle Files Index Database
-- ============================================================================
-- This schema manages the metadata for battle data fragments stored in R2.
-- It supports offset-based table extraction for efficient compaction.
--
-- Database: dev_kc_battle_index
-- Generated: 2025-12-17 via CLI introspection
-- ============================================================================

-- Create the main battle files index table
CREATE TABLE IF NOT EXISTS battle_files (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- R2 object key (full path) - immutable
  key TEXT NOT NULL UNIQUE,

  -- Dataset and table identifiers (for grouping/filtering)
  dataset_id TEXT NOT NULL,
  "table" TEXT NOT NULL,

  -- File metrics
  size INTEGER NOT NULL,      -- bytes
  etag TEXT,                  -- R2 ETag for integrity verification

  -- Timestamps (UTC, ISO 8601)
  uploaded_at TEXT NOT NULL,

  -- Content validation
  content_hash TEXT,          -- SHA-256 hex string (optional for future deduplication logic)

  -- Audit trail
  uploaded_by TEXT NOT NULL,  -- Supabase user ID
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,

  -- Offset metadata for concatenated Parquet files
  -- JSON array: [{"table_name": "api_port", "start_byte": 0, "byte_length": 1024, "format": "parquet"}, ...]
  table_offsets TEXT DEFAULT NULL
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_battle_files_dataset_id ON battle_files(dataset_id);
CREATE INDEX IF NOT EXISTS idx_battle_files_table ON battle_files("table");
CREATE INDEX IF NOT EXISTS idx_battle_files_uploaded_at ON battle_files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_files_uploaded_by ON battle_files(uploaded_by);

-- ============================================================================
-- Views for data analysis
-- ============================================================================

-- Latest fragment for each table in each dataset
CREATE VIEW IF NOT EXISTS battle_files_latest AS
SELECT DISTINCT ON (dataset_id, "table")
  id, key, dataset_id, "table", size, etag, uploaded_at,
  content_hash, uploaded_by, created_at, table_offsets
FROM battle_files
ORDER BY dataset_id, "table", uploaded_at DESC;

-- Fragment summary by period
CREATE VIEW IF NOT EXISTS battle_files_period_summary AS
SELECT
  dataset_id,
  "table",
  COUNT(*) as fragment_count,
  SUM(size) as total_size,
  MIN(uploaded_at) as earliest_upload,
  MAX(uploaded_at) as latest_upload
FROM battle_files
GROUP BY dataset_id, "table";

-- Global summary
CREATE VIEW IF NOT EXISTS battle_files_global_summary AS
SELECT
  COUNT(*) as total_fragments,
  COUNT(DISTINCT dataset_id) as dataset_count,
  COUNT(DISTINCT "table") as table_count,
  SUM(size) as total_size_bytes
FROM battle_files;

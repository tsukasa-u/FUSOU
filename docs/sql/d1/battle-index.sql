-- ============================================================================
-- DEPRECATED: Parquet-era Battle Data Index (battle_files)
-- ============================================================================
-- This file is kept for historical reference only. The project has migrated to
-- Avro append-only storage with indexed segments. Use docs/sql/d1/avro-schema.sql
-- to create and manage the current schema (avro_files, avro_segments, etc.).
-- Running this file is not recommended.
-- ==========================================================================

-- Create the main battle files index table
CREATE TABLE IF NOT EXISTS battle_files (
  -- Primary key
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  -- R2 object key (full path) - immutable
  key TEXT NOT NULL UNIQUE,

  -- Dataset and table identifiers (for grouping/filtering)
  dataset_id TEXT NOT NULL,
  "table" TEXT NOT NULL,
  
  -- Period tag for grouping (e.g., 2025, 2024Q4, 2025-11-05)
  period_tag TEXT NOT NULL,

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
-- Composite indexes for period-based queries
CREATE INDEX IF NOT EXISTS idx_battle_files_period 
  ON battle_files(dataset_id, "table", uploaded_at);
CREATE INDEX IF NOT EXISTS idx_battle_files_period_tag 
  ON battle_files(dataset_id, "table", period_tag, uploaded_at);

-- Index for latest fragment lookup
CREATE INDEX IF NOT EXISTS idx_battle_files_latest 
  ON battle_files(dataset_id, "table", uploaded_at DESC);

-- Index for uploader tracking (audit)
CREATE INDEX IF NOT EXISTS idx_battle_files_uploaded_by 
  ON battle_files(uploaded_by, uploaded_at DESC);

-- ============================================================================
-- Views for data analysis
-- ============================================================================

-- Latest fragment per dataset/table
CREATE VIEW IF NOT EXISTS battle_files_latest AS
SELECT 
  dataset_id,
  "table",
  period_tag,
  key,
  size,
  etag,
  uploaded_at,
  content_hash,
  uploaded_by
FROM battle_files
WHERE (dataset_id, "table", uploaded_at) IN (
  SELECT dataset_id, "table", MAX(uploaded_at)
  FROM battle_files
  GROUP BY dataset_id, "table"
);

-- Period summary per dataset
CREATE VIEW IF NOT EXISTS battle_files_period_summary AS
SELECT 
  dataset_id,
  "table",
  period_tag,
  COUNT(*) as fragment_count,
  SUM(size) as total_bytes,
  MIN(uploaded_at) as period_start,
  MAX(uploaded_at) as period_end
FROM battle_files
GROUP BY dataset_id, "table", period_tag;

-- Global period summary
CREATE VIEW IF NOT EXISTS battle_files_global_period_summary AS
SELECT 
  "table",
  period_tag,
  COUNT(*) as fragment_count,
  SUM(size) as total_bytes,
  MIN(uploaded_at) as period_start,
  MAX(uploaded_at) as period_end
FROM battle_files
GROUP BY "table", period_tag;

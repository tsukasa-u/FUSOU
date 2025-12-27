-- Battle Data Fragment Index Schema for D1 (BATTLE_INDEX_DB)
-- Tracks all battle_data fragments uploaded to R2 for period-based querying and compaction
-- Table: battle_files
-- Purpose: Maintain immutable index of all battle data Parquet/binary files in R2
--          Enable period window queries for coml Timestamp in UTC (ISO 8601)

CREATE TABLE IF NOT EXISTS battle_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  -- R2 object key (full path) - immutable
  key TEXT NOT NULL UNIQUE,
  
  -- Dataset and table identifiers (for grouping/filtering)
  dataset_id TEXT NOT NULL,
  "table" TEXT NOT NULL,
  period_tag TEXT NOT NULL,
  
  -- File metrics
  size INTEGER NOT NULL,  -- bytes
  etag TEXT,              -- R2 ETag for integrity verification
  
  -- Timestamps (UTC, ISO 8601)
  uploaded_at TEXT NOT NULL,
  
  -- Content validation
  content_hash TEXT,      -- SHA-256 hex string (optional for future deduplication logic)
  
  -- Audit trail
  uploaded_by TEXT NOT NULL,  -- Supabase user ID
  
  -- Table offset metadata (JSON array for concatenated Parquet files)
  table_offsets TEXT DEFAULT NULL,
  
  -- Indexes for common queries
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Composite index for period queries (dataset + table + time range)
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

-- View: Latest fragment per dataset/table
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

-- View: Period summary per dataset (no daily window)
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

-- View: Global period summary across all users (for global compaction)
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

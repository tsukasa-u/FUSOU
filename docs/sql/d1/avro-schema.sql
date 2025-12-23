-- ============================================================================
-- Cloudflare D1 Schema - Avro Data Storage Index Database
-- ============================================================================
-- This schema manages metadata for Avro-format battle data stored in R2.
-- It is optimized for append-based workflow with automatic segmentation.
--
-- Database: dev_kc_battle_index (replaces Parquet-era battle_files table)
-- Purpose: Track current state of Avro files and their segments
--
-- Design Philosophy:
--   - Parquet: Immutable fragments (1 upload = 1 new file = 1 table record)
--   - Avro: Mutable files via append (1 upload = append to existing file)
--   - Segmentation: Files exceeding 512MB are split into indexed segments (.0, .1, .2, ...)
--
-- Migration: This schema replaces the Parquet-era battle_files table.
--            Old data can be archived to battle_files_parquet_archive.
-- ============================================================================

-- ============================================================================
-- Main Table: avro_files
-- ============================================================================
-- Tracks the current state of each Avro file.
-- One record per file. Updated on each append operation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS avro_files (
    -- Primary key (virtual parent key, does not directly match R2 object)
    -- Format: "datasetId/table/periodTag" (no .avro extension)
    -- Example: "dataset123/battle/202412"
    -- Note: Actual R2 files are named periodTag.0.avro, periodTag.1.avro, etc.
    file_key TEXT PRIMARY KEY,
    
    -- Classification metadata
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    period_tag TEXT NOT NULL,    -- e.g., "202412", "202412-W3", "20241222"
    
    -- Current file state
    current_size INTEGER NOT NULL,      -- Always 0 (actual sizes tracked in avro_segments)
    record_count INTEGER DEFAULT 0,     -- Estimated number of records (optional)
    
    -- Segmentation status
    is_segmented BOOLEAN DEFAULT FALSE, -- TRUE once segmented storage is used (at least .0 segment exists)
    segment_count INTEGER DEFAULT 0,    -- Number of segments (0 = not segmented)
    
    -- R2 metadata
    last_etag TEXT,                     -- Most recent R2 ETag
    
    -- Content validation
    content_hash TEXT,                  -- SHA-256 of last appended data (for deduplication)
    
    -- Timestamps (Unix timestamps in milliseconds)
    created_at INTEGER NOT NULL,        -- Initial file creation time
    last_appended_at INTEGER NOT NULL,  -- Most recent append operation time
    
    -- Audit trail
    uploaded_by TEXT,                   -- Supabase user ID of last uploader
    
    -- Schema information (optional, for future validation)
    avro_schema TEXT DEFAULT NULL       -- JSON representation of Avro schema
);

-- Indexes for common query patterns
-- Composite index for dataset/table/period queries
CREATE INDEX IF NOT EXISTS idx_avro_files_dataset 
    ON avro_files(dataset_id, table_name, period_tag);

-- Index for time-based queries (most recent first)
CREATE INDEX IF NOT EXISTS idx_avro_files_period 
    ON avro_files(period_tag DESC);

-- Index for finding recently updated files
CREATE INDEX IF NOT EXISTS idx_avro_files_last_appended 
    ON avro_files(last_appended_at DESC);

-- Index for finding segmented files
CREATE INDEX IF NOT EXISTS idx_avro_files_segmented 
    ON avro_files(is_segmented, segment_count) 
    WHERE is_segmented = TRUE;


-- ============================================================================
-- Segment Table: avro_segments
-- ============================================================================
-- Tracks individual segment files created when parent exceeds 512MB.
-- Only populated when segmentation occurs.
-- ============================================================================

CREATE TABLE IF NOT EXISTS avro_segments (
    -- Primary key (matches R2 object key)
    -- Format: "datasetId/table/periodTag.{index}.avro"
    -- Example: "dataset123/battle/202412.0.avro", "dataset123/battle/202412.1.avro"
    segment_key TEXT PRIMARY KEY,
    
    -- Parent file reference (foreign key to avro_files)
    parent_file_key TEXT NOT NULL,
    
    -- Segment metadata
    segment_number INTEGER NOT NULL,    -- Sequential segment index (0, 1, 2, ...)
    segment_size INTEGER NOT NULL,      -- Bytes in this segment
    record_count INTEGER DEFAULT 0,     -- Estimated records in this segment (optional)
    
    -- R2 metadata
    etag TEXT,
    
    -- Content validation
    content_hash TEXT,                  -- SHA-256 of segment data
    
    -- Timestamps
    created_at INTEGER NOT NULL,        -- Segment creation time
    
    -- Foreign key constraint
    FOREIGN KEY (parent_file_key) REFERENCES avro_files(file_key) ON DELETE CASCADE
);

-- Indexes for segment queries
-- Composite index for parent file + segment ordering
CREATE INDEX IF NOT EXISTS idx_avro_segments_parent 
    ON avro_segments(parent_file_key, segment_number);

-- Index for time-based segment queries
CREATE INDEX IF NOT EXISTS idx_avro_segments_created 
    ON avro_segments(created_at DESC);


-- ============================================================================
-- Optional Table: avro_append_history
-- ============================================================================
-- Audit trail for all append operations.
-- Useful for debugging, monitoring, and compliance.
-- This table is OPTIONAL and can be enabled if audit requirements exist.
-- ============================================================================

CREATE TABLE IF NOT EXISTS avro_append_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Target file
    file_key TEXT NOT NULL,
    
    -- Append operation details
    appended_bytes INTEGER NOT NULL,    -- Bytes added in this operation
    appended_records INTEGER DEFAULT 0, -- Records added (estimated, optional)
    
    -- Before/after state
    size_before INTEGER NOT NULL,       -- File size before append
    size_after INTEGER NOT NULL,        -- File size after append
    
    -- Operation result
    action TEXT NOT NULL,               -- 'append', 'segment_created', 'new_file'
    segment_created TEXT,               -- If action='segment_created', the segment_key
    
    -- Content validation
    content_hash TEXT,                  -- SHA-256 of appended data
    
    -- Timestamps
    appended_at INTEGER NOT NULL,       -- When this append occurred
    triggered_at INTEGER,               -- Original request timestamp (from client)
    
    -- Audit trail
    uploaded_by TEXT,                   -- Supabase user ID
    
    -- Foreign key constraint
    FOREIGN KEY (file_key) REFERENCES avro_files(file_key) ON DELETE CASCADE
);

-- Indexes for append history
-- Composite index for file-based history queries
CREATE INDEX IF NOT EXISTS idx_append_history_file 
    ON avro_append_history(file_key, appended_at DESC);

-- Index for time-based history queries
CREATE INDEX IF NOT EXISTS idx_append_history_time 
    ON avro_append_history(appended_at DESC);

-- Index for finding segment creation events
CREATE INDEX IF NOT EXISTS idx_append_history_segments 
    ON avro_append_history(action) 
    WHERE action = 'segment_created';


-- ============================================================================
-- Views for Data Analysis
-- ============================================================================

-- Current state of all files with their total size (including segments)
CREATE VIEW IF NOT EXISTS avro_files_with_total_size AS
SELECT 
    f.file_key,
    f.dataset_id,
    f.table_name,
    f.period_tag,
    f.current_size,
    f.segment_count,
    f.is_segmented,
    (SELECT COALESCE(SUM(segment_size), 0) FROM avro_segments WHERE parent_file_key = f.file_key) AS total_size,
    f.record_count,
    f.created_at,
    f.last_appended_at,
    f.uploaded_by
FROM avro_files f;

-- Latest files per dataset/table combination
CREATE VIEW IF NOT EXISTS avro_files_latest AS
SELECT 
    dataset_id,
    table_name,
    period_tag,
    file_key,
    current_size,
    segment_count,
    is_segmented,
    last_appended_at,
    uploaded_by
FROM avro_files
WHERE (dataset_id, table_name, last_appended_at) IN (
    SELECT dataset_id, table_name, MAX(last_appended_at)
    FROM avro_files
    GROUP BY dataset_id, table_name
);

-- Period summary: aggregated statistics per period
CREATE VIEW IF NOT EXISTS avro_period_summary AS
SELECT 
    f.dataset_id,
    f.table_name,
    f.period_tag,
    COUNT(*) AS file_count,
    (SELECT COALESCE(SUM(s.segment_size), 0) 
     FROM avro_segments s 
     WHERE s.parent_file_key = f.file_key) AS total_bytes,
    f.segment_count AS total_segments,
    f.created_at AS period_start,
    f.last_appended_at AS period_end
FROM avro_files f
GROUP BY f.dataset_id, f.table_name, f.period_tag;

-- Global summary: all tables across all datasets
CREATE VIEW IF NOT EXISTS avro_global_summary AS
SELECT 
    table_name,
    COUNT(*) AS file_count,
    (SELECT COALESCE(SUM(segment_size), 0) FROM avro_segments) AS total_bytes,
    SUM(segment_count) AS total_segments,
    COUNT(CASE WHEN is_segmented = TRUE THEN 1 END) AS segmented_files,
    MIN(created_at) AS earliest_file,
    MAX(last_appended_at) AS latest_append
FROM avro_files
GROUP BY table_name;


-- ============================================================================
-- Migration Notes
-- ============================================================================
-- To migrate from the Parquet-era battle_files table:
--
-- 1. Archive old table:
--    ALTER TABLE battle_files RENAME TO battle_files_parquet_archive;
--
-- 2. Create new schema:
--    Run this file to create avro_files, avro_segments, and related tables.
--
-- 3. Backfill existing Avro data (if needed):
--    INSERT INTO avro_files (file_key, dataset_id, table_name, period_tag, current_size, created_at, last_appended_at, ...)
--    SELECT 
--        key,
--        dataset_id,
--        "table",
--        period_tag,
--        size,
--        MIN(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS created_at,
--        MAX(CAST(strftime('%s', uploaded_at) AS INTEGER) * 1000) AS last_appended_at,
--        ...
--    FROM battle_files_parquet_archive
--    WHERE dataset_id IS NOT NULL  -- Filter for Avro-era data only
--    GROUP BY key;
--
-- 4. Update application code to use new schema (see index.ts changes).
--
-- ============================================================================

-- ============================================================================
-- Cloudflare D1 Schema - Hot/Cold Architecture Extension
-- ============================================================================
-- Purpose: Extend battle data system with Hot/Cold separation for efficiency
--
-- Architecture Overview:
--   Hot Storage (D1 buffer_logs):
--     - Direct writes from Queue Consumer
--     - Recent 1 hour of data
--     - Fast, low-latency access
--   
--   Cold Storage (R2 consolidated Avro):
--     - Archived hourly via Cron Worker
--     - Optimized for Range Request (byte-level addressing)
--     - Compressed (deflate/snappy)
--
--   Block Index (D1 block_indexes):
--     - Maps dataset_id → file location → byte offset
--     - Enables pinpoint R2 Range Requests
--
-- Migration Path:
--   Phase 1: Parallel deployment (new log system)
--   Phase 2: Integration with existing avro_files/avro_segments
--   Phase 3: Gradual migration of battle data to Hot/Cold model
--
-- Usage:
--   Local: npx wrangler d1 execute dev_kc_battle_index --local --file=./docs/sql/d1/hot-cold-schema.sql
--   Remote: npx wrangler d1 execute dev_kc_battle_index --remote --file=./docs/sql/d1/hot-cold-schema.sql
-- ============================================================================

-- ============================================================================
-- Table 1: buffer_logs (Hot Storage)
-- ============================================================================
-- Purpose: Temporary buffer for incoming data (direct from Queue)
-- Lifecycle: Data resides here for ~1 hour before archival
-- Access Pattern: High write frequency, low read frequency
-- Cleanup: Archived data is deleted after successful R2 upload
-- ============================================================================

CREATE TABLE IF NOT EXISTS buffer_logs (
    -- Surrogate primary key (for safe batch deletion)
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Classification (for grouping during archival)
    dataset_id TEXT NOT NULL,        -- User/Dataset identifier
    table_name TEXT NOT NULL,        -- Table type (e.g., 'battle', 'pvp')
    period_tag TEXT NOT NULL DEFAULT 'latest', -- Server-issued period tag
    schema_version TEXT NOT NULL DEFAULT 'v1', -- Schema version (v1, v2, etc.)
    
    -- Temporal metadata
    timestamp INTEGER NOT NULL,      -- Record's logical timestamp (milliseconds)
    
    -- Payload
    data BLOB NOT NULL,              -- Raw JSON or pre-serialized Avro bytes
    
    -- Audit trail
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),  -- Buffer insertion time (ms)
    uploaded_by TEXT                 -- Optional: Supabase user ID
);

-- Composite index for dataset + table + time range queries
CREATE INDEX IF NOT EXISTS idx_buffer_search 
    ON buffer_logs (dataset_id, table_name, timestamp);

-- Index for cleanup operations (delete old buffered data)
CREATE INDEX IF NOT EXISTS idx_buffer_cleanup 
    ON buffer_logs (created_at);

-- Index for archival batch processing (fetch by ID range)
CREATE INDEX IF NOT EXISTS idx_buffer_batch 
    ON buffer_logs (id);

-- Index for schema version filtering
CREATE INDEX IF NOT EXISTS idx_buffer_schema_version
    ON buffer_logs (schema_version, table_name, period_tag);

-- ============================================================================
-- Table 2: archived_files (File Path Normalization)
-- ============================================================================
-- Purpose: Deduplicate file paths to save D1 storage space
-- Design: Foreign key reference instead of repeating full paths
-- Example: Instead of storing "battle/202412.avro" 1000 times,
--          store it once here and reference via file_id
-- ============================================================================

CREATE TABLE IF NOT EXISTS archived_files (
    -- Surrogate primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- R2 object key (without bucket name)
    -- Format: "{schema_version}/{period_tag}/{table_name}-{index}.avro"
    -- Example: "v1/2025-12-25/battle-001.avro"
    file_path TEXT NOT NULL UNIQUE,
    
    -- Schema version (v1, v2, etc.)
    schema_version TEXT NOT NULL DEFAULT 'v1',
    
    -- File metadata
    file_size INTEGER,               -- Total file size in bytes (optional)
    compression_codec TEXT,          -- 'deflate', 'snappy', or NULL
    
    -- Timestamps
    created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
    last_modified_at INTEGER
);

-- Index for reverse lookup (path → id)
CREATE INDEX IF NOT EXISTS idx_archived_path 
    ON archived_files (file_path);

-- Index for schema version filtering
CREATE INDEX IF NOT EXISTS idx_archived_schema
    ON archived_files (schema_version);

-- ============================================================================
-- Table 3: block_indexes (Byte-Level Address Book)
-- ============================================================================
-- Purpose: Map dataset_id → file location → byte offset for Range Requests
-- This is the **core optimization** enabling efficient partial R2 reads
--
-- Access Pattern Example:
--   1. Query: "Get dataset X's battle data for December 2024"
--   2. Lookup: block_indexes WHERE dataset_id = X AND table_name = 'battle' AND ...
--   3. Result: [(file_id=5, start_byte=1024, length=8192), ...]
--   4. Fetch: R2.get('battle/202412.avro', { range: { offset: 1024, length: 8192 } })
-- ============================================================================

CREATE TABLE IF NOT EXISTS block_indexes (
    -- Surrogate primary key
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Classification (who/what/when)
    dataset_id TEXT NOT NULL,
    table_name TEXT NOT NULL,
    schema_version TEXT NOT NULL DEFAULT 'v1',
    
    -- File reference (normalized foreign key)
    file_id INTEGER NOT NULL,
    
    -- Byte-level addressing for Range Request
    start_byte INTEGER NOT NULL,     -- Offset in R2 file (0-indexed)
    length INTEGER NOT NULL,         -- Block size in bytes
    
    -- Content metadata (for query optimization)
    record_count INTEGER,            -- Number of records in this block
    start_timestamp INTEGER,         -- First record's timestamp (ms)
    end_timestamp INTEGER,           -- Last record's timestamp (ms)
    
    -- Validation (optional integrity check)
    block_hash TEXT,                 -- SHA-256 of block content
    
    -- Foreign key constraint
    FOREIGN KEY (file_id) REFERENCES archived_files(id) ON DELETE CASCADE
);

-- Composite index for dataset + table + time range queries
-- This is the PRIMARY access pattern for reading Cold data
CREATE INDEX IF NOT EXISTS idx_block_search 
    ON block_indexes (dataset_id, table_name, schema_version, start_timestamp, end_timestamp);

-- Index for file-based cleanup (delete all blocks when file is removed)
CREATE INDEX IF NOT EXISTS idx_block_file 
    ON block_indexes (file_id);

-- Index for dataset-only queries (analytics use case)
CREATE INDEX IF NOT EXISTS idx_block_dataset 
    ON block_indexes (dataset_id);

-- ============================================================================
-- View: hot_cold_summary
-- ============================================================================
-- Purpose: Quick overview of Hot vs Cold data distribution
-- Usage: SELECT * FROM hot_cold_summary;
-- ============================================================================

CREATE VIEW IF NOT EXISTS hot_cold_summary AS
SELECT
    'Hot (Buffer)' AS storage_type,
    dataset_id,
    table_name,
    COUNT(*) AS record_count,
    SUM(LENGTH(data)) AS total_bytes,
    MIN(timestamp) AS earliest_timestamp,
    MAX(timestamp) AS latest_timestamp
FROM buffer_logs
GROUP BY dataset_id, table_name

UNION ALL

SELECT
    'Cold (Archived)' AS storage_type,
    bi.dataset_id,
    bi.table_name,
    SUM(bi.record_count) AS record_count,
    SUM(bi.length) AS total_bytes,
    MIN(bi.start_timestamp) AS earliest_timestamp,
    MAX(bi.end_timestamp) AS latest_timestamp
FROM block_indexes bi
GROUP BY bi.dataset_id, bi.table_name;

-- ============================================================================
-- View: archive_efficiency
-- ============================================================================
-- Purpose: Monitor compression efficiency and file utilization
-- Usage: SELECT * FROM archive_efficiency ORDER BY compression_ratio DESC;
-- ============================================================================

CREATE VIEW IF NOT EXISTS archive_efficiency AS
SELECT
    af.file_path,
    af.compression_codec,
    af.file_size,
    COUNT(bi.id) AS block_count,
    SUM(bi.length) AS total_indexed_bytes,
    ROUND(CAST(SUM(bi.length) AS REAL) / af.file_size * 100, 2) AS utilization_percent,
    CASE 
        WHEN af.compression_codec IS NOT NULL 
        THEN ROUND(CAST(af.file_size AS REAL) / SUM(bi.length), 2)
        ELSE NULL
    END AS compression_ratio,
    af.created_at
FROM archived_files af
LEFT JOIN block_indexes bi ON af.id = bi.file_id
GROUP BY af.id;

-- ============================================================================
-- Cleanup Recommendations
-- ============================================================================
-- Use these queries to maintain healthy Hot/Cold separation:
--
-- 1. Check for stale Hot data (older than 2 hours):
--    SELECT COUNT(*) FROM buffer_logs 
--    WHERE created_at < (strftime('%s', 'now') * 1000) - (2 * 60 * 60 * 1000);
--
-- 2. Manually purge archived data (after verification):
--    DELETE FROM buffer_logs WHERE id <= ?;
--
-- 3. Find orphaned blocks (file deleted but blocks remain):
--    SELECT * FROM block_indexes WHERE file_id NOT IN (SELECT id FROM archived_files);
--
-- 4. Verify Range Request coverage:
--    SELECT file_path, SUM(length) AS indexed_bytes, file_size
--    FROM archived_files af
--    JOIN block_indexes bi ON af.id = bi.file_id
--    GROUP BY af.id
--    HAVING indexed_bytes != file_size;
-- ============================================================================

-- ============================================================================
-- Migration Notes
-- ============================================================================
-- Coexistence with existing avro_files/avro_segments:
--   - This schema runs in PARALLEL with existing real-time append system
--   - No conflicts (different tables, different access patterns)
--   - Gradual migration: Start with new data → backfill historical data
--
-- Performance Targets:
--   - Hot Read: < 50ms (D1 query)
--   - Cold Read (single block): < 200ms (R2 Range Request + D1 index lookup)
--   - Cold Read (multi-block): < 500ms (parallel R2 requests)
--   - Archival: < 5 minutes (hourly Cron, bulk operation)
--
-- Cost Optimization:
--   - D1 Writes: Bulk Insert (100 records/query vs 1 record/query)
--   - R2 Reads: Range Request (10KB vs 500MB full download)
--   - Storage: Compression (2-5x reduction with deflate)
-- ============================================================================
